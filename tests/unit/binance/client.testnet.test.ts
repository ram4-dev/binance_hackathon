import { describe, it, expect, vi } from 'vitest';
import { TestnetBinanceClient } from '../../../src/binance/client.testnet.js';
import { readBinanceConfig } from '../../../src/config/binance.js';

const config = readBinanceConfig({
  BINANCE_TOOLS_SOURCE: 'testnet',
  BINANCE_TESTNET_API_KEY: 'test-key',
  BINANCE_TESTNET_API_SECRET: 'test-secret',
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
    status: 200,
  } as unknown as Response;
}

describe('TestnetBinanceClient', () => {
  it('maps a base asset to a USDT pair and parses a market quote', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      symbol: 'BTCUSDT',
      lastPrice: '60002.50',
      bidPrice: '60000.00',
      askPrice: '60005.00',
    }));
    const client = new TestnetBinanceClient({ config, fetchImpl, clock: () => '2026-01-01T00:00:00.000Z' });

    const quote = await client.getMarketQuote('BTC');
    expect(quote.symbol).toBe('BTC');
    expect(quote.bid).toBe('60000.00');
    expect(quote.ask).toBe('60005.00');
    expect(quote.last).toBe('60002.50');

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('/api/v3/ticker/24hr');
    expect(url).toContain('symbol=BTCUSDT');
  });

  it('signs the account request and parses balances', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      balances: [
        { asset: 'BTC', free: '0.5', locked: '0.1' },
        { asset: 'USDT', free: '10000', locked: '0' },
      ],
    }));
    const client = new TestnetBinanceClient({ config, fetchImpl, clock: () => '2026-01-01T00:00:00.000Z' });

    const balances = await client.getBalance();
    expect(balances).toEqual([
      { asset: 'BTC', free: '0.5', locked: '0.1', total: '0.6' },
      { asset: 'USDT', free: '10000', locked: '0', total: '10000' },
    ]);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/api/v3/account');
    expect(String(url)).toContain('timestamp=');
    expect(String(url)).toContain('signature=');
    expect(init?.headers).toMatchObject({ 'X-MBX-APIKEY': 'test-key' });
  });

  it('posts a signed order and parses the execution', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      symbol: 'BNBUSDT',
      orderId: 42,
      status: 'FILLED',
      executedQty: '1.5',
      avgPrice: '500.50',
      side: 'BUY',
      type: 'MARKET',
    }));
    const client = new TestnetBinanceClient({ config, fetchImpl, clock: () => '2026-01-01T00:00:00.000Z' });

    const result = await client.placeOrder({ symbol: 'BNB', side: 'BUY', type: 'MARKET', quantity: '1.5' });
    expect(result.order.symbol).toBe('BNB');
    expect(result.order.status).toBe('FILLED');
    expect(result.order.orderId).toBe(42);
    expect(result.order.executedQuantity).toBe('1.5');
    expect(result.evidence.operation).toBe('order');
    expect(result.evidence.source).toBe('testnet');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/api/v3/order');
    expect(init?.method).toBe('POST');
    expect(String(url)).toContain('symbol=BNBUSDT');
  });

  it('returns unavailable health when the ping fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response);
    const client = new TestnetBinanceClient({ config, fetchImpl, clock: () => '2026-01-01T00:00:00.000Z' });
    const health = await client.health();
    expect(health.status).toBe('unavailable');
  });
});
