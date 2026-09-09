import { tool } from "@livekit/agents";
import { z } from "zod";
import { getWalletAgentConfig } from "../../agent/instructions.js";
import {
  isBinanceTransportUnavailableError,
  binanceTransportUnavailableMessage,
  type BinanceOrderInput,
  type BinanceTransferInput,
} from "../../agent/binance-definition.js";
import type { BinanceClient } from "../../binance/client.js";
import { normalizeBinanceSymbol } from "../../binance/types.js";
import type { RecipientMemoryService, RecipientSearchResult } from "../../memory/service.js";
import type { RecipientCandidate } from "../../memory/types.js";
import type { WalletProvider } from "../../wallet/provider.js";
import type { ConversationRepository } from "../../conversations/repository.js";
import type { WalletConversationService } from "../../conversations/service.js";
import {
  isBinanceTransferPreview,
  type ConversationTurnResult,
} from "../../contracts/http.js";

/**
 * Dependencies used to build the realtime voice tools for a single conversation.
 *
 * `userId` is the binding user (`binding.sub`) — NEVER the demo-tenant singleton.
 * `recipientMemory` is a shared tenant-agnostic service; the tenant is scoped per
 * call by passing `userId` to `searchRecipients`. When memory is unavailable the
 * `search_contacts` tool fails closed to `unavailable` rather than inventing data.
 *
 * `service` is the per-binding conversation service built in the worker with the
 * binding user's memory runtime. The financial tools (`send_token`, `confirm_transfer`,
 * `cancel_transfer`, `place_binance_order`, `binance_internal_transfer`) are a door to
 * that service — they never reimplement guards. The service emits state revisions
 * through the shared `financialTasks`/progress publish path, so the frontend card
 * appears without any publish logic living in livekit.
 */
export type RealtimeToolsDependencies = {
  conversationId: string;
  userId: string;
  wallet: WalletProvider;
  recipientMemory?: RecipientMemoryService;
  service?: WalletConversationService;
  conversations?: ConversationRepository;
  /**
   * Binance transport for the read-only market tools (quote/balance/history).
   * The money-moving tools never read this: they go through the conversation
   * service's persisted preview/decision state so policy and confirmation are
   * never bypassed.
   */
  binance?: BinanceClient;
  /** Retained for seam stability; the service publishes revisions via financialTasks. */
  publishRevision?: (revision: number) => void;
};

/** A contact candidate exposed to the model — never contains address or userId. */
export type RealtimeContactCandidate = {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  version: number;
  status: "active" | "inactive";
  evidence: string;
  score: number;
};

export type RealtimeSearchContactsResult = {
  query: string;
  count: number;
  ambiguous: boolean;
  status: RecipientSearchResult["status"];
  contacts: RealtimeContactCandidate[];
};

export type RealtimeBalanceResult = {
  network: string;
  token: string;
  address: string;
  balance: string;
};

/**
 * A model-facing (address-free) financial tool result. The recipient address only ever
 * travels inside the service machinery; the model receives amount/token/status/message
 * plus typed errors it can narrate in plain Spanish. Binance previews carry
 * symbol/quantity/value/orderType (never a free-form address).
 */
export type RealtimeVoiceToolResult = {
  status: "confirmation_required" | "sent" | "cancelled" | "error";
  message: string;
  code?: string;
  amount?: string;
  token?: string;
  transactionHash?: string;
  symbol?: string;
  quantity?: string;
  value?: string;
  orderType?: "MARKET" | "LIMIT";
};

export type RealtimeBinanceMarketQuoteResult =
  | {
      status: "ok";
      symbol: string;
      bid: string;
      ask: string;
      last: string;
      timestamp: string;
    }
  | { status: "error"; code: "binance_unavailable"; message: string };

export type RealtimeBinanceBalanceEntry = {
  asset: string;
  free: string;
  locked: string;
  total: string;
};

export type RealtimeBinanceBalanceResult =
  | { status: "ok"; balances: RealtimeBinanceBalanceEntry[] }
  | { status: "error"; code: "binance_unavailable"; message: string };

export type RealtimeBinanceHistoryEntry = {
  id: string;
  type: string;
  asset: string;
  amount: string;
  status: string;
  timestamp: string;
  detail?: string;
};

export type RealtimeBinanceHistoryResult =
  | { status: "ok"; entries: RealtimeBinanceHistoryEntry[] }
  | { status: "error"; code: "binance_unavailable"; message: string };

const BINANCE_UNAVAILABLE_MESSAGE = "Binance is unavailable.";

/**
 * REVIEW FIX V6: the voice `send_token` schema is preview-only and enforced by zod.
 * It accepts ONLY `{ amount, recipientId, recipientVersion, memo? }` — no `dryRun`,
 * no free-form `to` address, no network/token/wallet (the configured wallet is used
 * internally). `.strict()` rejects any unknown field so a model inventing a `to` or
 * a `dryRun` flag fails closed at the schema boundary, never reaching the service.
 */
const sendTokenSchema = z
  .object({
    amount: z.string().trim().min(1),
    recipientId: z.string().trim().min(1),
    recipientVersion: z.number().int().positive(),
    memo: z.string().trim().max(200).optional(),
  })
  .strict();
type SendTokenInput = z.infer<typeof sendTokenSchema>;

const confirmationSchema = z.object({}).strict();
const cancelSchema = z.object({}).strict();

/**
 * The Binance money-moving voice tools are preview-only at the schema boundary, exactly
 * like `send_token`. The model can only express the operation shape — it can never invent
 * a `dryRun` flag or an `idempotencyKey`, both of which are owned by the service machinery
 * at preview time. `.strict()` rejects those and any other unknown field so a model that
 * tries to force an execution bypass fails closed before reaching the service.
 */
const placeBinanceOrderSchema = z
  .object({
    symbol: z.string().trim().min(1),
    side: z.enum(["BUY", "SELL"]),
    orderType: z.enum(["MARKET", "LIMIT"]),
    quantity: z.string().trim().min(1),
    price: z.string().trim().min(1).optional(),
  })
  .strict();
type PlaceBinanceOrderInput = z.infer<typeof placeBinanceOrderSchema>;

const binanceInternalTransferSchema = z
  .object({
    asset: z.string().trim().min(1),
    amount: z.string().trim().min(1),
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
  })
  .strict();
type BinanceInternalTransferInput = z.infer<typeof binanceInternalTransferSchema>;

const marketQuoteSchema = z
  .object({
    symbol: z.string().trim().min(1),
  })
  .strict();

const binanceBalanceSchema = z
  .object({
    asset: z.string().trim().min(1).optional(),
  })
  .strict();

const binanceHistorySchema = z
  .object({
    asset: z.string().trim().min(1).optional(),
  })
  .strict();

/**
 * Deliberately strips every field that could leak a payee address or another user's
 * identity. `RecipientCandidate` already omits `address`/`userId`, but rebuilding the
 * object here keeps the model-facing payload contract explicit and future-proof: if a
 * candidate ever grows a sensitive field it will not leak unless added here on purpose.
 */
function stripCandidate(candidate: RecipientCandidate): RealtimeContactCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    normalizedName: candidate.normalizedName,
    description: candidate.description,
    version: candidate.version,
    status: candidate.status,
    evidence: candidate.evidence,
    score: candidate.score,
  };
}

/** Map the service classification faithfully onto the model-facing result shape. */
function toSearchContactsResult(
  query: string,
  result: RecipientSearchResult,
): RealtimeSearchContactsResult {
  if (result.status === "unavailable") {
    return { query, count: 0, ambiguous: false, status: "unavailable", contacts: [] };
  }
  const contacts = result.candidates.map(stripCandidate);
  return {
    query,
    count: contacts.length,
    ambiguous: result.status === "clarification_required",
    status: result.status,
    contacts,
  };
}

/**
 * Map a service `ConversationTurnResult` onto an address-free tool result. The
 * `preview.recipient` address is deliberately dropped: the model never needs it and
 * the privacy invariant keeps the address book inside the machinery. A Binance venue
 * preview is mapped to symbol/quantity/value/orderType (never an address).
 */
function toVoiceToolResult(result: ConversationTurnResult): RealtimeVoiceToolResult {
  switch (result.status) {
    case "confirmation_required": {
      if (isBinanceTransferPreview(result.preview)) {
        return {
          status: "confirmation_required",
          message: result.message,
          symbol: result.preview.symbol,
          quantity: result.preview.quantity,
          value: result.preview.value,
          orderType: result.preview.orderType,
        };
      }
      return {
        status: "confirmation_required",
        message: result.message,
        amount: result.preview.amount,
        token: result.preview.token,
      };
    }
    case "sent":
      return {
        status: "sent",
        message: result.message,
        transactionHash: result.transaction?.transactionHash,
      };
    case "cancelled":
      return { status: "cancelled", message: result.message };
    case "error":
      return { status: "error", code: result.code, message: result.message };
    default:
      return {
        status: "error",
        code: "internal_error",
        message: result.message,
      };
  }
}

/**
 * Builds the realtime voice tools bound to one conversation. Tools are closures over
 * the deps so each room gets the correct wallet/tenant/service without global lookups.
 */
export function createRealtimeTools(dependencies: RealtimeToolsDependencies) {
  const config = getWalletAgentConfig();

  const getBalanceTool = tool({
    name: "get_balance",
    description:
      "Returns the current balance of the connected wallet for the default token. Takes no input.",
    parameters: z.object({}),
    execute: async (): Promise<RealtimeBalanceResult> => {
      const balance = await dependencies.wallet.getBalance({
        network: config.network,
        token: config.token,
        wallet: config.wallet,
      });
      return {
        network: balance.network,
        token: balance.token ?? config.token,
        address: balance.address,
        balance: balance.balance,
      };
    },
  });

  const searchContactsTool = tool({
    name: "search_contacts",
    description:
      "Searches saved contacts by name. Returns matching candidates (never addresses), a count, and a status. Ask for clarification when ambiguous.",
    parameters: z.object({ query: z.string().trim().min(1) }),
    execute: async ({ query }): Promise<RealtimeSearchContactsResult> => {
      if (!dependencies.recipientMemory) {
        return {
          query,
          count: 0,
          ambiguous: false,
          status: "unavailable",
          contacts: [],
        };
      }
      const result = await dependencies.recipientMemory.searchRecipients(
        dependencies.userId,
        query,
      );
      return toSearchContactsResult(query, result);
    },
  });

  const sendTokenTool = tool({
    name: "send_token",
    description:
      "Prepares a transfer for explicit user confirmation. Takes the amount and the already-resolved recipient (recipientId + recipientVersion). Never takes an address, network, token, or dryRun. After the user agrees, call confirm_transfer.",
    parameters: sendTokenSchema,
    execute: async (input: SendTokenInput): Promise<RealtimeVoiceToolResult> => {
      if (!dependencies.service) {
        return {
          status: "error",
          code: "wallet_unavailable",
          message: "The wallet service is unavailable.",
        };
      }
      const result = await dependencies.service.previewTransfer({
        conversationId: dependencies.conversationId,
        userId: dependencies.userId,
        amount: input.amount,
        recipientId: input.recipientId,
        recipientVersion: input.recipientVersion,
      });
      return toVoiceToolResult(result);
    },
  });

  async function decideTransfer(
    decision: "confirm" | "cancel",
  ): Promise<RealtimeVoiceToolResult> {
    if (!dependencies.service || !dependencies.conversations) {
      return {
        status: "error",
        code: "wallet_unavailable",
        message: "The wallet service is unavailable.",
      };
    }
    // REVIEW FIX V1: read the CURRENT persisted preview each call — never capture it
    // at bind time, so a superseded/cancelled preview fails closed to stale_preview.
    const snapshot = await dependencies.conversations.get(
      dependencies.userId,
      dependencies.conversationId,
    );
    const previewId = snapshot?.pendingTransfer?.previewId;
    if (!previewId) {
      return {
        status: "error",
        code: "stale_preview",
        message: "There is no pending transfer to confirm or cancel.",
      };
    }
    let result: ConversationTurnResult | undefined;
    const iterable = dependencies.service.resolveDecision({
      conversationId: dependencies.conversationId,
      userId: dependencies.userId,
      previewId,
      decision,
      waitForFinancialTask: decision === "confirm",
    });
    for await (const event of iterable) {
      if (event.type === "turn-completed") result = event.result;
    }
    if (!result) {
      return {
        status: "error",
        code: "internal_error",
        message: "The transfer could not be resolved.",
      };
    }
    return toVoiceToolResult(result);
  }

  const confirmTransferTool = tool({
    name: "confirm_transfer",
    description:
      "Confirms the transfer currently awaiting the user's decision. Takes no parameters. Call ONLY after the user explicitly agrees.",
    parameters: confirmationSchema,
    execute: async (): Promise<RealtimeVoiceToolResult> => decideTransfer("confirm"),
  });

  const cancelTransferTool = tool({
    name: "cancel_transfer",
    description:
      "Cancels the transfer currently awaiting the user's decision. Takes no parameters. Call when the user wants to cancel.",
    parameters: cancelSchema,
    execute: async (): Promise<RealtimeVoiceToolResult> => decideTransfer("cancel"),
  });

  const getMarketQuoteTool = tool({
    name: "get_market_quote",
    description:
      "Reads a live Binance market quote (bid, ask, last) for a base asset. Returns the normalized symbol. Fails closed to binance_unavailable when the Binance transport is not configured or unavailable.",
    parameters: marketQuoteSchema,
    execute: async ({ symbol }): Promise<RealtimeBinanceMarketQuoteResult> => {
      if (!dependencies.binance) {
        return { status: "error", code: "binance_unavailable", message: BINANCE_UNAVAILABLE_MESSAGE };
      }
      try {
        const quote = await dependencies.binance.getMarketQuote(normalizeBinanceSymbol(symbol));
        return {
          status: "ok",
          symbol: quote.symbol,
          bid: quote.bid,
          ask: quote.ask,
          last: quote.last,
          timestamp: quote.timestamp,
        };
      } catch (error) {
        if (isBinanceTransportUnavailableError(error)) {
          return {
            status: "error",
            code: "binance_unavailable",
            message: binanceTransportUnavailableMessage(error),
          };
        }
        return { status: "error", code: "binance_unavailable", message: BINANCE_UNAVAILABLE_MESSAGE };
      }
    },
  });

  const getBinanceBalanceTool = tool({
    name: "get_binance_balance",
    description:
      "Reads Binance balances, optionally filtered to one asset. Fails closed to binance_unavailable when the Binance transport is not configured or unavailable.",
    parameters: binanceBalanceSchema,
    execute: async ({ asset }): Promise<RealtimeBinanceBalanceResult> => {
      if (!dependencies.binance) {
        return { status: "error", code: "binance_unavailable", message: BINANCE_UNAVAILABLE_MESSAGE };
      }
      try {
        const balances = await dependencies.binance.getBalance(
          asset ? normalizeBinanceSymbol(asset) : undefined,
        );
        return { status: "ok", balances };
      } catch (error) {
        if (isBinanceTransportUnavailableError(error)) {
          return {
            status: "error",
            code: "binance_unavailable",
            message: binanceTransportUnavailableMessage(error),
          };
        }
        return { status: "error", code: "binance_unavailable", message: BINANCE_UNAVAILABLE_MESSAGE };
      }
    },
  });

  const getBinanceHistoryTool = tool({
    name: "get_binance_history",
    description:
      "Reads Binance order and transfer history, optionally filtered to one asset. Fails closed to binance_unavailable when the Binance transport is not configured or unavailable.",
    parameters: binanceHistorySchema,
    execute: async ({ asset }): Promise<RealtimeBinanceHistoryResult> => {
      if (!dependencies.binance) {
        return { status: "error", code: "binance_unavailable", message: BINANCE_UNAVAILABLE_MESSAGE };
      }
      try {
        const entries = await dependencies.binance.getHistory(
          asset ? normalizeBinanceSymbol(asset) : undefined,
        );
        return { status: "ok", entries };
      } catch (error) {
        if (isBinanceTransportUnavailableError(error)) {
          return {
            status: "error",
            code: "binance_unavailable",
            message: binanceTransportUnavailableMessage(error),
          };
        }
        return { status: "error", code: "binance_unavailable", message: BINANCE_UNAVAILABLE_MESSAGE };
      }
    },
  });

  const placeBinanceOrderTool = tool({
    name: "place_binance_order",
    description:
      "Prepares a Binance spot order for explicit user confirmation. Takes the order shape (symbol, side, orderType, quantity, optional price). Never takes dryRun or an idempotency key — both are owned by the service. After the user agrees, call confirm_transfer.",
    parameters: placeBinanceOrderSchema,
    execute: async (input: PlaceBinanceOrderInput): Promise<RealtimeVoiceToolResult> => {
      if (!dependencies.service) {
        return {
          status: "error",
          code: "wallet_unavailable",
          message: "The wallet service is unavailable.",
        };
      }
      const orderInput: BinanceOrderInput = {
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        quantity: input.quantity,
        ...(input.price !== undefined ? { price: input.price } : {}),
        dryRun: true,
        idempotencyKey: crypto.randomUUID(),
      };
      const result = await dependencies.service.previewBinance({
        conversationId: dependencies.conversationId,
        userId: dependencies.userId,
        input: orderInput,
      });
      return toVoiceToolResult(result);
    },
  });

  const binanceInternalTransferTool = tool({
    name: "binance_internal_transfer",
    description:
      "Prepares a Binance internal asset transfer for explicit user confirmation. Takes the transfer shape (asset, amount, from, to). Never takes dryRun or an idempotency key — both are owned by the service. After the user agrees, call confirm_transfer.",
    parameters: binanceInternalTransferSchema,
    execute: async (input: BinanceInternalTransferInput): Promise<RealtimeVoiceToolResult> => {
      if (!dependencies.service) {
        return {
          status: "error",
          code: "wallet_unavailable",
          message: "The wallet service is unavailable.",
        };
      }
      const transferInput: BinanceTransferInput = {
        asset: input.asset,
        amount: input.amount,
        from: input.from,
        to: input.to,
        dryRun: true,
        idempotencyKey: crypto.randomUUID(),
      };
      const result = await dependencies.service.previewBinance({
        conversationId: dependencies.conversationId,
        userId: dependencies.userId,
        input: transferInput,
      });
      return toVoiceToolResult(result);
    },
  });

  return [
    getBalanceTool,
    searchContactsTool,
    sendTokenTool,
    confirmTransferTool,
    cancelTransferTool,
    getMarketQuoteTool,
    getBinanceBalanceTool,
    getBinanceHistoryTool,
    placeBinanceOrderTool,
    binanceInternalTransferTool,
  ] as const;
}
