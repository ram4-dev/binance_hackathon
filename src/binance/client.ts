import { readBinanceConfig, type BinanceConfig } from '../config/binance.js';
import type {
  BinanceBalance,
  BinanceDegradation,
  BinanceHealth,
  BinanceHistoryEntry,
  BinanceInternalTransferRequest,
  BinanceInternalTransferResult,
  BinanceOrderRequest,
  BinanceOrderResult,
  BinanceToolsSource,
  MarketQuote,
} from './types.js';
import { FixtureBinanceClient } from './client.fixture.js';
import { TestnetBinanceClient } from './client.testnet.js';
import { McpProxyBinanceClient } from './mcp-proxy-client.js';
import { McpRemoteBinanceClient } from './mcp-remote-client.js';

/**
 * Transport abstraction over a Binance venue.
 *
 * The concrete transports are: `fixture` (deterministic in-memory),
 * `testnet` (Binance Spot Test Network REST with HMAC signing), and `mcp`
 * (remote MCP server, with automatic degradation to testnet on connection
 * failure). Live trading is never reachable through this interface.
 */
export interface BinanceClient {
  readonly id: string;
  readonly source: BinanceToolsSource;
  readonly degradation?: BinanceDegradation;
  health(): Promise<BinanceHealth>;
  getMarketQuote(symbol: string): Promise<MarketQuote>;
  getBalance(asset?: string): Promise<BinanceBalance[]>;
  placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult>;
  internalTransfer(request: BinanceInternalTransferRequest): Promise<BinanceInternalTransferResult>;
  getHistory(asset?: string): Promise<BinanceHistoryEntry[]>;
  close(): Promise<void>;
}

export function createBinanceClient(config: BinanceConfig): BinanceClient {
  switch (config.source) {
    case 'fixture':
      return new FixtureBinanceClient();
    case 'testnet':
      return new TestnetBinanceClient({ config });
    case 'mcp':
      // Explicit selection: a bearer token implies the direct StreamableHTTP
      // transport; its absence implies the mcp-remote stdio proxy (first-run
      // OAuth). Never guess between them.
      if (config.mcpToken) return new McpRemoteBinanceClient({ config });
      return new McpProxyBinanceClient({ config });
    default: {
      const exhaustive: never = config.source;
      throw new Error(`Unsupported BINANCE_TOOLS_SOURCE: ${String(exhaustive)}`);
    }
  }
}

export function createBinanceClientFromEnv(environment: NodeJS.ProcessEnv = process.env): BinanceClient {
  return createBinanceClient(readBinanceConfig(environment));
}
