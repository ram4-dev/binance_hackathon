import { describe, it, expect } from 'vitest';
import { readBinanceConfig } from '../../../src/config/binance.js';

describe('readBinanceConfig', () => {
  it('defaults to fixture when no source is set', () => {
    const config = readBinanceConfig({});
    expect(config.source).toBe('fixture');
    expect(config.allowedSymbols).toEqual(['BTC', 'ETH', 'BNB']);
    expect(config.maxOrderUsd).toBeGreaterThan(0);
    expect(config.maxDailyUsd).toBeGreaterThan(0);
  });

  it('rejects BINANCE_TOOLS_SOURCE=live fail-closed', () => {
    expect(() => readBinanceConfig({ BINANCE_TOOLS_SOURCE: 'live' })).toThrow(/live/i);
  });

  it('rejects an unknown BINANCE_TOOLS_SOURCE', () => {
    expect(() => readBinanceConfig({ BINANCE_TOOLS_SOURCE: 'garbage' })).toThrow(/BINANCE_TOOLS_SOURCE/);
  });

  it('requires testnet credentials when source is testnet', () => {
    expect(() => readBinanceConfig({ BINANCE_TOOLS_SOURCE: 'testnet' })).toThrow(/BINANCE_TESTNET_API_KEY/);
    const config = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'testnet',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    });
    expect(config.source).toBe('testnet');
    expect(config.testnetApiKey).toBe('key');
    expect(config.testnetApiSecret).toBe('secret');
  });

  it('requires BINANCE_MCP_URL when source is mcp', () => {
    expect(() => readBinanceConfig({ BINANCE_TOOLS_SOURCE: 'mcp' })).toThrow(/BINANCE_MCP_URL/);
  });

  it('rejects a non-http BINANCE_MCP_URL fail-closed', () => {
    expect(() => readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_URL: 'ftp://nope.example.com/mcp',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    })).toThrow(/BINANCE_MCP_URL/);
  });

  it('rejects an invalid BINANCE_MCP_TRANSPORT fail-closed', () => {
    expect(() => readBinanceConfig({ BINANCE_MCP_TRANSPORT: 'carrier-pigeon' })).toThrow(/BINANCE_MCP_TRANSPORT/);
  });

  it('rejects a non-positive BINANCE_MAX_ORDER_USD fail-closed', () => {
    expect(() => readBinanceConfig({ BINANCE_MAX_ORDER_USD: '0' })).toThrow(/BINANCE_MAX_ORDER_USD/);
    expect(() => readBinanceConfig({ BINANCE_MAX_ORDER_USD: 'abc' })).toThrow(/BINANCE_MAX_ORDER_USD/);
  });

  it('rejects a non-positive BINANCE_MAX_DAILY_USD fail-closed', () => {
    expect(() => readBinanceConfig({ BINANCE_MAX_DAILY_USD: '-5' })).toThrow(/BINANCE_MAX_DAILY_USD/);
  });

  it('parses BINANCE_ALLOWED_SYMBOLS as uppercase unique symbols', () => {
    const config = readBinanceConfig({ BINANCE_ALLOWED_SYMBOLS: 'btc, eth, BTC' });
    expect(config.allowedSymbols).toEqual(['BTC', 'ETH']);
  });

  it('accepts BINANCE_MCP_TOKEN and BINANCE_MCP_TRANSPORT', () => {
    const config = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_URL: 'https://mcp.example.com/mcp',
      BINANCE_MCP_TOKEN: 'token',
      BINANCE_MCP_TRANSPORT: 'sse',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    });
    expect(config.mcpUrl).toBe('https://mcp.example.com/mcp');
    expect(config.mcpToken).toBe('token');
    expect(config.mcpTransport).toBe('sse');
  });
});
