import { describe, it, expect } from 'vitest';
import { readBinanceConfig, DEFAULT_BINANCE_MCP_URL } from '../../../src/config/binance.js';

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

  it('defaults BINANCE_MCP_URL to the real Agent OS endpoint when source is mcp', () => {
    const config = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    });
    expect(config.mcpUrl).toBe(DEFAULT_BINANCE_MCP_URL);
  });

  it('respects an explicit BINANCE_MCP_URL when source is mcp', () => {
    const config = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_URL: 'https://other.example.com/mcp',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    });
    expect(config.mcpUrl).toBe('https://other.example.com/mcp');
  });

  it('exposes the auth discriminator: mcpToken present implies direct transport', () => {
    const withToken = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_TOKEN: 'token',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    });
    expect(withToken.mcpToken).toBe('token');

    const withoutToken = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    });
    expect(withoutToken.mcpToken).toBeUndefined();
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

  it('requires testnet credentials when mcp degrade is enabled (default/unset)', () => {
    expect(() => readBinanceConfig({ BINANCE_TOOLS_SOURCE: 'mcp' })).toThrow(/BINANCE_TESTNET_API_KEY/);
    expect(() => readBinanceConfig({ BINANCE_TOOLS_SOURCE: 'mcp', BINANCE_MCP_DEGRADE: 'true' })).toThrow(/BINANCE_TESTNET_API_KEY/);
  });

  it('does not require testnet credentials when mcp degrade is disabled', () => {
    const config = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_DEGRADE: 'false',
    });
    expect(config.source).toBe('mcp');
    expect(config.mcpDegrade).toBe(false);
    expect(config.testnetApiKey).toBeUndefined();
    expect(config.testnetApiSecret).toBeUndefined();
  });

  it('parses BINANCE_MCP_DEGRADE=true explicitly', () => {
    const config = readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_DEGRADE: 'true',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    });
    expect(config.mcpDegrade).toBe(true);
  });

  it('rejects an invalid BINANCE_MCP_DEGRADE fail-closed', () => {
    expect(() => readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_DEGRADE: 'maybe',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    })).toThrow(/BINANCE_MCP_DEGRADE/);
  });
});
