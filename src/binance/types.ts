/**
 * Transport-level types for the Binance client abstraction.
 *
 * The interface operates on base assets (e.g. "BTC", "ETH", "BNB") so the
 * policy and tool layers reason about human assets, while each transport maps
 * a base asset to the exchange's tradeable pair (e.g. "BTCUSDT").
 */

export type BinanceToolsSource = 'fixture' | 'testnet' | 'mcp';

export type BinanceOrderSide = 'BUY' | 'SELL';
export type BinanceOrderType = 'MARKET' | 'LIMIT';
export type BinanceOrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED';
export type BinanceTransferStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export type BinanceOrderRequest = {
  symbol: string;
  side: BinanceOrderSide;
  type: BinanceOrderType;
  /**
   * Base-asset quantity. Required for LIMIT orders and for MARKET orders that do
   * not specify a quote/notional amount; optional when `quoteOrderQty` carries the
   * USD amount (e.g. a MARKET BUY that spends a fixed notional).
   */
  quantity?: string;
  price?: string;
  /**
   * Quote/notional amount in the quote asset (e.g. USD₮). For a MARKET BUY this is
   * passed to `spot.newOrder` as `quoteOrderQty`; when omitted the transport uses
   * the base `quantity` instead.
   */
  quoteOrderQty?: string;
};

export type BinanceOrder = {
  symbol: string;
  orderId: number;
  side: BinanceOrderSide;
  type: BinanceOrderType;
  status: BinanceOrderStatus;
  quantity: string;
  executedQuantity: string;
  price?: string;
  averagePrice?: string;
  timestamp: string;
};

export type BinanceBalance = {
  asset: string;
  free: string;
  locked: string;
  total: string;
};

export type MarketQuote = {
  symbol: string;
  bid: string;
  ask: string;
  last: string;
  timestamp: string;
  /**
   * Optional 24-hour percent change reported by the venue (e.g. `2.50`). The
   * fixture/testnet transports do not populate it; the remote Agent OS transport
   * reads it from `spot.ticker24hr`.
   */
  change24h?: string;
};

export type BinanceInternalTransferRequest = {
  asset: string;
  amount: string;
  from: string;
  to: string;
};

export type BinanceInternalTransfer = {
  transferId: string;
  asset: string;
  amount: string;
  from: string;
  to: string;
  status: BinanceTransferStatus;
  timestamp: string;
};

export type BinanceHistoryEntry = {
  id: string;
  type: 'order' | 'transfer';
  asset: string;
  amount: string;
  status: string;
  timestamp: string;
  detail?: string;
};

export type BinanceEvidenceOperation = 'quote' | 'balance' | 'order' | 'transfer' | 'history';

export type BinanceEvidenceOutcome = {
  status: 'completed' | 'uncertain' | 'rejected';
  result?: unknown;
  reason?: string;
};

export type BinanceDegradation = {
  from: 'mcp';
  to: 'testnet';
  reason: string;
  timestamp: string;
};

export type BinanceEvidence = {
  schemaVersion: 'binance-evidence/v1';
  operation: BinanceEvidenceOperation;
  input: unknown;
  source: BinanceToolsSource;
  degradation?: BinanceDegradation;
  outcome: BinanceEvidenceOutcome;
  timestamp: string;
};

export type BinanceHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  source: BinanceToolsSource;
  reason?: string;
  degradation?: BinanceDegradation;
};

export type BinanceOrderResult = {
  order: BinanceOrder;
  evidence: BinanceEvidence;
};

export type BinanceInternalTransferResult = {
  transfer: BinanceInternalTransfer;
  evidence: BinanceEvidence;
};

const BASE_ASSETS = new Set(['BTC', 'ETH', 'BNB']);

/** Normalize a user-supplied symbol to an uppercase base asset. */
export function normalizeBinanceSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** Map a base asset to its USDT tradeable pair for the exchange REST API. */
export function toBinancePair(symbol: string): string {
  const normalized = normalizeBinanceSymbol(symbol);
  return BASE_ASSETS.has(normalized) ? `${normalized}USDT` : normalized;
}
