import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { BinanceClient } from './client.js';
import { TestnetBinanceClient } from './client.testnet.js';
import type { BinanceConfig } from '../config/binance.js';
import {
  normalizeBinanceSymbol,
  type BinanceBalance,
  type BinanceDegradation,
  type BinanceHealth,
  type BinanceHistoryEntry,
  type BinanceInternalTransferRequest,
  type BinanceInternalTransferResult,
  type BinanceOrderRequest,
  type BinanceOrderResult,
  type MarketQuote,
} from './types.js';

const MCP_TOOL_NAMES = {
  quote: 'get_market_quote',
  balance: 'get_binance_balance',
  order: 'place_binance_order',
  transfer: 'binance_internal_transfer',
  history: 'get_binance_history',
} as const;

export type McpBinanceSession = {
  connect(): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export type McpRemoteBinanceClientOptions = {
  config: BinanceConfig;
  createSession?: (config: BinanceConfig) => Promise<McpBinanceSession>;
  createTestnetClient?: (config: BinanceConfig) => BinanceClient;
  clock?: () => string;
};

/**
 * Remote MCP transport for the Binance Agent OS server.
 *
 * The session is connected lazily on first use. If the MCP connection fails,
 * the client degrades to the configured testnet transport and records the
 * degradation reason (never silently) so callers and the audit trail can
 * observe the fallback.
 */
export class McpRemoteBinanceClient implements BinanceClient {
  public readonly id = 'binance-mcp';
  public readonly source = 'mcp' as const;
  private readonly options: McpRemoteBinanceClientOptions;
  private readonly clock: () => string;
  private backing: BinanceClient | undefined;
  private degradationState: BinanceDegradation | undefined;

  public constructor(options: McpRemoteBinanceClientOptions) {
    this.options = options;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public get degradation(): BinanceDegradation | undefined {
    return this.degradationState;
  }

  public async health(): Promise<BinanceHealth> {
    await this.getBacking();
    if (this.degradationState) {
      return {
        status: 'degraded',
        source: 'mcp',
        reason: this.degradationState.reason,
        degradation: this.degradationState,
      };
    }
    return { status: 'healthy', source: 'mcp' };
  }

  public async getMarketQuote(symbol: string): Promise<MarketQuote> {
    return (await this.getBacking()).getMarketQuote(symbol);
  }

  public async getBalance(asset?: string): Promise<BinanceBalance[]> {
    return (await this.getBacking()).getBalance(asset);
  }

  public async placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult> {
    return (await this.getBacking()).placeOrder(request);
  }

  public async internalTransfer(request: BinanceInternalTransferRequest): Promise<BinanceInternalTransferResult> {
    return (await this.getBacking()).internalTransfer(request);
  }

  public async getHistory(asset?: string): Promise<BinanceHistoryEntry[]> {
    return (await this.getBacking()).getHistory(asset);
  }

  public async close(): Promise<void> {
    await this.backing?.close();
  }

  private async getBacking(): Promise<BinanceClient> {
    if (this.backing) return this.backing;
    try {
      const session = await this.createSession();
      await session.connect();
      this.backing = new McpBinanceSessionAdapter(session, this.clock);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Remote MCP connection failed.';
      this.degradationState = { from: 'mcp', to: 'testnet', reason, timestamp: this.clock() };
      this.backing = this.createTestnetClient();
    }
    return this.backing;
  }

  private async createSession(): Promise<McpBinanceSession> {
    if (this.options.createSession) return this.options.createSession(this.options.config);
    return createRemoteMcpSession(this.options.config);
  }

  private createTestnetClient(): BinanceClient {
    if (this.options.createTestnetClient) return this.options.createTestnetClient(this.options.config);
    return new TestnetBinanceClient({ config: this.options.config });
  }
}

/**
 * Bridges the remote MCP session to the BinanceClient interface by mapping each
 * interface method to the corresponding MCP tool call and decoding the result.
 */
class McpBinanceSessionAdapter implements BinanceClient {
  public readonly id = 'binance-mcp-session';
  public readonly source = 'mcp' as const;
  private readonly session: McpBinanceSession;
  private readonly clock: () => string;

  public constructor(session: McpBinanceSession, clock: () => string) {
    this.session = session;
    this.clock = clock;
  }

  public async health(): Promise<BinanceHealth> {
    return { status: 'healthy', source: 'mcp' };
  }

  public async getMarketQuote(symbol: string): Promise<MarketQuote> {
    const data = decodeMcpContent(await this.session.callTool(MCP_TOOL_NAMES.quote, { symbol }));
    return decodeMarketQuote(data, symbol, this.clock);
  }

  public async getBalance(asset?: string): Promise<BinanceBalance[]> {
    const data = decodeMcpContent(await this.session.callTool(MCP_TOOL_NAMES.balance, asset ? { asset } : {}));
    return decodeBalances(data);
  }

  public async placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult> {
    const data = decodeMcpContent(await this.session.callTool(MCP_TOOL_NAMES.order, request));
    return decodeOrderResult(data, request, this.clock);
  }

  public async internalTransfer(request: BinanceInternalTransferRequest): Promise<BinanceInternalTransferResult> {
    const data = decodeMcpContent(await this.session.callTool(MCP_TOOL_NAMES.transfer, request));
    return decodeTransferResult(data, request, this.clock);
  }

  public async getHistory(asset?: string): Promise<BinanceHistoryEntry[]> {
    const data = decodeMcpContent(await this.session.callTool(MCP_TOOL_NAMES.history, asset ? { asset } : {}));
    return decodeHistory(data);
  }

  public async close(): Promise<void> {
    await this.session.close();
  }
}

function createRemoteMcpSession(config: BinanceConfig): Promise<McpBinanceSession> {
  const url = new URL(config.mcpUrl as string);
  const requestInit = config.mcpToken ? { headers: { Authorization: `Bearer ${config.mcpToken}` } } : {};
  const transport = config.mcpTransport === 'sse'
    ? new SSEClientTransport(url, { requestInit })
    : new StreamableHTTPClientTransport(url, { requestInit });
  const client = new Client({ name: 'binance-agent-os', version: '0.1.0' });
  return Promise.resolve({
    connect: async () => { await client.connect(transport); },
    listTools: async () => client.listTools(),
    callTool: async (name, args) => client.callTool({ name, arguments: args }),
    close: async () => client.close(),
  });
}

function decodeMcpContent(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.content)) return value;
  const text = record.content.find(
    (part): part is { type: 'text'; text: string } =>
      Boolean(part) &&
      typeof part === 'object' &&
      (part as Record<string, unknown>).type === 'text' &&
      typeof (part as Record<string, unknown>).text === 'string',
  );
  if (!text) return value;
  try {
    return JSON.parse(text.text) as unknown;
  } catch {
    return text.text;
  }
}

function decodeMarketQuote(value: unknown, symbol: string, clock: () => string): MarketQuote {
  const row = asRecord(value, 'market quote');
  return {
    symbol: normalizeBinanceSymbol(symbol),
    bid: stringValue(row.bid ?? row.bidPrice, 'market quote bid'),
    ask: stringValue(row.ask ?? row.askPrice, 'market quote ask'),
    last: stringValue(row.last ?? row.lastPrice, 'market quote last'),
    timestamp: row.timestamp !== undefined ? String(row.timestamp) : clock(),
  };
}

function decodeBalances(value: unknown): BinanceBalance[] {
  const list = Array.isArray(value) ? value : (asRecord(value, 'balance').balances as unknown);
  if (!Array.isArray(list)) throw new Error('MCP balance response is invalid.');
  return list.map((entry) => {
    const row = asRecord(entry, 'balance');
    const free = stringValue(row.free, 'balance free');
    const locked = stringValue(row.locked, 'balance locked');
    return {
      asset: stringValue(row.asset, 'balance asset'),
      free,
      locked,
      total: addDecimalStrings(free, locked),
    };
  });
}

function decodeOrderResult(value: unknown, request: BinanceOrderRequest, clock: () => string): BinanceOrderResult {
  const row = asRecord(value, 'order');
  const order = {
    symbol: normalizeBinanceSymbol(request.symbol),
    orderId: Number(row.orderId ?? 0),
    side: request.side,
    type: request.type,
    status: String(row.status ?? 'NEW') as 'NEW',
    quantity: request.quantity,
    executedQuantity: String(row.executedQuantity ?? row.executedQty ?? '0'),
    ...(request.price !== undefined ? { price: request.price } : {}),
    ...(row.averagePrice !== undefined ? { averagePrice: String(row.averagePrice) } : {}),
    timestamp: clock(),
  };
  return {
    order,
    evidence: {
      schemaVersion: 'binance-evidence/v1',
      operation: 'order',
      input: request,
      source: 'mcp',
      outcome: { status: 'completed', result: order },
      timestamp: clock(),
    },
  };
}

function decodeTransferResult(value: unknown, request: BinanceInternalTransferRequest, clock: () => string): BinanceInternalTransferResult {
  const row = asRecord(value, 'transfer');
  const transfer = {
    transferId: String(row.transferId ?? row.tranId ?? `mcp-transfer-${clock()}`),
    asset: normalizeBinanceSymbol(request.asset),
    amount: request.amount,
    from: request.from,
    to: request.to,
    status: String(row.status ?? 'COMPLETED') as 'COMPLETED',
    timestamp: clock(),
  };
  return {
    transfer,
    evidence: {
      schemaVersion: 'binance-evidence/v1',
      operation: 'transfer',
      input: request,
      source: 'mcp',
      outcome: { status: 'completed', result: transfer },
      timestamp: clock(),
    },
  };
}

function decodeHistory(value: unknown): BinanceHistoryEntry[] {
  const list = Array.isArray(value) ? value : (asRecord(value, 'history').history as unknown);
  if (!Array.isArray(list)) throw new Error('MCP history response is invalid.');
  return list.map((entry) => {
    const row = asRecord(entry, 'history entry');
    return {
      id: String(row.id ?? row.orderId ?? ''),
      type: String(row.type ?? 'order') === 'transfer' ? 'transfer' : 'order',
      asset: String(row.asset ?? row.symbol ?? ''),
      amount: String(row.amount ?? ''),
      status: String(row.status ?? ''),
      timestamp: row.timestamp !== undefined ? String(row.timestamp) : '',
      ...(row.detail !== undefined ? { detail: String(row.detail) } : {}),
    };
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MCP ${label} response is invalid.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`MCP ${label} is missing.`);
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
