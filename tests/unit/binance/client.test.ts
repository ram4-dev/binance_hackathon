import { describe, it, expect } from 'vitest';
import { createBinanceClient, createBinanceClientFromEnv } from '../../../src/binance/client.js';
import { readBinanceConfig } from '../../../src/config/binance.js';

describe('createBinanceClient', () => {
  it('returns a fixture client by default', () => {
    const client = createBinanceClient(readBinanceConfig({}));
    expect(client.source).toBe('fixture');
    expect(client.id).toBe('binance-fixture');
  });

  it('returns a testnet client when source is testnet', () => {
    const client = createBinanceClient(readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'testnet',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    }));
    expect(client.source).toBe('testnet');
    expect(client.id).toBe('binance-testnet');
  });

  it('returns an mcp client when source is mcp', () => {
    const client = createBinanceClient(readBinanceConfig({
      BINANCE_TOOLS_SOURCE: 'mcp',
      BINANCE_MCP_URL: 'https://mcp.example.com/mcp',
      BINANCE_TESTNET_API_KEY: 'key',
      BINANCE_TESTNET_API_SECRET: 'secret',
    }));
    expect(client.source).toBe('mcp');
    expect(client.id).toBe('binance-mcp');
  });
});

describe('createBinanceClientFromEnv', () => {
  it('rejects BINANCE_TOOLS_SOURCE=live fail-closed at startup', () => {
    expect(() => createBinanceClientFromEnv({ BINANCE_TOOLS_SOURCE: 'live' })).toThrow(/live/i);
  });

  it('constructs a fixture client from a clean environment', () => {
    const client = createBinanceClientFromEnv({});
    expect(client.source).toBe('fixture');
  });
});
