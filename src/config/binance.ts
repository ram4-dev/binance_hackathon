import type { BinanceToolsSource } from '../binance/types.js';

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
  const allowedSymbols = parseAllowedSymbols(environment.BINANCE_ALLOWED_SYMBOLS);
  const maxOrderUsd = positiveNumber(environment.BINANCE_MAX_ORDER_USD, 'BINANCE_MAX_ORDER_USD', DEFAULT_MAX_ORDER_USD);
  const maxDailyUsd = positiveNumber(environment.BINANCE_MAX_DAILY_USD, 'BINANCE_MAX_DAILY_USD', DEFAULT_MAX_DAILY_USD);

  const testnetApiKey = optionalTrimmed(environment.BINANCE_TESTNET_API_KEY);
  const testnetApiSecret = optionalTrimmed(environment.BINANCE_TESTNET_API_SECRET);

  if (source === 'testnet') {
    return {
      source,
      mcpTransport,
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
      mcpUrl: parseMcpUrl(optionalTrimmed(environment.BINANCE_MCP_URL)),
      mcpToken: optionalTrimmed(environment.BINANCE_MCP_TOKEN),
      mcpTransport,
      allowedSymbols,
      maxOrderUsd,
      maxDailyUsd,
      testnetApiKey: required(environment, 'BINANCE_TESTNET_API_KEY', 'when BINANCE_TOOLS_SOURCE=mcp (testnet fallback)'),
      testnetApiSecret: required(environment, 'BINANCE_TESTNET_API_SECRET', 'when BINANCE_TOOLS_SOURCE=mcp (testnet fallback)'),
    };
  }

  return {
    source,
    mcpTransport,
    allowedSymbols,
    maxOrderUsd,
    maxDailyUsd,
    testnetApiKey,
    testnetApiSecret,
  };
}
