import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { BinanceClient } from './client.js';
import { TestnetBinanceClient } from './client.testnet.js';
import type { BinanceConfig } from '../config/binance.js';
import {
  normalizeBinanceSymbol,
  toBinancePair,
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

/**
 * Real Binance Agent OS tool names, verified against the live server. The server
 * exposes only `tool_search`, `tool_execute`, and `analysis.getTokenAiReport`
 * through `tools/list`; every other capability is discovered through `tool_search`
 * (paginated per category) and executed through `tool_execute`.
 */
const TOOL_NAMES = {
  quote: 'spot.tickerPrice',
  quote24h: 'spot.ticker24hr',
  balance: 'spot.getAccount',
  order: 'spot.newOrder',
  history: 'spot.myTrades',
} as const;

/**
 * Categories probed for the tools the BinanceClient interface needs. The internal
 * transfer tool is not a fixed name: it is discovered across the transfer,
 * asset-management, and capital categories, and surfaced as clearly unavailable
 * when the granted scopes do not include one.
 */
// 'market' holds the spot tickers (spot.tickerPrice, spot.ticker24hr); 'market-data' holds futures/convert market tools.
const SEARCH_CATEGORIES = ['market', 'market-data', 'account', 'trade', 'transfer', 'asset-management', 'capital'] as const;
const TRANSFER_CATEGORIES = ['transfer', 'asset-management', 'capital'] as const;

export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpBinanceSession = {
  connect(): Promise<void>;
  /** Discover tools by category; the real server paginates via an opaque cursor. */
  searchTools(category: string, cursor?: string): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }>;
  /** Execute a discovered tool by name with the supplied arguments. */
  executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export type McpRemoteBinanceClientOptions = {
  config: BinanceConfig;
  createSession?: (config: BinanceConfig) => Promise<McpBinanceSession>;
  createTestnetClient?: (config: BinanceConfig) => BinanceClient;
  clock?: () => string;
};

/**
 * Raised when a required Binance Agent OS tool is absent from the granted scopes
 * (renamed, not granted, or not discoverable). It carries the role, the expected
 * names, and the discovered catalog so the operator can see exactly what was
 * granted and request the missing scope. It is a typed, handled result — never a
 * silent empty success and never a raw crash.
 */
export class McpToolUnavailableError extends Error {
  public readonly role: string;
  public readonly expected: string[];
  public readonly catalog: string[];

  public constructor(role: string, expected: string[], catalog: string[]) {
    super(
      `Binance Agent OS tool "${role}" is unavailable in the granted scopes. ` +
        `Expected one of: ${expected.join(', ')}. ` +
        `Discovered catalog: ${catalog.length ? catalog.join(', ') : '(none)'}. ` +
        `Check the tools granted to the Binance MCP server or request additional scopes.`,
    );
    this.name = 'McpToolUnavailableError';
    this.role = role;
    this.expected = expected;
    this.catalog = catalog;
  }
}

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
          if (!this.options.config.mcpDegrade) {
            throw error;
          }
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
 * Bridges the remote MCP session to the BinanceClient interface by discovering the
 * real Agent OS tools once (cached for the session) and mapping each interface
 * method to the matching tool through `tool_execute`.
 */
export class McpBinanceSessionAdapter implements BinanceClient {
  public readonly id = 'binance-mcp-session';
  public readonly source = 'mcp' as const;
  private readonly session: McpBinanceSession;
  private readonly clock: () => string;
  private catalog: Map<string, McpToolDescriptor> | undefined;
  private catalogPromise: Promise<void> | undefined;
  private transferCandidates: string[] = [];

  public constructor(session: McpBinanceSession, clock: () => string) {
    this.session = session;
    this.clock = clock;
  }

  public async health(): Promise<BinanceHealth> {
    return { status: 'healthy', source: 'mcp' };
  }

  public async getMarketQuote(symbol: string): Promise<MarketQuote> {
    const [quoteTool, quote24hTool] = await Promise.all([
      this.ensureCatalog().then(() => this.resolveTool('market quote', [TOOL_NAMES.quote])),
      this.ensureCatalog().then(() => this.resolveTool('24h quote', [TOOL_NAMES.quote24h])),
    ]);
    const pair = toBinancePair(symbol);
    const [tickerPrice, ticker24hr] = await Promise.all([
      this.session.executeTool(quoteTool, { symbol: pair }),
      this.session.executeTool(quote24hTool, { symbol: pair }),
    ]);
    return decodeMarketQuote(decodeMcpContent(tickerPrice), decodeMcpContent(ticker24hr), symbol, this.clock);
  }

  public async getBalance(asset?: string): Promise<BinanceBalance[]> {
    const tool = await this.ensureCatalog().then(() => this.resolveTool('balance', [TOOL_NAMES.balance]));
    const data = decodeMcpContent(await this.session.executeTool(tool, {}));
    return decodeBalances(data, asset);
  }

  public async placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult> {
    const tool = await this.ensureCatalog().then(() => this.resolveTool('order', [TOOL_NAMES.order]));
    const data = decodeMcpContent(await this.session.executeTool(tool, buildOrderArgs(request)));
    return decodeOrderResult(data, request, this.clock);
  }

  public async internalTransfer(request: BinanceInternalTransferRequest): Promise<BinanceInternalTransferResult> {
    const tool = await this.ensureCatalog().then(() => this.resolveTransferTool());
    const data = decodeMcpContent(
      await this.session.executeTool(tool, {
        asset: normalizeBinanceSymbol(request.asset),
        amount: request.amount,
        from: request.from,
        to: request.to,
      }),
    );
    return decodeTransferResult(data, request, this.clock);
  }

  public async getHistory(asset?: string): Promise<BinanceHistoryEntry[]> {
    const tool = await this.ensureCatalog().then(() => this.resolveTool('history', [TOOL_NAMES.history]));
    const args = asset ? { symbol: toBinancePair(asset) } : {};
    const data = decodeMcpContent(await this.session.executeTool(tool, args));
    return decodeHistory(data);
  }

  public async close(): Promise<void> {
    await this.session.close();
  }

  private ensureCatalog(): Promise<void> {
    if (this.catalog) return Promise.resolve();
    if (!this.catalogPromise) {
      this.catalogPromise = this.discoverCatalog();
    }
    return this.catalogPromise;
  }

  private async discoverCatalog(): Promise<void> {
    const catalog = new Map<string, McpToolDescriptor>();
    const transferCandidates: string[] = [];
    for (const category of SEARCH_CATEGORIES) {
      let cursor: string | undefined;
      do {
        const page = await this.session.searchTools(category, cursor);
        for (const tool of page.tools) {
          if (!tool.name) continue;
          catalog.set(tool.name, tool);
          if (TRANSFER_CATEGORIES.includes(category as (typeof TRANSFER_CATEGORIES)[number])) {
            transferCandidates.push(tool.name);
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    this.catalog = catalog;
    this.transferCandidates = transferCandidates;
  }

  private resolveTool(role: string, expectedNames: string[]): string {
    for (const name of expectedNames) {
      if (this.catalog?.has(name)) return name;
    }
    throw new McpToolUnavailableError(role, expectedNames, [...(this.catalog?.keys() ?? [])]);
  }

  private resolveTransferTool(): string {
    const candidate = this.transferCandidates.find((name) => /transfer/i.test(name));
    if (candidate) return candidate;
    throw new McpToolUnavailableError('internal transfer', ['wallet.* transfer tool'], [...(this.catalog?.keys() ?? [])]);
  }
}


/** Per-call timeout for remote MCP requests (milliseconds). Agent OS order
 * execution can take a few seconds; a hung request must fail instead of
 * stalling the financial task (and the voice confirm) forever. */
const MCP_CALL_TIMEOUT_MS = 30_000;

function withMcpTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Binance Agent OS request timed out after ${MCP_CALL_TIMEOUT_MS}ms (${label}).`)),
      MCP_CALL_TIMEOUT_MS,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
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
    searchTools: async (category, cursor) => {
      const result = await withMcpTimeout(
        client.callTool({
          name: 'tool_search',
          arguments: { category, ...(cursor ? { cursor } : {}) },
        }),
        'tool_search',
      );
      return decodeToolSearch(result);
    },
    executeTool: async (toolName, args) =>
      withMcpTimeout(
        client.callTool({ name: 'tool_execute', arguments: { toolName, arguments: args } }),
        `tool_execute:${toolName}`,
      ),
    close: async () => client.close(),
  });
}

export function decodeToolSearch(value: unknown): { tools: McpToolDescriptor[]; nextCursor?: string } {
  const parsed = decodeMcpContent(value);
  const record = asRecord(parsed, 'tool_search');
  const tools = record.tools;
  if (!Array.isArray(tools)) throw new Error('MCP tool_search response is missing a tools array.');
  const descriptors = tools.map((entry) => {
    const row = asRecord(entry, 'tool descriptor');
    const name = String(row.name ?? '');
    return {
      name,
      ...(row.description !== undefined ? { description: String(row.description) } : {}),
      ...(row.inputSchema !== undefined ? { inputSchema: row.inputSchema as Record<string, unknown> } : {}),
    };
  });
  const nextCursor = record.nextCursor !== undefined ? String(record.nextCursor) : undefined;
  return { tools: descriptors, ...(nextCursor ? { nextCursor } : {}) };
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

function decodeMarketQuote(
  tickerPrice: unknown,
  ticker24hr: unknown,
  symbol: string,
  clock: () => string,
): MarketQuote {
  const priceRow = asRecord(tickerPrice, 'spot.tickerPrice');
  const statRow = asRecord(ticker24hr, 'spot.ticker24hr');
  const last = stringValue(statRow.lastPrice ?? priceRow.price, 'market quote last');
  return {
    symbol: normalizeBinanceSymbol(symbol),
    bid: stringValue(statRow.bidPrice, 'market quote bid'),
    ask: stringValue(statRow.askPrice, 'market quote ask'),
    last,
    timestamp: statRow.closeTime !== undefined ? new Date(Number(statRow.closeTime)).toISOString() : clock(),
    ...(statRow.priceChangePercent !== undefined ? { change24h: String(statRow.priceChangePercent) } : {}),
  };
}

function decodeBalances(value: unknown, asset?: string): BinanceBalance[] {
  const list = Array.isArray(value) ? value : (asRecord(value, 'balance').balances as unknown);
  if (!Array.isArray(list)) throw new Error('MCP balance response is invalid.');
  const normalized = asset ? normalizeBinanceSymbol(asset) : undefined;
  return list
    .map((entry) => {
      const row = asRecord(entry, 'balance');
      const free = stringValue(row.free, 'balance free');
      const locked = stringValue(row.locked, 'balance locked');
      return {
        asset: stringValue(row.asset, 'balance asset'),
        free,
        locked,
        total: addDecimalStrings(free, locked),
      };
    })
    .filter((entry) => !normalized || entry.asset === normalized);
}

function buildOrderArgs(request: BinanceOrderRequest): Record<string, unknown> {
  const args: Record<string, unknown> = {
    symbol: toBinancePair(request.symbol),
    side: request.side,
    type: request.type,
  };
  if (request.type === 'LIMIT') {
    if (request.quantity === undefined) throw new Error('A LIMIT order requires a base quantity.');
    args.quantity = request.quantity;
    if (request.price !== undefined) args.price = request.price;
  } else if (request.quoteOrderQty !== undefined) {
    args.quoteOrderQty = request.quoteOrderQty;
  } else {
    if (request.quantity === undefined) throw new Error('A MARKET order requires either a base quantity or a quoteOrderQty.');
    args.quantity = request.quantity;
  }
  return args;
}

function decodeOrderResult(value: unknown, request: BinanceOrderRequest, clock: () => string): BinanceOrderResult {
  const row = asRecord(value, 'order');
  const order = {
    symbol: normalizeBinanceSymbol(request.symbol),
    orderId: Number(row.orderId ?? 0),
    side: request.side,
    type: request.type,
    status: String(row.status ?? 'NEW') as 'NEW',
    quantity: request.quantity ?? '',
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
    if (row.time !== undefined || row.qty !== undefined) {
      const side = row.isBuyer ? 'BUY' : 'SELL';
      const qty = String(row.qty ?? row.quantity ?? '');
      return {
        id: String(row.id ?? ''),
        type: 'order' as const,
        asset: baseAssetFromSymbol(String(row.symbol ?? '')),
        amount: String(row.qty ?? row.quoteQty ?? ''),
        status: 'FILLED' as const,
        timestamp: row.time !== undefined ? new Date(Number(row.time)).toISOString() : '',
        detail: `${side} ${qty}`.trim(),
      };
    }
    return {
      id: String(row.id ?? row.orderId ?? ''),
      type: String(row.type ?? 'order') === 'transfer' ? 'transfer' : 'order',
      asset: baseAssetFromSymbol(String(row.asset ?? row.symbol ?? '')),
      amount: String(row.amount ?? ''),
      status: String(row.status ?? ''),
      timestamp: row.timestamp !== undefined ? String(row.timestamp) : '',
      ...(row.detail !== undefined ? { detail: String(row.detail) } : {}),
    };
  });
}

function baseAssetFromSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  for (const quote of ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'EUR', 'BTC', 'ETH', 'BNB']) {
    if (upper.endsWith(quote) && upper.length > quote.length) return upper.slice(0, -quote.length);
  }
  return upper;
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
