import { describe, it, expect, vi } from 'vitest';
import { McpProxyBinanceClient, McpAuthRequiredError } from '../../../src/binance/mcp-proxy-client.js';
import { readBinanceConfig } from '../../../src/config/binance.js';
import type { BinanceClient } from '../../../src/binance/client.js';

const config = () =>
  readBinanceConfig({
    BINANCE_TOOLS_SOURCE: 'mcp',
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
    connect: vi.fn(async () => { throw new Error('mcp-remote failed to start'); }),
    listTools: vi.fn(async () => ({ tools: [] })),
    callTool: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
  };
}

function authSession() {
  return {
    connect: vi.fn(async () => { throw new McpAuthRequiredError('https://agent.binance.com/mcp/agentic'); }),
    listTools: vi.fn(async () => ({ tools: [] })),
    callTool: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
  };
}

function workingSession() {
  const text = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  return {
    connect: vi.fn(async () => {}),
    listTools: vi.fn(async () => ({ tools: [] })),
    callTool: vi.fn(async (name: string) => {
      if (name === 'get_market_quote') {
        return text({ symbol: 'BTC', bid: '60000.00', ask: '60005.00', last: '60002.50', timestamp: '2026-01-01T00:00:00.000Z' });
      }
      if (name === 'get_binance_balance') {
        return text({ balances: [{ asset: 'USDT', free: '10000', locked: '0' }] });
      }
      if (name === 'place_binance_order') {
        return text({ orderId: 7, status: 'NEW', executedQty: '0', symbol: 'BTC' });
      }
      if (name === 'get_binance_history') {
        return text({ history: [] });
      }
      return text({});
    }),
    close: vi.fn(async () => {}),
  };
}

describe('McpProxyBinanceClient degrade path', () => {
  it('degrades to testnet on a generic connection failure and records the reason', async () => {
    const testnet = fakeTestnet();
    const client = new McpProxyBinanceClient({
      config: config(),
      createSession: async () => failingSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    const health = await client.health();
    expect(health.status).toBe('degraded');
    expect(health.source).toBe('mcp');
    expect(health.degradation?.to).toBe('testnet');
    expect(health.degradation?.reason).toContain('mcp-remote failed to start');
    expect(client.degradation?.to).toBe('testnet');

    const quote = await client.getMarketQuote('BTC');
    expect(quote.symbol).toBe('BTC');
    expect(testnet.getMarketQuote).toHaveBeenCalledWith('BTC');
  });

  it('does not degrade and delegates closed to the testnet fallback', async () => {
    const testnet = fakeTestnet();
    const client = new McpProxyBinanceClient({
      config: config(),
      createSession: async () => failingSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    await client.health();
    await client.close();
    expect(testnet.close).toHaveBeenCalled();
  });

  it('connects and bridges a market quote when the session is healthy', async () => {
    const client = new McpProxyBinanceClient({
      config: config(),
      createSession: async () => workingSession(),
      createTestnetClient: () => fakeTestnet(),
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    const health = await client.health();
    expect(health.status).toBe('healthy');
    expect(client.degradation).toBeUndefined();

    const quote = await client.getMarketQuote('BTC');
    expect(quote.symbol).toBe('BTC');
    expect(quote.bid).toBe('60000.00');
    expect(quote.ask).toBe('60005.00');
  });

  it('surfaces Binance evidence from a bridged order', async () => {
    const client = new McpProxyBinanceClient({
      config: config(),
      createSession: async () => workingSession(),
      createTestnetClient: () => fakeTestnet(),
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    const result = await client.placeOrder({ symbol: 'BTC', side: 'BUY', type: 'MARKET', quantity: '0.01' });
    expect(result.evidence.schemaVersion).toBe('binance-evidence/v1');
    expect(result.evidence.operation).toBe('order');
    expect(result.evidence.source).toBe('mcp');
    expect(result.order.orderId).toBe(7);
    expect(result.order.status).toBe('NEW');
  });
});

describe('McpProxyBinanceClient auth-required path', () => {
  it('does not degrade and reports unavailable with an actionable reason', async () => {
    const testnet = fakeTestnet();
    const client = new McpProxyBinanceClient({
      config: config(),
      createSession: async () => authSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    const health = await client.health();
    expect(health.status).toBe('unavailable');
    expect(health.source).toBe('mcp');
    expect(health.reason).toContain('npx mcp-remote');
    expect(health.reason).toContain('agent.binance.com/mcp/agentic');
  });

  it('throws McpAuthRequiredError from money/read operations instead of testnet fallback', async () => {
    const testnet = fakeTestnet();
    const client = new McpProxyBinanceClient({
      config: config(),
      createSession: async () => authSession(),
      createTestnetClient: () => testnet,
      clock: () => '2026-01-01T00:00:00.000Z',
    });

    await expect(client.getMarketQuote('BTC')).rejects.toBeInstanceOf(McpAuthRequiredError);
    await expect(client.placeOrder({ symbol: 'BTC', side: 'BUY', type: 'MARKET', quantity: '0.01' })).rejects.toBeInstanceOf(McpAuthRequiredError);
    expect(testnet.getMarketQuote).not.toHaveBeenCalled();
  });
});
