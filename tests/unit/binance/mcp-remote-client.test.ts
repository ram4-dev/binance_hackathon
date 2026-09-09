import { describe, it, expect, vi } from 'vitest';
import { McpRemoteBinanceClient } from '../../../src/binance/mcp-remote-client.js';
import { readBinanceConfig } from '../../../src/config/binance.js';
import type { BinanceClient } from '../../../src/binance/client.js';

const config = () => readBinanceConfig({
  BINANCE_TOOLS_SOURCE: 'mcp',
  BINANCE_MCP_URL: 'https://mcp.example.com/mcp',
  BINANCE_TESTNET_API_KEY: 'key',
  BINANCE_TESTNET_API_SECRET: 'secret',
});

function fakeTestnet(): BinanceClient {
  return {
    id: 'binance-testnet',
    source: 'testnet',
    health: vi.fn(async () => ({ status: 'healthy', source: 'testnet' })),
    getMarketQuote: vi.fn(async () => ({ symbol: 'BTC', bid: '1', ask: '2', last: '1.5', timestamp: '2026-01-01T00:00:00.000Z' })),
    getBalance: vi.fn(async () => []),
    placeOrder: vi.fn(async () => ({ order: {} as never, evidence: {} as never })),
    internalTransfer: vi.fn(async () => ({ transfer: {} as never, evidence: {} as never })),
    getHistory: vi.fn(async () => []),
    close: vi.fn(async () => {}),
  } as unknown as BinanceClient;
}

function failingSession() {
  return {
    connect: vi.fn(async () => { throw new Error('MCP server unreachable'); }),
    searchTools: vi.fn(async () => ({ tools: [] })),
    executeTool: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
  };
}
    
function workingSession() {
  return {
    connect: vi.fn(async () => {}),
    searchTools: vi.fn(async () => ({ tools: [] })),
    executeTool: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })),
    close: vi.fn(async () => {}),
  };
}

describe('McpRemoteBinanceClient degrade path', () => {
  it('degrades to testnet on MCP connection failure and records the reason (never silently)', async () => {
    const testnet = fakeTestnet();
    const client = new McpRemoteBinanceClient({
      config: config(),
      createSession: async () => failingSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    const health = await client.health();
    expect(health.status).toBe('degraded');
    expect(health.source).toBe('mcp');
    expect(health.degradation?.to).toBe('testnet');
    expect(health.degradation?.reason).toContain('MCP server unreachable');
    expect(client.degradation?.to).toBe('testnet');
    expect(client.degradation?.reason).toContain('MCP server unreachable');

    // Subsequent operations are served by the testnet fallback.
    const quote = await client.getMarketQuote('BTC');
    expect(quote.symbol).toBe('BTC');
    expect(testnet.getMarketQuote).toHaveBeenCalledWith('BTC');
  });

  it('does not degrade when the MCP session connects successfully', async () => {
    const client = new McpRemoteBinanceClient({
      config: config(),
      createSession: async () => workingSession(),
      createTestnetClient: () => fakeTestnet(),
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    const health = await client.health();
    expect(health.status).toBe('healthy');
    expect(client.degradation).toBeUndefined();
  });

  it('delegates close to the testnet fallback after degradation', async () => {
    const testnet = fakeTestnet();
    const client = new McpRemoteBinanceClient({
      config: config(),
      createSession: async () => failingSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    await client.health();
    await client.close();
    expect(testnet.close).toHaveBeenCalled();
  });
});

describe('McpRemoteBinanceClient with degrade disabled', () => {
  it('surfaces the connection error instead of degrading when mcpDegrade is false', async () => {
    const testnet = fakeTestnet();
    const client = new McpRemoteBinanceClient({
      config: readBinanceConfig({
BINANCE_TOOLS_SOURCE: 'mcp',
BINANCE_MCP_URL: 'https://mcp.example.com/mcp',
BINANCE_MCP_DEGRADE: 'false',
      }),
      createSession: async () => failingSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    await expect(client.health()).rejects.toThrow('MCP server unreachable');
    expect(client.degradation).toBeUndefined();
    expect(testnet.getMarketQuote).not.toHaveBeenCalled();
  });

  it('still degrades when mcpDegrade is explicitly true', async () => {
    const testnet = fakeTestnet();
    const client = new McpRemoteBinanceClient({
      config: readBinanceConfig({
BINANCE_TOOLS_SOURCE: 'mcp',
BINANCE_MCP_URL: 'https://mcp.example.com/mcp',
BINANCE_MCP_DEGRADE: 'true',
BINANCE_TESTNET_API_KEY: 'key',
BINANCE_TESTNET_API_SECRET: 'secret',
      }),
      createSession: async () => failingSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    const health = await client.health();
    expect(health.status).toBe('degraded');
    expect(health.degradation?.to).toBe('testnet');
  });
});
