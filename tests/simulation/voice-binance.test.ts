import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createWalletConversationService, type ConversationEvent } from '../../src/conversations/service.js';
import type { ConversationRepository } from '../../src/conversations/repository.js';
import type { ConversationSnapshot, ConversationState, WalletProgress } from '../../src/conversations/types.js';
import { FixtureWalletProvider } from '../../src/wallet/fixture-provider.js';
import type { WalletProvider } from '../../src/wallet/provider.js';

const modelUsage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function modelStep(
  content: Array<
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
    | { type: 'text'; text: string }
  >,
) {
  return {
    content,
    finishReason: {
      unified: content.some((part) => part.type === 'tool-call') ? 'tool-calls' as const : 'stop' as const,
      raw: undefined,
    },
    usage: modelUsage,
    warnings: [],
  };
}

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function repositoryFixture(): ConversationRepository {
  let snapshot: ConversationSnapshot = {
    id: conversationId,
    userId,
    mode: 'live',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    revision: 0,
    language: 'es',
    generation: 1,
    messages: [],
  };
  let transferStatus: 'previewed' | 'broadcasting' | 'submitted' | 'uncertain' | 'confirmed' | 'reverted' | 'receipt_invalid' | 'cancelled' | undefined;

  const repository = {
    async create() { return snapshot; },
    async get(requestUserId: string, id: string) {
      return requestUserId === userId && id === snapshot.id ? { ...snapshot, messages: [...snapshot.messages] } : undefined;
    },
    async inspect(requestUserId: string, id: string) { return this.get(requestUserId, id); },
    async appendMessage(_requestUserId: string, _id: string, message: ConversationSnapshot['messages'][number]) {
      snapshot.messages.push(message);
    },
    async saveSnapshot(_requestUserId: string, incoming: ConversationSnapshot, _count: number) {
      snapshot = {
        ...incoming,
        pendingTransfer: incoming.pendingTransfer
          ? { ...incoming.pendingTransfer, previewId: incoming.pendingTransfer.previewId ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
          : undefined,
        revision: incoming.revision + 1,
      };
      transferStatus = snapshot.pendingTransfer ? 'previewed' : transferStatus;
      return snapshot;
    },
    async updateState(_requestUserId: string, _id: string, _revision: number, state: ConversationState) {
      snapshot = { ...snapshot, ...state, revision: snapshot.revision + 1 };
      return snapshot;
    },
    async setProgress(_requestUserId: string, _id: string, progress: WalletProgress) {
      snapshot = { ...snapshot, progress, revision: snapshot.revision + 1 };
      return snapshot;
    },
    async setPendingTransfer(_requestUserId: string, _id: string, transfer: NonNullable<ConversationSnapshot['pendingTransfer']>) {
      snapshot = { ...snapshot, pendingTransfer: { ...transfer, previewId: transfer.previewId ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, revision: snapshot.revision + 1 };
      transferStatus = 'previewed';
      return snapshot;
    },
    async clearPendingTransfer() { transferStatus = 'cancelled'; snapshot = { ...snapshot, pendingTransfer: undefined, transferResolutionState: undefined, revision: snapshot.revision + 1 }; return snapshot; },
    async cancelPendingTransfer(_requestUserId: string, _id: string, previewId: string) {
      if (transferStatus !== 'previewed' || snapshot.pendingTransfer?.previewId !== previewId) return 'stale_preview' as const;
      transferStatus = 'cancelled';
      snapshot = { ...snapshot, pendingTransfer: undefined, revision: snapshot.revision + 1 };
      return 'cancelled' as const;
    },
    async claimPendingTransfer() {
      if (!snapshot.pendingTransfer) return { status: 'missing' as const };
      if (transferStatus === 'broadcasting') return { status: 'broadcasting' as const };
      if (transferStatus === 'uncertain') return { status: 'uncertain' as const };
      transferStatus = 'broadcasting';
      snapshot = { ...snapshot, transferResolutionState: 'broadcasting', revision: snapshot.revision + 1 };
      const claimedTransfer = snapshot.pendingTransfer;
      if (!claimedTransfer) return { status: 'missing' as const };
      return { status: 'claimed' as const, transfer: { ...claimedTransfer, previewId: claimedTransfer.previewId! } };
    },
    async releasePendingTransferClaim() { transferStatus = 'previewed'; snapshot = { ...snapshot, transferResolutionState: undefined }; },
    async markPendingTransferUncertain() { transferStatus = 'uncertain'; snapshot = { ...snapshot, transferResolutionState: 'uncertain', revision: snapshot.revision + 1 }; },
    async setLastTransactionHash(_requestUserId: string, _id: string, hash: string) { snapshot = { ...snapshot, lastTransactionHash: hash }; },
    async markTransferSubmitted(_requestUserId: string, _id: string, hash: string) { transferStatus = 'submitted'; snapshot = { ...snapshot, lastTransactionHash: hash, revision: snapshot.revision + 1 }; },
    async finalizeTransfer(_requestUserId: string, _id: string, result: { status: 'confirmed' | 'reverted' | 'receipt_invalid'; transactionHash: string }) {
      transferStatus = result.status;
      snapshot = { ...snapshot, pendingTransfer: undefined, transferResolutionState: undefined, lastTransactionHash: result.transactionHash, revision: snapshot.revision + 1 };
    },
    async setMode() { return snapshot.revision + 1; },
    async acquireLiveLease() { throw new Error('not used'); },
    async renewLiveLease() { return false; },
    async releaseLiveLease() { return false; },
  };

  return repository as unknown as ConversationRepository;
}

function walletFixture(): WalletProvider {
  return new FixtureWalletProvider();
}

async function turn(
  service: ReturnType<typeof createWalletConversationService>,
  text: string,
): Promise<ConversationEvent[]> {
  const result: ConversationEvent[] = [];
  for await (const event of service.handleTurnStream({ conversationId, userId, text })) result.push(event);
  return result;
}

function finalResult(events: ConversationEvent[]) {
  return events.find((event) => event.type === 'turn-completed')?.result;
}

describe('Binance voice end-to-end simulation', () => {
  const previousSource = process.env.BINANCE_TOOLS_SOURCE;
  const previousRuntime = process.env.AGENT_RUNTIME;

  beforeEach(() => {
    process.env.AGENT_RUNTIME = 'deterministic';
    process.env.BINANCE_TOOLS_SOURCE = 'fixture';
  });

  afterEach(() => {
    if (previousSource === undefined) delete process.env.BINANCE_TOOLS_SOURCE;
    else process.env.BINANCE_TOOLS_SOURCE = previousSource;
    if (previousRuntime === undefined) delete process.env.AGENT_RUNTIME;
    else process.env.AGENT_RUNTIME = previousRuntime;
  });

  it('runs the four demo steps through the voice loop', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        // Step 1: "¿cómo está el BTC?" -> market data
        modelStep([{ type: 'tool-call', toolCallId: 'quote', toolName: 'get_market_quote', input: JSON.stringify({ symbol: 'BTC' }) }]),
        modelStep([{ type: 'text', text: 'BTC está a $60.002,50.' }]),
        // Step 2: "comprá $50 de BNB" -> preview
        modelStep([{ type: 'tool-call', toolCallId: 'order', toolName: 'place_binance_order', input: JSON.stringify({ symbol: 'BNB', side: 'BUY', orderType: 'MARKET', quantity: '0.1', dryRun: true, idempotencyKey: 'demo-order-1' }) }]),
        modelStep([{ type: 'text', text: 'Preparé la compra de $50 de BNB. ¿Confirmás?' }]),
        // Step 3: "mandale $5.000 a Marcos" -> policy hold
        modelStep([{ type: 'tool-call', toolCallId: 'transfer', toolName: 'binance_internal_transfer', input: JSON.stringify({ asset: 'USDT', amount: '5000', from: 'spot', to: 'Marcos', dryRun: true, idempotencyKey: 'demo-transfer-1' }) }]),
        modelStep([{ type: 'text', text: 'No puedo hacer esa operación porque USDT no está en la lista permitida.' }]),
        // Step 4: "¿cuánto tengo?" -> balance
        modelStep([{ type: 'tool-call', toolCallId: 'balance', toolName: 'get_binance_balance', input: JSON.stringify({}) }]),
        modelStep([{ type: 'text', text: 'Tenés 10000 USDT, 0.5 BTC, 2 ETH y 10 BNB.' }]),
      ],
    });
    const service = createWalletConversationService({
      conversations: repositoryFixture(),
      wallet: walletFixture(),
      model,
    });

    // Step 1
    const step1 = await turn(service, '¿cómo está el BTC?');
    expect(finalResult(step1)).toMatchObject({ status: 'answer' });

    // Step 2 preview
    const step2 = await turn(service, 'comprá $50 de BNB');
    expect(finalResult(step2)).toMatchObject({ status: 'confirmation_required' });

    // Step 2 confirm (spoken confirmation by phrase)
    const step2Confirm = await turn(service, 'confirmo');
    expect(finalResult(step2Confirm)).toMatchObject({ status: 'sent' });

    // Step 3 hold
    const step3 = await turn(service, 'mandale $5.000 a Marcos');
    expect(finalResult(step3)).toMatchObject({ status: 'error', code: 'binance_policy_hold' });

        // Step 4 balance
        const step4 = await turn(service, '¿cuánto tengo?');
        expect(finalResult(step4)).toMatchObject({ status: 'answer' });
      });

      it('executes a confirmed Binance internal transfer through the voice loop', async () => {
        const model = new MockLanguageModelV3({
          doGenerate: [
            modelStep([{ type: 'tool-call', toolCallId: 'transfer', toolName: 'binance_internal_transfer', input: JSON.stringify({ asset: 'BNB', amount: '1', from: 'spot', to: 'funding', dryRun: true, idempotencyKey: 'demo-transfer-2' }) }]),
            modelStep([{ type: 'text', text: 'Preparé la transferencia de 1 BNB de spot a funding. ¿Confirmás?' }]),
          ],
        });
        const service = createWalletConversationService({
          conversations: repositoryFixture(),
          wallet: walletFixture(),
          model,
        });

        const preview = await turn(service, 'mandá 1 BNB de spot a funding');
        expect(finalResult(preview)).toMatchObject({ status: 'confirmation_required' });

        const confirm = await turn(service, 'confirmo');
        expect(finalResult(confirm)).toMatchObject({ status: 'sent' });
      });
    });
