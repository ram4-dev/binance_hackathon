import { createHmac } from 'node:crypto';
import type { BinanceClient } from './client.js';
import type { BinanceConfig } from '../config/binance.js';
import {
  normalizeBinanceSymbol,
  toBinancePair,
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

const BASE_URL = 'https://testnet.binance.vision';
const RECV_WINDOW = '5000';

export type TestnetBinanceClientOptions = {
  config: BinanceConfig;
  fetchImpl?: typeof fetch;
  clock?: () => string;
};

/**
 * REST transport for the Binance Spot Test Network.
 *
 * Public endpoints (quotes) require no signing; account, order, transfer, and
 * history endpoints are signed with HMAC-SHA256 over the query string, using
 * the test network API key and secret from the parsed configuration.
 */
export class TestnetBinanceClient implements BinanceClient {
  public readonly id = 'binance-testnet';
  public readonly source = 'testnet' as const;
  private readonly config: BinanceConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => string;

  public constructor(options: TestnetBinanceClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async health(): Promise<BinanceHealth> {
    try {
      const response = await this.fetchImpl(`${BASE_URL}/api/v3/ping`);
      if (!response.ok) {
        return { status: 'unavailable', source: 'testnet', reason: `Ping failed with HTTP ${response.status}.` };
      }
      return { status: 'healthy', source: 'testnet' };
    } catch (error) {
      return { status: 'unavailable', source: 'testnet', reason: error instanceof Error ? error.message : 'Testnet ping failed.' };
    }
  }

  public async getMarketQuote(symbol: string): Promise<MarketQuote> {
    const pair = toBinancePair(symbol);
    const response = await this.fetchImpl(`${BASE_URL}/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`);
    const data = await this.json(response);
    return {
      symbol: normalizeBinanceSymbol(symbol),
      bid: stringField(data, 'bidPrice', 'quote bid'),
      ask: stringField(data, 'askPrice', 'quote ask'),
      last: stringField(data, 'lastPrice', 'quote last'),
      timestamp: this.clock(),
    };
  }

  public async getBalance(asset?: string): Promise<BinanceBalance[]> {
    const data = await this.signedGet('/api/v3/account', {});
    const balances = data.balances;
    if (!Array.isArray(balances)) throw new Error('Testnet account response is missing balances.');
    const normalized = asset ? normalizeBinanceSymbol(asset) : undefined;
    return balances
      .map((entry) => {
        const row = asRecord(entry, 'balance');
        const free = stringField(row, 'free', 'balance free');
        const locked = stringField(row, 'locked', 'balance locked');
        return {
          asset: stringField(row, 'asset', 'balance asset'),
          free,
          locked,
          total: addDecimalStrings(free, locked),
        };
      })
      .filter((entry) => !normalized || entry.asset === normalized);
  }

  public async placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult> {
    const params: Record<string, string> = {
      symbol: toBinancePair(request.symbol),
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      ...(request.price !== undefined ? { price: request.price } : {}),
    };
    const data = await this.signedPost('/api/v3/order', params);
    const order = this.parseOrder(data, request);
    return { order, evidence: this.evidence('order', request, { status: 'completed', result: order }) };
  }

  public async internalTransfer(request: BinanceInternalTransferRequest): Promise<BinanceInternalTransferResult> {
    const data = await this.signedPost('/sapi/v1/asset/transfer', {
      asset: normalizeBinanceSymbol(request.asset),
      amount: request.amount,
      fromAccountType: request.from,
      toAccountType: request.to,
    });
    const transfer = {
      transferId: data.tranId !== undefined ? String(data.tranId) : `testnet-transfer-${this.clock()}`,
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
    const params: Record<string, string> = {};
    const normalized = asset ? normalizeBinanceSymbol(asset) : undefined;
    if (normalized) params.symbol = toBinancePair(normalized);
    const data = await this.signedGet('/api/v3/allOrders', params);
    if (!Array.isArray(data)) throw new Error('Testnet orders response is invalid.');
    return data.map((entry) => {
      const row = asRecord(entry, 'order');
      return {
        id: String(row.orderId ?? ''),
        type: 'order' as const,
        asset: normalized ?? String(row.symbol ?? ''),
        amount: String(row.executedQty ?? row.origQty ?? ''),
        status: String(row.status ?? ''),
        timestamp: new Date(Number(row.time ?? 0)).toISOString(),
      };
    });
  }

  public async close(): Promise<void> {}

  private async signedGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${BASE_URL}${path}?${this.sign(params)}`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    return this.json(response);
  }

  private async signedPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${BASE_URL}${path}?${this.sign(params)}`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
    return this.json(response);
  }

  private sign(params: Record<string, string>): string {
    const timestamp = Date.now();
    const search = new URLSearchParams({ ...params, timestamp: String(timestamp), recvWindow: RECV_WINDOW });
    const signature = createHmac('sha256', this.config.testnetApiSecret ?? '')
      .update(search.toString())
      .digest('hex');
    search.set('signature', signature);
    return search.toString();
  }

  private authHeaders(): Record<string, string> {
    return { 'X-MBX-APIKEY': this.config.testnetApiKey ?? '' };
  }

  private async json(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) throw new Error(`Testnet request failed with HTTP ${response.status}.`);
    return asRecord(await response.json(), 'testnet response');
  }

  private parseOrder(data: Record<string, unknown>, request: BinanceOrderRequest): BinanceOrder {
    return {
      symbol: normalizeBinanceSymbol(request.symbol),
      orderId: Number(data.orderId ?? 0),
      side: request.side,
      type: request.type,
      status: String(data.status ?? 'NEW') as BinanceOrder['status'],
      quantity: request.quantity,
      executedQuantity: String(data.executedQty ?? '0'),
      ...(request.price !== undefined ? { price: request.price } : {}),
      ...(data.avgPrice !== undefined ? { averagePrice: String(data.avgPrice) } : {}),
      timestamp: this.clock(),
    };
  }

  private evidence(
    operation: BinanceEvidence['operation'],
    input: unknown,
    outcome: BinanceEvidence['outcome'],
  ): BinanceEvidence {
    return {
      schemaVersion: 'binance-evidence/v1',
      operation,
      input,
      source: 'testnet',
      outcome,
      timestamp: this.clock(),
    };
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Testnet ${label} response is invalid.`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Testnet ${label} is missing.`);
  }
  return value;
}

function addDecimalStrings(left: string, right: string): string {
  const [leftInt, leftFrac = ''] = left.split('.');
  const [rightInt, rightFrac = ''] = right.split('.');
  const places = Math.max(leftFrac.length, rightFrac.length);
  const leftScaled = BigInt(leftInt + leftFrac.padEnd(places, '0'));
  const rightScaled = BigInt(rightInt + rightFrac.padEnd(places, '0'));
  const sum = (leftScaled + rightScaled).toString().padStart(places + 1, '0');
  if (places === 0) return sum;
  const integerPart = sum.slice(0, -places);
  const fractionPart = sum.slice(-places).replace(/0+$/, '');
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}
