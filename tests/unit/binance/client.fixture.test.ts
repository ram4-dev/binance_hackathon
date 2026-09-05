import { describe, it, expect } from 'vitest';
import { FixtureBinanceClient } from '../../../src/binance/client.fixture.js';

const FIXED_CLOCK = () => '2026-01-01T00:00:00.000Z';

describe('FixtureBinanceClient', () => {
  it('returns deterministic quotes for BTC/ETH/BNB', async () => {
    const client = new FixtureBinanceClient({ clock: FIXED_CLOCK });
    const first = await client.getMarketQuote('BTC');
    const second = await client.getMarketQuote('BTC');
    expect(first).toEqual(second);
    expect(first.symbol).toBe('BTC');
    expect(Number(first.bid)).toBeGreaterThan(0);
    expect(Number(first.ask)).toBeGreaterThan(Number(first.bid));
    expect(await client.getMarketQuote('ETH')).not.toEqual(first);
  });

  it('returns a fixed balance for all assets and filters by asset', async () => {
    const client = new FixtureBinanceClient();
    const balance = await client.getBalance();
    expect(balance.map((entry) => entry.asset)).toEqual(['USDT', 'BTC', 'ETH', 'BNB']);
    const btcOnly = await client.getBalance('BTC');
    expect(btcOnly).toHaveLength(1);
    expect(btcOnly[0].asset).toBe('BTC');
  });

  it('simulates a deterministic market order execution with evidence', async () => {
    const a = new FixtureBinanceClient({ clock: FIXED_CLOCK });
    const b = new FixtureBinanceClient({ clock: FIXED_CLOCK });
    const request = { symbol: 'BTC', side: 'BUY', type: 'MARKET', quantity: '0.01' } as const;
    const resultA = await a.placeOrder(request);
    const resultB = await b.placeOrder(request);
    expect(resultA).toEqual(resultB);
    expect(resultA.order.status).toBe('FILLED');
    expect(resultA.order.executedQuantity).toBe('0.01');
    expect(resultA.order.averagePrice).toBe('60005.00');
    expect(resultA.evidence.operation).toBe('order');
    expect(resultA.evidence.source).toBe('fixture');
    expect(resultA.evidence.outcome.status).toBe('completed');
  });

  it('increments order ids deterministically within one client', async () => {
    const client = new FixtureBinanceClient({ clock: FIXED_CLOCK });
    const first = await client.placeOrder({ symbol: 'BTC', side: 'SELL', type: 'MARKET', quantity: '0.01' });
    const second = await client.placeOrder({ symbol: 'BTC', side: 'SELL', type: 'MARKET', quantity: '0.01' });
    expect(second.order.orderId).toBe(first.order.orderId + 1);
  });

  it('simulates an internal transfer with evidence', async () => {
    const client = new FixtureBinanceClient({ clock: FIXED_CLOCK });
    const result = await client.internalTransfer({ asset: 'BNB', amount: '1', from: 'spot', to: 'funding' });
    expect(result.transfer.status).toBe('COMPLETED');
    expect(result.transfer.asset).toBe('BNB');
    expect(result.transfer.amount).toBe('1');
    expect(result.evidence.operation).toBe('transfer');
    expect(result.evidence.source).toBe('fixture');
  });

  it('throws for an unknown quote symbol', async () => {
    const client = new FixtureBinanceClient();
    await expect(client.getMarketQuote('DOGE')).rejects.toThrow(/no quote/i);
  });

  it('returns an empty balance for an unknown asset', async () => {
    const client = new FixtureBinanceClient();
    expect(await client.getBalance('DOGE')).toEqual([]);
  });

  it('reports a healthy fixture', async () => {
    const client = new FixtureBinanceClient();
    const health = await client.health();
    expect(health.status).toBe('healthy');
    expect(health.source).toBe('fixture');
  });
});
