import type { BinanceClient } from './client.js';
import {
  normalizeBinanceSymbol,
  type BinanceBalance,
  type BinanceEvidence,
  type BinanceHealth,
  type BinanceHistoryEntry,
  type BinanceInternalTransferRequest,
  type BinanceInternalTransferResult,
  type BinanceOrder,
  type BinanceOrderRequest,
  type BinanceOrderResult,
  type MarketQuote,
} from './types.js';

const QUOTES: Record<string, MarketQuote> = {
  BTC: { symbol: 'BTC', bid: '60000.00', ask: '60005.00', last: '60002.50', timestamp: '2026-01-01T00:00:00.000Z' },
  ETH: { symbol: 'ETH', bid: '3000.00', ask: '3001.00', last: '3000.50', timestamp: '2026-01-01T00:00:00.000Z' },
  BNB: { symbol: 'BNB', bid: '500.00', ask: '501.00', last: '500.50', timestamp: '2026-01-01T00:00:00.000Z' },
};

const BALANCES: BinanceBalance[] = [
  { asset: 'USDT', free: '10000', locked: '0', total: '10000' },
  { asset: 'BTC', free: '0.5', locked: '0', total: '0.5' },
  { asset: 'ETH', free: '2', locked: '0', total: '2' },
  { asset: 'BNB', free: '10', locked: '0', total: '10' },
];

export type FixtureBinanceClientOptions = {
  clock?: () => string;
};

/**
 * Deterministic in-memory Binance transport.
 *
 * Quotes, balances, and execution prices are fixed constants, so identical
 * requests produce identical results. Order and transfer identifiers increment
 * deterministically per client instance; the injected clock controls evidence
 * and result timestamps for reproducible tests.
 */
export class FixtureBinanceClient implements BinanceClient {
  public readonly id = 'binance-fixture';
  public readonly source = 'fixture' as const;
  private readonly clock: () => string;
  private orderCounter = 0;
  private transferCounter = 0;

  public constructor(options: FixtureBinanceClientOptions = {}) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async health(): Promise<BinanceHealth> {
    return { status: 'healthy', source: 'fixture' };
  }

  public async getMarketQuote(symbol: string): Promise<MarketQuote> {
    const normalized = normalizeBinanceSymbol(symbol);
    const quote = QUOTES[normalized];
    if (!quote) throw new Error(`FixtureBinanceClient has no quote for ${normalized}.`);
    return { ...quote };
  }

  public async getBalance(asset?: string): Promise<BinanceBalance[]> {
    if (!asset) return BALANCES.map((entry) => ({ ...entry }));
    const normalized = normalizeBinanceSymbol(asset);
    const found = BALANCES.find((entry) => entry.asset === normalized);
    return found ? [{ ...found }] : [];
  }

  public async placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult> {
    const symbol = normalizeBinanceSymbol(request.symbol);
    const quote = await this.getMarketQuote(symbol);
    this.orderCounter += 1;
    const fillPrice = request.side === 'BUY' ? quote.ask : quote.bid;
    const order: BinanceOrder = {
      symbol,
      orderId: this.orderCounter,
      side: request.side,
      type: request.type,
      status: 'FILLED',
      quantity: request.quantity ?? '',
      executedQuantity: request.quantity ?? '',
      ...(request.price !== undefined ? { price: request.price } : {}),
      averagePrice: fillPrice,
      timestamp: this.clock(),
    };
    return { order, evidence: this.evidence('order', request, { status: 'completed', result: order }) };
  }

  public async internalTransfer(request: BinanceInternalTransferRequest): Promise<BinanceInternalTransferResult> {
    this.transferCounter += 1;
    const transfer = {
      transferId: `fixture-transfer-${this.transferCounter}`,
      asset: normalizeBinanceSymbol(request.asset),
      amount: request.amount,
      from: request.from,
      to: request.to,
      status: 'COMPLETED' as const,
      timestamp: this.clock(),
    };
    return { transfer, evidence: this.evidence('transfer', request, { status: 'completed', result: transfer }) };
  }

  public async getHistory(asset?: string): Promise<BinanceHistoryEntry[]> {
    const normalized = asset ? normalizeBinanceSymbol(asset) : undefined;
    const entries: BinanceHistoryEntry[] = [
      { id: 'fixture-order-1', type: 'order', asset: 'BTC', amount: '0.01', status: 'FILLED', timestamp: this.clock(), detail: 'Market BUY 0.01 BTC' },
      { id: 'fixture-transfer-1', type: 'transfer', asset: 'BNB', amount: '1', status: 'COMPLETED', timestamp: this.clock(), detail: 'Spot → Funding' },
    ];
    return entries.filter((entry) => !normalized || entry.asset === normalized);
  }

  public async close(): Promise<void> {}

  private evidence(
    operation: BinanceEvidence['operation'],
    input: unknown,
    outcome: BinanceEvidence['outcome'],
  ): BinanceEvidence {
    return {
      schemaVersion: 'binance-evidence/v1',
      operation,
      input,
      source: 'fixture',
      outcome,
      timestamp: this.clock(),
    };
  }
}
