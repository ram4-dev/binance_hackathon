import type { BinanceToolsSource } from '../binance/types.js';

/**
 * The verified public Binance Agent OS MCP endpoint (standard MCP 2025-06-18,
 * OAuth authorization-code + PKCE). This is the default target for the mcp-remote
 * proxy transport; an operator can override it with BINANCE_MCP_URL.
 */
export const DEFAULT_BINANCE_MCP_URL = 'https://agent.binance.com/mcp/agentic';

/**
 * Binance transport configuration parsed from the environment.
 *
 * Parsing is fail-closed: any ambiguous or unsafe value (including the live
 * mode, which is never enabled in this repository) throws at startup instead
 * of silently degrading or trading against the wrong venue.
 */
export type BinanceConfig = {
  source: BinanceToolsSource;
  mcpUrl?: string;
  mcpToken?: string;
  mcpTransport: 'http' | 'sse';
  /** When false, mcp transports surface connect failures instead of degrading to testnet. */
  mcpDegrade: boolean;
  testnetApiKey?: string;
  testnetApiSecret?: string;
  allowedSymbols: string[];
  maxOrderUsd: number;
  maxDailyUsd: number;
};

const DEFAULT_ALLOWED_SYMBOLS = ['BTC', 'ETH', 'BNB'];
const DEFAULT_MAX_ORDER_USD = 100;
const DEFAULT_MAX_DAILY_USD = 1000;

function optionalTrimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function required(environment: NodeJS.ProcessEnv, name: string, reason: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required ${reason}.`);
  return value;
}

function parseAllowedSymbols(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return DEFAULT_ALLOWED_SYMBOLS;
  const symbols = value
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0) {
    throw new Error('BINANCE_ALLOWED_SYMBOLS must contain at least one symbol.');
  }
  return [...new Set(symbols)];
}

function positiveNumber(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function parseMcpUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('BINANCE_MCP_URL is required when BINANCE_TOOLS_SOURCE=mcp.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BINANCE_MCP_URL must be a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BINANCE_MCP_URL must be an http(s) URL.');
  }
  return value;
}

    function parseMcpTransport(value: string | undefined): 'http' | 'sse' {
      if (value === undefined || value.trim() === '') return 'http';
      if (value === 'http' || value === 'sse') return value;
      throw new Error('BINANCE_MCP_TRANSPORT must be either http or sse.');
    }

    /**
     * BINANCE_MCP_DEGRADE controls whether the mcp transports fall back to testnet on
     * a connect failure. It defaults to 'true' (degrade stays the default). An explicit
     * 'false' lets an operator who only holds the OAuth token run mcp without testnet
     * credentials and surface connect errors directly. Any other value is fail-closed.
     */
    function parseMcpDegrade(value: string | undefined): boolean {
      if (value === undefined || value.trim() === '' || value === 'true') return true;
      if (value === 'false') return false;
      throw new Error('BINANCE_MCP_DEGRADE must be either true or false.');
    }

export function readBinanceConfig(environment: NodeJS.ProcessEnv = process.env): BinanceConfig {
  const rawSource = environment.BINANCE_TOOLS_SOURCE?.trim() || 'fixture';
  if (rawSource === 'live') {
    throw new Error('BINANCE_TOOLS_SOURCE=live is not allowed; Binance live trading is never enabled.');
  }
  if (rawSource !== 'fixture' && rawSource !== 'testnet' && rawSource !== 'mcp') {
    throw new Error('BINANCE_TOOLS_SOURCE must be one of: fixture, testnet, mcp, live.');
  }
  const source = rawSource as BinanceToolsSource;

  const mcpTransport = parseMcpTransport(environment.BINANCE_MCP_TRANSPORT);
  const mcpDegrade = parseMcpDegrade(environment.BINANCE_MCP_DEGRADE);
  const allowedSymbols = parseAllowedSymbols(environment.BINANCE_ALLOWED_SYMBOLS);
  const maxOrderUsd = positiveNumber(environment.BINANCE_MAX_ORDER_USD, 'BINANCE_MAX_ORDER_USD', DEFAULT_MAX_ORDER_USD);
  const maxDailyUsd = positiveNumber(environment.BINANCE_MAX_DAILY_USD, 'BINANCE_MAX_DAILY_USD', DEFAULT_MAX_DAILY_USD);

  const testnetApiKey = optionalTrimmed(environment.BINANCE_TESTNET_API_KEY);
  const testnetApiSecret = optionalTrimmed(environment.BINANCE_TESTNET_API_SECRET);

  if (source === 'testnet') {
    return {
      source,
      mcpTransport,
      mcpDegrade,
      allowedSymbols,
      maxOrderUsd,
      maxDailyUsd,
      testnetApiKey: required(environment, 'BINANCE_TESTNET_API_KEY', 'when BINANCE_TOOLS_SOURCE=testnet'),
      testnetApiSecret: required(environment, 'BINANCE_TESTNET_API_SECRET', 'when BINANCE_TOOLS_SOURCE=testnet'),
    };
  }

  if (source === 'mcp') {
    return {
      source,
      mcpUrl: parseMcpUrl(optionalTrimmed(environment.BINANCE_MCP_URL) ?? DEFAULT_BINANCE_MCP_URL),
      mcpToken: optionalTrimmed(environment.BINANCE_MCP_TOKEN),
      mcpTransport,
      mcpDegrade,
      allowedSymbols,
      maxOrderUsd,
      maxDailyUsd,
      // Degrade is the default: it needs a testnet destination, so credentials are
          // required. When an operator disables degrade (false) they run mcp against the
          // OAuth token alone and surface connect errors instead of falling back.
          testnetApiKey: mcpDegrade
            ? required(environment, 'BINANCE_TESTNET_API_KEY', 'when BINANCE_TOOLS_SOURCE=mcp (testnet fallback)')
            : optionalTrimmed(environment.BINANCE_TESTNET_API_KEY),
          testnetApiSecret: mcpDegrade
            ? required(environment, 'BINANCE_TESTNET_API_SECRET', 'when BINANCE_TOOLS_SOURCE=mcp (testnet fallback)')
            : optionalTrimmed(environment.BINANCE_TESTNET_API_SECRET),
    };
  }

  return {
    source,
    mcpTransport,
    mcpDegrade,
    allowedSymbols,
    maxOrderUsd,
    maxDailyUsd,
    testnetApiKey,
    testnetApiSecret,
  };
}
