import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
  AgentSessionEventTypes,
  AutoSubscribe,
  cli,
  defineAgent,
  type JobContext,
  ServerOptions,
} from "@livekit/agents";
import {
  readLiveKitWorkerConfig,
  readWorkerProcessConfig,
  type LiveKitWorkerConfig,
  type WorkerProcessConfig,
} from "../config/process.js";
import { FinancialTaskRegistry } from "../conversations/financial-task-registry.js";
import { createWalletConversationService } from "../conversations/service.js";
import { createBinanceToolDependencies } from "../agent/binance-definition.js";
import { getConfiguredRecipientMemoryService } from "../memory/runtime.js";
import { createAgentSession } from "./create-agent-session.js";
import { createRealtimeTools } from "./realtime-tools/index.js";
import {
  createBindingRpcHandler,
  createRoomConversationGate,
  RoomConversation,
} from "./room-conversation.js";
import {
  createWorkerDependencies,
  type WorkerDependencies,
} from "../runtime/dependencies.js";

export { readLiveKitWorkerConfig } from "../config/process.js";
export type { LiveKitWorkerConfig } from "../config/process.js";

export function createLiveKitWorkerRuntime(input?: {
  dependencies?: WorkerDependencies;
  shutdownTimeoutMs?: number;
}) {
  let acceptingJobs = true;
  let closePromise: Promise<void> | undefined;
  const financialTasks =
    input?.dependencies?.financialTasks ?? new FinancialTaskRegistry();
  const shutdownTimeoutMs = input?.shutdownTimeoutMs ?? 10_000;
  return {
    financialTasks,
    get acceptingJobs() {
      return acceptingJobs;
    },
    async close() {
      if (closePromise) return closePromise;
      acceptingJobs = false;
      closePromise = (async () => {
        await financialTasks.drain({ timeoutMs: shutdownTimeoutMs });
        await input?.dependencies?.close();
      })();
      return closePromise;
    },
  };
}


/** Polls the room's remote participants until the given identity joins. Unlike
 * JobContext.waitForParticipant, this accepts AGENT-kind participants so the
 * programmatic E2E participant (rtc-node) can drive the voice flow. */
async function waitForParticipantByIdentity(room: { remoteParticipants: Map<string, { identity: string }> }, identity: string): Promise<{ identity: string }> {
  for (let i = 0; i < 240; i++) {
    const map = room.remoteParticipants as unknown as Map<string, { identity: string; kind?: unknown }>;
    if (!map || typeof map.values !== 'function') {
      console.error('[diag] seam: remoteParticipants shape:', typeof map, Object.keys(room as unknown as object).slice(0, 20).join(','));
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    if (i % 4 === 0) {
      const entries = [...map.values()].map((p) => `${p.identity}(${String(p.kind)})`);
      console.error('[diag] seam: participants so far:', entries.join(', ') || '(none)');
    }
    const found = [...map.values()].find((p) => p.identity === identity);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`E2E participant ${identity} did not join the room within the timeout.`);
}

async function runJob(
  ctx: JobContext,
  config: WorkerProcessConfig,
  dependencies: WorkerDependencies,
): Promise<void> {
  if (!config.publicKey)
    throw new Error("LiveKit worker requires LIVE_VOICE_BINDING_PUBLIC_KEY.");
  await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
  // Test seam: the programmatic voice E2E participant comes from @livekit/rtc-node,
  // which always advertises ParticipantKind.AGENT and would be filtered out by
  // waitForParticipant. NANA_VOICE_E2E_IDENTITY opts that named participant in
  // (explicit allowlist; production behavior unchanged when the env is unset).
  const e2eIdentity = process.env.NANA_VOICE_E2E_IDENTITY?.trim();
  const participant = e2eIdentity
    ? await waitForParticipantByIdentity(ctx.room, e2eIdentity)
    : await ctx.waitForParticipant();
  // Binance transport for the realtime voice loop. `createBinanceToolDependencies`
  // resolves the client/usage/config from the environment (fixture by default) and is
  // shared across every binding in this job. The read-only market tools use the client
  // directly; the money-moving tools go through the service's injected deps so policy
  // and confirmation are never bypassed.
  const binanceDeps = createBinanceToolDependencies();
  const roomConversation = new RoomConversation({
    publicKey: config.publicKey,
    conversations: dependencies.conversations,
    service: dependencies.conversationService,
  });
  const agentParticipant = ctx.agent;
  if (!agentParticipant)
    throw new Error("LiveKit agent participant is unavailable.");

  let session: ReturnType<typeof createAgentSession>["session"] | undefined;
  let sessionClosed: Promise<void> | undefined;
  let unsubscribeRevisions: (() => void) | undefined;
  const gate = createRoomConversationGate({
    conversation: roomConversation,
    startSession: async (binding) => {
      const memoryService = getConfiguredRecipientMemoryService();
      // REVIEW FIX V3 (voice path): the voice service is built per binding so its
      // recipient memory runtime scopes to `binding.sub` — never the demo tenant.
      // It shares the repository, wallet, and financialTasks with the worker so all
      // paths (voice tool, text transcript, touch button) arbitrate on the same
      // claim and emit revisions through the same frontend data topic.
      const voiceService = createWalletConversationService({
        conversations: dependencies.conversations,
        wallet: dependencies.wallet,
        ...(memoryService ? { memory: { userId: binding.userId, service: memoryService } } : {}),
        financialTasks: dependencies.financialTasks,
        contextRenewal: dependencies.contextRenewal,
        binanceDeps,
      });
      const tools = createRealtimeTools({
        conversationId: binding.conversationId,
        userId: binding.userId,
        wallet: dependencies.wallet,
        service: voiceService,
        conversations: dependencies.conversations,
        binance: binanceDeps.client,
        ...(memoryService ? { recipientMemory: memoryService } : {}),
      });
      const created = createAgentSession({ tools });
      unsubscribeRevisions = dependencies.financialTasks.subscribe((event) => {
        if (
          !event ||
          typeof event !== "object" ||
          (event as { type?: unknown }).type !== "state-revision"
        )
          return;
        const revision = (event as { revision?: unknown }).revision;
        if (typeof revision !== "number") return;
        void agentParticipant.publishData(
          new TextEncoder().encode(
            JSON.stringify({
              type: "conversation_state_changed",
              conversationId: binding.conversationId,
              revision,
            }),
          ),
          {
            reliable: true,
            topic: "conversation_state_changed",
            destination_identities: [participant.identity],
          },
        );
      });
      console.error('[diag] job entry: creating agent session');
      session = created.session;
      sessionClosed = new Promise<void>((resolve) =>
        created.session.once(AgentSessionEventTypes.Close, () => resolve()),
      );
      console.error('[diag] job entry: awaiting session.start (realtime connect to OpenAI)');
      await created.session.start({
        agent: created.agent,
        room: ctx.room,
        record: false,
      });
      agentParticipant.registerRpcMethod("interrupt_agent", async () => {
        await created.session?.interrupt({ force: true });
        return JSON.stringify({ ok: true });
      });
    },
  });
  let resolveBinding!: (result: Awaited<ReturnType<typeof gate.bind>>) => void;
  const bindingAccepted = new Promise<Awaited<ReturnType<typeof gate.bind>>>(
    (resolve) => {
      resolveBinding = resolve;
    },
  );

  agentParticipant.registerRpcMethod(
    "bind_conversation",
    createBindingRpcHandler({
      gate,
      workerId: ctx.workerId,
      onResult: resolveBinding,
    }),
  );

  const binding = await bindingAccepted;
  if (!binding.ok) {
    agentParticipant.unregisterRpcMethod("bind_conversation");
    await roomConversation.release();
    ctx.shutdown(`conversation binding failed: ${binding.code}`);
    return;
  }
  const leaseRenewal = setInterval(() => {
    void roomConversation.renew().catch(() => undefined);
  }, 10_000);
  ctx.addShutdownCallback(async () => {
    clearInterval(leaseRenewal);
    agentParticipant.unregisterRpcMethod("bind_conversation");
    agentParticipant.unregisterRpcMethod("interrupt_agent");
    unsubscribeRevisions?.();
    await session?.close();
    await roomConversation.release();
  });
  await sessionClosed;
}

const agent = defineAgent({
  entry: async (ctx) => {
    const config = readWorkerProcessConfig();
    const dependencies = createWorkerDependencies();
    const runtime = createLiveKitWorkerRuntime({
      dependencies,
      shutdownTimeoutMs: config.shutdownTimeoutMs,
    });
    ctx.addShutdownCallback(runtime.close);
    await runJob(ctx, config, dependencies);
  },
});

export default agent;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = readWorkerProcessConfig();
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      wsURL: config.url,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      // Explicit agent dispatch: the room join token requests `agentName`, so a
      // self-hosted LiveKit server must register the worker under the same name.
      agentName: config.agentName,
      drainTimeout: config.shutdownTimeoutMs,
      shutdownProcessTimeout: config.shutdownTimeoutMs,
    }),
  );
}
