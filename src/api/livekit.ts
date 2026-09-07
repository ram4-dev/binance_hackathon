import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from "livekit-server-sdk";
import {
  readApiProcessConfig,
  readLiveKitConnectionConfig,
  type LiveKitConnectionConfig,
} from "../config/process.js";

type ConnectionDetailsResponse = {
  server_url: string;
  participant_token: string;
  room_name: string;
  participant_name: string;
};

type NormalizedConnectionRequest = {
  roomName?: string;
  participantIdentity?: string;
  participantName?: string;
  agentName?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * The browser's `TokenSource.endpoint` POSTs the LiveKit `TokenSourceRequest`
 * serialized with proto field names (snake_case). The Cloud sandbox and the
 * custom endpoint share that wire shape, so we accept the snake_case keys and
 * keep the camelCase aliases as a convenience for direct callers.
 */
function normalizeConnectionDetailsRequest(body: unknown): NormalizedConnectionRequest {
  if (!body || typeof body !== "object") return {};
  const obj = body as Record<string, unknown>;

  const roomConfigRaw = obj.room_config ?? obj.roomConfig;
  let agentName: string | undefined;
  if (roomConfigRaw && typeof roomConfigRaw === "object") {
    const rc = roomConfigRaw as Record<string, unknown>;
    const agents = rc.agents;
    if (Array.isArray(agents)) {
      const first = agents[0];
      if (first && typeof first === "object") {
        const agent = first as Record<string, unknown>;
        agentName = asString(agent.agent_name) ?? asString(agent.agentName);
      }
    }
  }
  agentName = agentName ?? asString(obj.agent_name) ?? asString(obj.agentName);

  return {
    roomName: asString(obj.room_name) ?? asString(obj.roomName),
    participantIdentity: asString(obj.participant_identity) ?? asString(obj.participantIdentity),
    participantName: asString(obj.participant_name) ?? asString(obj.participantName),
    agentName,
  };
}

function defaultParticipantIdentity(): string {
  return readApiProcessConfig().demoUserId ?? "demo-user";
}

export async function registerLiveKitRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/livekit/connection-details",
    async (
      request: FastifyRequest<{ Body: unknown }>,
      reply,
    ): Promise<ConnectionDetailsResponse | { status: string; message: string; code: string }> => {
      let config: LiveKitConnectionConfig;
      try {
        config = readLiveKitConnectionConfig();
      } catch {
        reply.code(500);
        return {
          status: "error",
          message: "LiveKit is not configured for this server.",
          code: "livekit_not_configured",
        };
      }

      const body = normalizeConnectionDetailsRequest(request.body);
      const roomName = body.roomName ?? `nana-${randomUUID()}`;
      const participantIdentity = body.participantIdentity ?? defaultParticipantIdentity();
      const participantName = body.participantName ?? participantIdentity;
      const agentName = body.agentName ?? config.agentName;

      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity: participantIdentity,
        name: participantName,
      });
      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      // Explicit agent dispatch: the worker registers under `agentName`, so the
      // room join token must request the same agent for a local self-hosted server.
      const roomConfig = new RoomConfiguration();
      roomConfig.agents.push(new RoomAgentDispatch({ agentName }));
      token.roomConfig = roomConfig;

      const participantToken = await token.toJwt();

      return reply.send({
        server_url: config.url,
        participant_token: participantToken,
        room_name: roomName,
        participant_name: participantName,
      });
    },
  );
}
