import { afterEach, describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import { buildServer } from "../../src/server.js";

const original = {
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  DEMO_USER_ID: process.env.DEMO_USER_ID,
};

function setLiveKitEnv() {
  process.env.LIVEKIT_URL = "ws://localhost:7880";
  process.env.LIVEKIT_API_KEY = "devkey";
  process.env.LIVEKIT_API_SECRET = "devsecret";
  process.env.DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";
}

afterEach(() => {
  for (const key of Object.keys(original) as (keyof typeof original)[]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("POST /v1/livekit/connection-details", () => {
  it("returns the sandbox-shaped payload with an agent-dispatched token", async () => {
    setLiveKitEnv();
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/livekit/connection-details",
      payload: {
        room_name: "nani-abc",
        participant_identity: "11111111-1111-4111-8111-111111111111",
        room_config: { agents: [{ agent_name: "nani-agent" }] },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      server_url: string;
      participant_token: string;
      room_name: string;
      participant_name: string;
    };
    expect(body.server_url).toBe("ws://localhost:7880");
    expect(body.room_name).toBe("nani-abc");
    expect(body.participant_name).toBe("11111111-1111-4111-8111-111111111111");

    const payload = decodeJwt(body.participant_token);
    expect(payload.sub).toBe("11111111-1111-4111-8111-111111111111");
    expect(payload.video).toMatchObject({
      roomJoin: true,
      room: "nani-abc",
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const roomConfig = payload.roomConfig as { agents?: { agentName?: string }[] };
    expect(roomConfig.agents?.[0]?.agentName).toBe("nani-agent");
    await app.close();
  });

  it("applies defaults when the request omits room/agent/identity", async () => {
    setLiveKitEnv();
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/livekit/connection-details",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { room_name: string; participant_name: string };
    expect(body.room_name).toMatch(/^nana-/);
    expect(body.participant_name).toBe("11111111-1111-4111-8111-111111111111");
    await app.close();
  });

  it("fails closed when LiveKit credentials are missing", async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_URL;
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/livekit/connection-details",
      payload: {},
    });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { code: string }).code).toBe("livekit_not_configured");
    await app.close();
  });
});
