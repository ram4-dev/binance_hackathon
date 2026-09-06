import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getBalance = vi.fn(async () => ({
    network: "sepolia",
    token: "USDT",
    address: "0x1234000000000000000000000000000000abcd",
    balance: "42.5",
  }));
  return {
    getBalance,
  };
});

vi.mock("@livekit/agents", () => ({
  tool: (def: Record<string, unknown>) => ({ type: "function", ...def }),
}));

import { createRealtimeTools } from "../../src/livekit/realtime-tools/index.js";
import type { RealtimeSearchContactsResult, RealtimeVoiceToolResult } from "../../src/livekit/realtime-tools/index.js";
import { McpToolUnavailableError } from "../../src/binance/mcp-remote-client.js";
import type { RecipientSearchResult } from "../../src/memory/service.js";

type SearchContactsExecute = (input: { query: string }) => Promise<RealtimeSearchContactsResult>;

type FinancialTool = {
  name: string;
  parameters: { parse(input: unknown): unknown; safeParse(input: unknown): { success: boolean } };
  execute: (input: unknown) => Promise<RealtimeVoiceToolResult>;
};

function financialTool(toolDef: unknown, index: number): FinancialTool {
  const name = (toolDef as unknown as { name?: string }).name;
  if (name !== "send_token" && name !== "confirm_transfer" && name !== "cancel_transfer")
    throw new Error(`test expected a financial tool at ${index}, got ${String(name)}`);
  const def = (toolDef as unknown as { parameters: FinancialTool["parameters"]; execute: FinancialTool["execute"] });
  return { name, parameters: def.parameters, execute: def.execute };
}

function toolByName(
  tools: ReturnType<typeof createRealtimeTools>,
  name: string,
): { name: string; parameters: { parse(input: unknown): unknown; safeParse(input: unknown): { success: boolean } }; execute: (input: unknown) => Promise<unknown> } {
  const tool = tools.find((entry) => (entry as { name?: string }).name === name);
  if (!tool) throw new Error(`test expected tool ${name}, but it was not declared`);
  return tool as unknown as { name: string; parameters: { parse(input: unknown): unknown; safeParse(input: unknown): { success: boolean } }; execute: (input: unknown) => Promise<unknown> };
}

describe("createRealtimeTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WDK_WALLET_NAME;
    delete process.env.WDK_NETWORK;
    delete process.env.WDK_TOKEN;
  });

  it("get_balance returns the provider balance with an empty parameters schema", async () => {
    const wallet = { getBalance: h.getBalance } as never;
    const [getBalanceTool] = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet,
    });

    // Explicit empty params: the schema accepts {} and requires nothing.
    expect(getBalanceTool.name).toBe("get_balance");
    const params = (getBalanceTool as unknown as { parameters: { parse(input: unknown): unknown } })
      .parameters;
    expect(params).toBeDefined();
    expect(params.parse({})).toEqual({});

    const result = await (getBalanceTool.execute as unknown as (input: unknown) => Promise<{ balance: string }>)({});

    expect(h.getBalance).toHaveBeenCalledWith({
      network: "sepolia",
      token: "USDT",
      wallet: "agent-demo",
    });
    expect(result).toMatchObject({
      network: "sepolia",
      token: "USDT",
      balance: "42.5",
    });
  });

  it("search_contacts strips address/userId and flags an ambiguous query", async () => {
    const searchRecipients = vi.fn(async (): Promise<RecipientSearchResult> => {
      return {
        status: "clarification_required",
        candidates: [
          {
            id: "c-1",
            name: "Lucas Gutiérrez",
            normalizedName: "lucas gutiérrez",
            description: "Amigo del equipo",
            version: 3,
            status: "active",
            embeddingModelRevision: "rev",
            evidence: "Lucas",
            score: 0.9,
            address: "0x1111111111111111111111111111111111111111",
            userId: "leaked-tenant",
          },
          {
            id: "c-2",
            name: "Lucas Herrera",
            normalizedName: "lucas herrera",
            description: "Contador",
            version: 1,
            status: "active",
            embeddingModelRevision: "rev",
            evidence: "Lucas",
            score: 0.85,
            address: "0x2222222222222222222222222222222222222222",
            userId: "leaked-tenant",
          },
        ] as never,
      };
    });
    const recipientMemory = { searchRecipients } as never;
    const [, searchContactsTool] = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      recipientMemory,
    });

    const result = await (
      searchContactsTool.execute as SearchContactsExecute
    )({ query: "Lucas" });

    expect(searchRecipients).toHaveBeenCalledWith("binding-user", "Lucas");
    expect(result).toMatchObject({
      query: "Lucas",
      count: 2,
      ambiguous: true,
      status: "clarification_required",
    });
    expect(result.contacts).toHaveLength(2);
    for (const contact of result.contacts) {
      expect(contact).not.toHaveProperty("address");
      expect(contact).not.toHaveProperty("userId");
      expect(contact).toHaveProperty("name");
      expect(contact).toHaveProperty("id");
    }
  });

  it("search_contacts reports a single resolved match as non-ambiguous", async () => {
    const searchRecipients = vi.fn(async (): Promise<RecipientSearchResult> => {
      return {
        status: "resolved",
        candidates: [
          {
            id: "c-3",
            name: "Ana Fernández",
            normalizedName: "ana fernández",
            description: "Trade partner",
            version: 1,
            status: "active",
            embeddingModelRevision: "rev",
            evidence: "Ana",
            score: 0.97,
          },
        ],
        recipient: {
          id: "c-3",
          name: "Ana Fernández",
          normalizedName: "ana fernández",
          description: "Trade partner",
          version: 1,
          status: "active",
          embeddingModelRevision: "rev",
          evidence: "Ana",
          score: 0.97,
        },
      };
    });
    const recipientMemory = { searchRecipients } as never;
    const [, searchContactsTool] = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      recipientMemory,
    });

    const result = await (
      searchContactsTool.execute as SearchContactsExecute
    )({ query: "Ana" });

    expect(result).toMatchObject({
      count: 1,
      ambiguous: false,
      status: "resolved",
    });
    expect(result.contacts[0]).not.toHaveProperty("address");
    expect(result.contacts[0]).not.toHaveProperty("userId");
  });

  it("scopes searchRecipients to the binding userId, never the demo tenant", async () => {
    const searchRecipients = vi.fn(async (): Promise<RecipientSearchResult> => {
      return { status: "no_match", candidates: [] };
    });
    const recipientMemory = { searchRecipients } as never;
    const [, searchContactsTool] = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-sub-uuid",
      wallet: {} as never,
      recipientMemory,
    });

    await (searchContactsTool.execute as SearchContactsExecute)({ query: "Lucas" });

    expect(searchRecipients).toHaveBeenCalledWith("binding-sub-uuid", "Lucas");
    expect(searchRecipients).not.toHaveBeenCalledWith(
      expect.stringMatching(/demo/i),
      expect.anything(),
    );
  });

  it("search_contacts fails closed to unavailable without a memory service", async () => {
    const [, searchContactsTool] = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
    });

    const result = await (
      searchContactsTool.execute as SearchContactsExecute
    )({ query: "Nadie" });

    expect(result).toEqual({
      query: "Nadie",
      count: 0,
      ambiguous: false,
      status: "unavailable",
      contacts: [],
    });
  });

  it("rejects send_token dryRun and a free-form `to` at the schema boundary (V6)", () => {
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
    });
    const sendToken = financialTool(tools[2], 2);

    // Preview-only accepts exactly amount/recipientId/recipientVersion(+memo).
    expect(sendToken.parameters.parse({ amount: "10", recipientId: "c-1", recipientVersion: 2 })).toBeTruthy();
    // dryRun is a leftover broadcast flag that must never reach the service.
    expect(sendToken.parameters.safeParse({ amount: "10", recipientId: "c-1", recipientVersion: 2, dryRun: false }).success).toBe(false);
    // a free-form `to` address is forbidden; recipients resolve by id/version only.
    expect(sendToken.parameters.safeParse({ amount: "10", recipientId: "c-1", recipientVersion: 2, to: "0x1234" }).success).toBe(false);
    expect(sendToken.parameters.safeParse({ amount: "10", recipientId: "c-1", recipientVersion: -1 }).success).toBe(false);
  });

  it("send_token delegates the preview to the service and strips the recipient address", async () => {
    const service = {
      previewTransfer: vi.fn().mockResolvedValue({
status: "confirmation_required",
message: "Preparé una transferencia de 10 USDT para Lucas. Confirmá para continuar.",
preview: { network: "sepolia", token: "USDT", recipient: "0xsecret", amount: "10", estimatedFee: "0.0003 ETH" },
      }),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      service,
    } as never);
    const sendToken = financialTool(tools[2], 2);

    const result = await sendToken.execute({ amount: "10", recipientId: "c-1", recipientVersion: 2 });

    expect(service.previewTransfer).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conv-1",
      userId: "binding-user",
      amount: "10",
      recipientId: "c-1",
      recipientVersion: 2,
    }));
    expect(result.status).toBe("confirmation_required");
    expect(result.amount).toBe("10");
    expect(result.token).toBe("USDT");
    expect(result).not.toHaveProperty("recipient");
    expect(result).not.toHaveProperty("address");
  });

  it("confirm_transfer reads the current preview and delegates to resolveDecision (V1)", async () => {
    const conversations = {
      get: vi.fn().mockResolvedValue({ pendingTransfer: { previewId: "preview-abc" } }),
    };
    const service = {
      resolveDecision: vi.fn(async function* () {
yield { type: "turn-completed", result: { status: "sent", message: "Transfer confirmed.", transaction: { transactionHash: "0xabc" } } };
      }),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      conversations,
      service,
    } as never);
    const confirm = financialTool(tools[3], 3);

    const result = await confirm.execute({});

    expect(conversations.get).toHaveBeenCalledWith("binding-user", "conv-1");
    expect(service.resolveDecision).toHaveBeenCalledWith(expect.objectContaining({
      previewId: "preview-abc",
      decision: "confirm",
      waitForFinancialTask: true,
    }));
    expect(result).toMatchObject({ status: "sent", transactionHash: "0xabc" });
  });

  it("confirm_transfer fails closed to stale_preview with no pending preview", async () => {
    const conversations = { get: vi.fn().mockResolvedValue({}) };
    const service = { resolveDecision: vi.fn() };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      conversations,
      service,
    } as never);
    const confirm = financialTool(tools[3], 3);

    const result = await confirm.execute({});

    expect(result).toMatchObject({ status: "error", code: "stale_preview" });
    expect(service.resolveDecision).not.toHaveBeenCalled();
  });

  it("cancel_transfer delegates to resolveDecision with decision cancel (V1)", async () => {
    const conversations = {
      get: vi.fn().mockResolvedValue({ pendingTransfer: { previewId: "preview-abc" } }),
    };
    const service = {
      resolveDecision: vi.fn(async function* () {
yield { type: "turn-completed", result: { status: "cancelled", message: "Transfer cancelled." } };
      }),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      conversations,
      service,
    } as never);
    const cancel = financialTool(tools[4], 4);

    const result = await cancel.execute({});

    expect(service.resolveDecision).toHaveBeenCalledWith(expect.objectContaining({
      previewId: "preview-abc",
      decision: "cancel",
    }));
    expect(result).toMatchObject({ status: "cancelled" });
  });
});

describe("createRealtimeTools — Binance tools", () => {
  it("declares the five Binance tools with strict schemas", () => {
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
    });
    const names = tools.map((entry) => (entry as { name: string }).name);
    for (const name of [
      "get_market_quote",
      "get_binance_balance",
      "place_binance_order",
      "get_binance_history",
      "binance_internal_transfer",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("place_binance_order previews through the service and exposes symbol/quantity/value/orderType", async () => {
    const service = {
      previewBinance: vi.fn().mockResolvedValue({
status: "confirmation_required",
message: "Preparé la compra de 0.001 BTC. Confirmá para continuar.",
preview: { venue: "binance", symbol: "BTC", quantity: "0.001", value: "60.005", orderType: "MARKET" },
      }),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      service,
    } as never);
    const order = toolByName(tools, "place_binance_order");

    const result = await order.execute({
      symbol: "BTC",
      side: "BUY",
      orderType: "MARKET",
      quantity: "0.001",
    });

    expect(service.previewBinance).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conv-1",
      userId: "binding-user",
      input: expect.objectContaining({
symbol: "BTC",
side: "BUY",
orderType: "MARKET",
quantity: "0.001",
dryRun: true,
      }),
    }));
    expect(result).toMatchObject({
      status: "confirmation_required",
      symbol: "BTC",
      quantity: "0.001",
      value: "60.005",
      orderType: "MARKET",
    });
  });

  it("place_binance_order rejects a model-invented dryRun at the schema boundary", () => {
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
    });
    const order = toolByName(tools, "place_binance_order");
    expect(order.parameters.safeParse({
      symbol: "BTC",
      side: "BUY",
      orderType: "MARKET",
      quantity: "0.001",
      dryRun: true,
    }).success).toBe(false);
    expect(order.parameters.safeParse({
      symbol: "BTC",
      side: "BUY",
      orderType: "MARKET",
      quantity: "0.001",
      idempotencyKey: "model-key",
    }).success).toBe(false);
  });

  it("binance_internal_transfer previews through the service", async () => {
    const service = {
      previewBinance: vi.fn().mockResolvedValue({
status: "confirmation_required",
message: "Preparé la transferencia de 1 BTC. Confirmá para continuar.",
preview: { venue: "binance", symbol: "BTC", quantity: "1", value: "1" },
      }),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      service,
    } as never);
    const transfer = toolByName(tools, "binance_internal_transfer");

    const result = await transfer.execute({
      asset: "BTC",
      amount: "1",
      from: "spot",
      to: "funding",
    });

    expect(service.previewBinance).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
asset: "BTC",
amount: "1",
from: "spot",
to: "funding",
dryRun: true,
      }),
    }));
    expect(result).toMatchObject({ status: "confirmation_required", symbol: "BTC", quantity: "1", value: "1" });
  });

  it("binance_internal_transfer surfaces a typed unavailable when the service reports it", async () => {
    const service = {
      previewBinance: vi.fn().mockResolvedValue({
status: "error",
code: "binance_unavailable",
message: "Binance internal transfer is not available in the granted scopes.",
      }),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      service,
    } as never);
    const transfer = toolByName(tools, "binance_internal_transfer");

    const result = await transfer.execute({
      asset: "BTC",
      amount: "1",
      from: "spot",
      to: "funding",
    });

    expect(result).toMatchObject({ status: "error", code: "binance_unavailable" });
  });

  it("get_market_quote returns the quote and normalizes the symbol", async () => {
    const binance = {
      getMarketQuote: vi.fn().mockResolvedValue({
symbol: "BTC",
bid: "60000.00",
ask: "60005.00",
last: "60002.50",
timestamp: "2026-01-01T00:00:00.000Z",
      }),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      binance,
    } as never);
    const quote = toolByName(tools, "get_market_quote");

    const result = await quote.execute({ symbol: "btc" });

    expect(binance.getMarketQuote).toHaveBeenCalledWith("BTC");
    expect(result).toMatchObject({ status: "ok", symbol: "BTC", bid: "60000.00", ask: "60005.00", last: "60002.50" });
  });

  it("get_market_quote fails closed to binance_unavailable without a client", async () => {
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
    });
    const quote = toolByName(tools, "get_market_quote");

    const result = await quote.execute({ symbol: "BTC" });

    expect(result).toMatchObject({ status: "error", code: "binance_unavailable" });
  });

  it("get_binance_balance returns balances and get_binance_history returns entries", async () => {
    const binance = {
      getBalance: vi.fn().mockResolvedValue([{ asset: "USDT", free: "10000", locked: "0", total: "10000" }]),
      getHistory: vi.fn().mockResolvedValue([{ id: "h-1", type: "order", asset: "BTC", amount: "0.01", status: "FILLED", timestamp: "t" }]),
    };
    const tools = createRealtimeTools({
      conversationId: "conv-1",
      userId: "binding-user",
      wallet: {} as never,
      binance,
    } as never);
    const balance = toolByName(tools, "get_binance_balance");
    const history = toolByName(tools, "get_binance_history");

    const balanceResult = await balance.execute({});
    const historyResult = await history.execute({});

        expect(balanceResult).toMatchObject({ status: "ok", balances: [{ asset: "USDT", free: "10000" }] });
        expect(historyResult).toMatchObject({ status: "ok", entries: [{ id: "h-1", asset: "BTC" }] });
      });

      it("place_binance_order surfaces a policy hold (symbol outside allowlist) with the spoken explanation", async () => {
        const service = {
          previewBinance: vi.fn().mockResolvedValue({
            status: "error",
            code: "binance_policy_hold",
            message: "BTC no está en la lista permitida de símbolos.",
          }),
        };
        const tools = createRealtimeTools({
          conversationId: "conv-1",
          userId: "binding-user",
          wallet: {} as never,
          service,
        } as never);
        const order = toolByName(tools, "place_binance_order");

        const result = await order.execute({
          symbol: "BTC",
          side: "BUY",
          orderType: "MARKET",
          quantity: "0.001",
        });

        expect(result).toMatchObject({
          status: "error",
          code: "binance_policy_hold",
          message: "BTC no está en la lista permitida de símbolos.",
        });
      });

      it("place_binance_order surfaces a per-order cap rejection as a policy hold", async () => {
        const service = {
          previewBinance: vi.fn().mockResolvedValue({
            status: "error",
            code: "binance_policy_hold",
            message: "La operación supera el límite diario permitido.",
          }),
        };
        const tools = createRealtimeTools({
          conversationId: "conv-1",
          userId: "binding-user",
          wallet: {} as never,
          service,
        } as never);
        const order = toolByName(tools, "place_binance_order");

        const result = await order.execute({
          symbol: "BTC",
          side: "BUY",
          orderType: "MARKET",
          quantity: "100",
        });

        expect(result).toMatchObject({ status: "error", code: "binance_policy_hold" });
      });

      it("place_binance_order fails closed to wallet_unavailable when no service is bound (never executes directly)", async () => {
        const tools = createRealtimeTools({
          conversationId: "conv-1",
          userId: "binding-user",
          wallet: {} as never,
        });
        const order = toolByName(tools, "place_binance_order");

        const result = await order.execute({
          symbol: "BTC",
          side: "BUY",
          orderType: "MARKET",
          quantity: "0.001",
        });

        expect(result).toMatchObject({ status: "error", code: "wallet_unavailable" });
      });

      it("get_market_quote surfaces a typed transport unavailable from the client", async () => {
        const unavailable = new McpToolUnavailableError("getMarketQuote", ["spot.ticker24hr"], []);
        const binance = {
          getMarketQuote: vi.fn().mockRejectedValue(unavailable),
        };
        const tools = createRealtimeTools({
          conversationId: "conv-1",
          userId: "binding-user",
          wallet: {} as never,
          binance,
        } as never);
        const quote = toolByName(tools, "get_market_quote");

        const result = await quote.execute({ symbol: "BTC" });

        expect(result).toMatchObject({ status: "error", code: "binance_unavailable" });
        expect(result).toMatchObject({ message: unavailable.message });
      });
    });
