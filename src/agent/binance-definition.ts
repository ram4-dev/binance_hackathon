import { z } from 'zod';
import { binanceTransferPreviewSchema, type BinanceTransferPreview } from '../contracts/http.js';
import type { AgentToolDefinition, WalletAgentContext } from './definition.js';
import type { BinanceClient } from '../binance/client.js';
import { createBinanceClientFromEnv } from '../binance/client.js';
import { normalizeBinanceSymbol } from '../binance/types.js';
import type { BinanceConfig } from '../config/binance.js';
import { readBinanceConfig } from '../config/binance.js';
import {
  evaluateBinanceOrderPolicy,
  evaluateBinanceTransferPolicy,
  type BinancePolicyCode,
} from './policy-binance.js';
import type { BinanceDailyUsageStore } from '../db/binance-daily-usage-repository.js';
import { binanceUsageDate, createBinanceDailyUsageStore } from '../db/binance-daily-usage-repository.js';

/**
 * The five Binance tools exposed to both the text and LiveKit loops, backed by
 * the Slice-1 BinanceClient transport abstraction.
 *
 * Money-moving tools (`place_binance_order`, `binance_internal_transfer`) are
 * fail-closed: every execution requires a matching confirmed preview (enforced
 * by the guarded wrapper) and an idempotency key (enforced here), and every
 * policy violation returns a hold, never a definitive failure.
 */

export const binanceQuoteInputSchema = z.object({
  symbol: z.string().trim().min(1),
});
export type BinanceQuoteInput = z.infer<typeof binanceQuoteInputSchema>;

export const binanceBalanceInputSchema = z.object({
  asset: z.string().trim().min(1).optional(),
});
export type BinanceBalanceInput = z.infer<typeof binanceBalanceInputSchema>;

export const binanceOrderInputSchema = z.object({
  symbol: z.string().trim().min(1),
  side: z.enum(['BUY', 'SELL']),
  orderType: z.enum(['MARKET', 'LIMIT']),
  quantity: z.string().trim().min(1),
  price: z.string().trim().min(1).optional(),
  dryRun: z.boolean(),
  idempotencyKey: z.string().trim().min(1),
});
export type BinanceOrderInput = z.infer<typeof binanceOrderInputSchema>;

export const binanceTransferInputSchema = z.object({
  asset: z.string().trim().min(1),
  amount: z.string().trim().min(1),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  dryRun: z.boolean(),
  idempotencyKey: z.string().trim().min(1),
});
export type BinanceTransferInput = z.infer<typeof binanceTransferInputSchema>;

export const binanceHistoryInputSchema = z.object({
  asset: z.string().trim().min(1).optional(),
});
export type BinanceHistoryInput = z.infer<typeof binanceHistoryInputSchema>;

export type BinanceToolDependencies = {
  client: BinanceClient;
  usage: BinanceDailyUsageStore;
  config: BinanceConfig;
  idempotency?: Map<string, unknown>;
  now?: () => Date;
};

let clientSingleton: BinanceClient | undefined;
let usageSingleton: BinanceDailyUsageStore | undefined;
let configSingleton: BinanceConfig | undefined;
let idempotencySingleton: Map<string, unknown> | undefined;

export function createBinanceToolDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): BinanceToolDependencies {
  clientSingleton ??= createBinanceClientFromEnv(environment);
  usageSingleton ??= createBinanceDailyUsageStore(environment);
  configSingleton ??= readBinanceConfig(environment);
  idempotencySingleton ??= new Map<string, unknown>();
  return {
    client: clientSingleton,
    usage: usageSingleton,
    config: configSingleton,
    idempotency: idempotencySingleton,
  };
}

export function createBinanceTools(
  deps: BinanceToolDependencies,
): AgentToolDefinition<unknown, unknown>[] {
  const clock = deps.now ?? (() => new Date());

  return [
    {
      name: 'get_market_quote',
      description: 'Read a live Binance market quote (bid, ask, last) for a base asset.',
      inputSchema: binanceQuoteInputSchema,
      execute: async (input) => {
        const parsed = binanceQuoteInputSchema.parse(input);
        return deps.client.getMarketQuote(normalizeBinanceSymbol(parsed.symbol));
      },
    },
    {
      name: 'get_binance_balance',
      description: 'Read Binance balances, optionally filtered to one asset.',
      inputSchema: binanceBalanceInputSchema,
      execute: async (input) => {
        const parsed = binanceBalanceInputSchema.parse(input);
        return deps.client.getBalance(parsed.asset ? normalizeBinanceSymbol(parsed.asset) : undefined);
      },
    },
    {
      name: 'place_binance_order',
      description: 'Preview or execute a Binance spot order. Use dryRun to preview; execution requires a confirmed preview and an idempotency key.',
      inputSchema: binanceOrderInputSchema,
      execute: async (input, context) => executeBinanceOrder(input, context, deps, clock),
    },
    {
      name: 'binance_internal_transfer',
      description: 'Preview or execute a Binance internal asset transfer. Use dryRun to preview; execution requires a confirmed preview and an idempotency key.',
      inputSchema: binanceTransferInputSchema,
      execute: async (input, context) => executeBinanceTransfer(input, context, deps),
    },
    {
      name: 'get_binance_history',
      description: 'Read Binance order and transfer history, optionally filtered to one asset.',
      inputSchema: binanceHistoryInputSchema,
      execute: async (input) => {
        const parsed = binanceHistoryInputSchema.parse(input);
        return deps.client.getHistory(parsed.asset ? normalizeBinanceSymbol(parsed.asset) : undefined);
      },
    },
  ];
}

export function createBinanceToolsFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): AgentToolDefinition<unknown, unknown>[] {
  return createBinanceTools(createBinanceToolDependencies(environment));
}

/**
 * Extracts a canonical Binance venue preview from a tool output. Returns null
 * when the output is not a Binance preview (e.g. a hold or an execution result).
 */
export function canonicalizeBinancePreview(output: unknown): BinanceTransferPreview | null {
  const candidate = decodePreviewOutput(output, 0);
  if (!candidate || candidate.preview !== true || candidate.venue !== 'binance') return null;
  const parsed = binanceTransferPreviewSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function decodePreviewOutput(value: unknown, depth: number): Record<string, unknown> | null {
  if (depth > 4) return null;
  if (typeof value === 'string') {
    try {
      return decodePreviewOutput(JSON.parse(value) as unknown, depth + 1);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if ('venue' in candidate && candidate.venue === 'binance') return candidate;
  for (const key of ['output', 'result', 'data'] as const) {
    if (key in candidate) {
      const nested = decodePreviewOutput(candidate[key], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

async function executeBinanceOrder(
  input: unknown,
  context: WalletAgentContext,
  deps: BinanceToolDependencies,
  clock: () => Date,
): Promise<unknown> {
  const parsed = binanceOrderInputSchema.parse(input);
  const symbol = normalizeBinanceSymbol(parsed.symbol);
  const quote = await deps.client.getMarketQuote(symbol);
  const referencePrice =
    parsed.orderType === 'LIMIT' && parsed.price
      ? parsed.price
      : parsed.side === 'BUY'
        ? quote.ask
        : quote.bid;
  const value = multiplyDecimals(parsed.quantity, referencePrice);
  const date = binanceUsageDate(clock());
  const currentDaily = await deps.usage.getUsage(context.userId, date);
  const decision = evaluateBinanceOrderPolicy(
    {
      symbol,
      side: parsed.side,
      orderType: parsed.orderType,
      quantity: parsed.quantity,
      value,
    },
    deps.config,
    currentDaily,
  );
  if (!decision.ok) return holdResult(decision);

  if (parsed.dryRun) {
    return {
      preview: true,
      venue: 'binance',
      symbol,
      quantity: parsed.quantity,
      value,
      orderType: parsed.orderType,
    };
  }

  const cacheKey = `order:${parsed.idempotencyKey}`;
  const cached = deps.idempotency?.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await deps.client.placeOrder({
    symbol,
    side: parsed.side,
    type: parsed.orderType,
    quantity: parsed.quantity,
    ...(parsed.price !== undefined ? { price: parsed.price } : {}),
  });
  deps.idempotency?.set(cacheKey, result);
  await deps.usage.addUsage(context.userId, date, value);
  return result;
}

async function executeBinanceTransfer(
  input: unknown,
  context: WalletAgentContext,
  deps: BinanceToolDependencies,
): Promise<unknown> {
  const parsed = binanceTransferInputSchema.parse(input);
  const asset = normalizeBinanceSymbol(parsed.asset);
  const decision = evaluateBinanceTransferPolicy({ asset, amount: parsed.amount }, deps.config);
  if (!decision.ok) return holdResult(decision);

  if (parsed.dryRun) {
    return {
      preview: true,
      venue: 'binance',
      symbol: asset,
      quantity: parsed.amount,
      value: parsed.amount,
    };
  }

  const cacheKey = `transfer:${parsed.idempotencyKey}`;
  const cached = deps.idempotency?.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await deps.client.internalTransfer({
    asset,
    amount: parsed.amount,
    from: parsed.from,
    to: parsed.to,
  });
  deps.idempotency?.set(cacheKey, result);
  return result;
}

function holdResult(decision: { code: BinancePolicyCode; message: string }): {
  error: 'policy_hold';
  code: BinancePolicyCode;
  message: string;
} {
  return { error: 'policy_hold', code: decision.code, message: decision.message };
}

function multiplyDecimals(left: string, right: string): string {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const places = leftFraction.length + rightFraction.length;
  const product = BigInt(`${leftWhole}${leftFraction}`) * BigInt(`${rightWhole}${rightFraction}`);
  const productString = product.toString().padStart(places + 1, '0');
  if (places === 0) return productString;
  const integerPart = productString.slice(0, -places);
  const fractionPart = productString.slice(-places).replace(/0+$/u, '');
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}
