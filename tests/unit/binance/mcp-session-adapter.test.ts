import { describe, it, expect, vi } from 'vitest';
import { McpBinanceSessionAdapter, McpToolUnavailableError } from '../../../src/binance/mcp-remote-client.js';
import type { McpBinanceSession } from '../../../src/binance/mcp-remote-client.js';

/**
 * Mock session that speaks the real Binance Agent OS protocol: tools are
 * discovered through `tool_search` (paginated per category) and executed through
 * `tool_execute` by name. The spot.* tools are virtual: they are NOT listed in
 * tools/list, only returned by tool_search descriptors.
 */

type Catalog = Record<string, Array<{ name: string }>>;

function realProtocolSession(catalog: Catalog, execute: (toolName: string, args: Record<string, unknown>) => unknown): McpBinanceSession {
  return {
    connect: vi.fn(async () => {}),
    searchTools: vi.fn(async (category: string) => ({ tools: catalog[category] ?? [] })),
    executeTool: vi.fn(async (toolName: string, args: Record<string, unknown>) => execute(toolName, args)),
    close: vi.fn(async () => {}),
  } as unknown as McpBinanceSession;
}

const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

const FULL_CATALOG: Catalog = {
  'market-data': [{ name: 'spot.tickerPrice' }, { name: 'spot.ticker24hr' }],
  account: [{ name: 'spot.getAccount' }, { name: 'spot.myTrades' }],
  trade: [{ name: 'spot.newOrder' }],
};

const clock = () => '2026-01-01T00:00:00.000Z';

describe('McpBinanceSessionAdapter real Agent OS mapping', () => {
  it('maps getMarketQuote to spot.tickerPrice + spot.ticker24hr and decodes bid/ask/last/change', async () => {
    const session = realProtocolSession(FULL_CATALOG, (toolName, args) => {
      if (toolName === 'spot.tickerPrice') return text({ symbol: args.symbol, price: '60002.50' });
      if (toolName === 'spot.ticker24hr') {
        return text({
          symbol: args.symbol,
          bidPrice: '60000.00',
          askPrice: '60005.00',
          lastPrice: '60002.50',
          priceChangePercent: '2.50',
          closeTime: 1767225600000,
        });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    const quote = await adapter.getMarketQuote('BTC');

    expect(session.executeTool).toHaveBeenCalledWith('spot.tickerPrice', { symbol: 'BTCUSDT' });
    expect(session.executeTool).toHaveBeenCalledWith('spot.ticker24hr', { symbol: 'BTCUSDT' });
    expect(quote.symbol).toBe('BTC');
    expect(quote.bid).toBe('60000.00');
    expect(quote.ask).toBe('60005.00');
    expect(quote.last).toBe('60002.50');
    expect(quote.change24h).toBe('2.50');
    expect(quote.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps getBalance to spot.getAccount and decodes balances', async () => {
    const session = realProtocolSession(FULL_CATALOG, (toolName) => {
      if (toolName === 'spot.getAccount') {
        return text({ canTrade: true, balances: [{ asset: 'USDT', free: '10000', locked: '0' }] });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    const balances = await adapter.getBalance();

    expect(session.executeTool).toHaveBeenCalledWith('spot.getAccount', {});
    expect(balances).toEqual([{ asset: 'USDT', free: '10000', locked: '0', total: '10000' }]);
  });

  it('maps a MARKET order to spot.newOrder with quoteOrderQty for a USD amount', async () => {
    const session = realProtocolSession(FULL_CATALOG, (toolName, args) => {
      if (toolName === 'spot.newOrder') {
        return text({ orderId: 4242, status: 'NEW', executedQty: '0', symbol: args.symbol });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    const result = await adapter.placeOrder({ symbol: 'BTC', side: 'BUY', type: 'MARKET', quantity: '0.01' });

    expect(session.executeTool).toHaveBeenCalledWith('spot.newOrder', {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: '0.01',
    });
    expect(result.order.orderId).toBe(4242);
    expect(result.order.symbol).toBe('BTC');
    expect(result.order.status).toBe('NEW');
    expect(result.order.quantity).toBe('0.01');
  });

  it('maps a MARKET order to spot.newOrder with quoteOrderQty when a USD amount is given', async () => {
    const session = realProtocolSession(FULL_CATALOG, (toolName, args) => {
      if (toolName === 'spot.newOrder') {
        return text({ orderId: 4243, status: 'NEW', executedQty: '0', symbol: args.symbol });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    await adapter.placeOrder({ symbol: 'BNB', side: 'BUY', type: 'MARKET', quoteOrderQty: '50' });

    expect(session.executeTool).toHaveBeenCalledWith('spot.newOrder', {
      symbol: 'BNBUSDT',
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: '50',
    });
  });

  it('maps getHistory to spot.myTrades and decodes filled trades', async () => {
    const session = realProtocolSession(FULL_CATALOG, (toolName, args) => {
      if (toolName === 'spot.myTrades') {
        return text([
          { id: 1, symbol: args.symbol, price: '60000', qty: '0.01', quoteQty: '600', time: 1767225600000, isBuyer: true },
        ]);
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    const history = await adapter.getHistory('BTC');

    expect(session.executeTool).toHaveBeenCalledWith('spot.myTrades', { symbol: 'BTCUSDT' });
    expect(history).toEqual([
      { id: '1', type: 'order', asset: 'BTC', amount: '0.01', status: 'FILLED', timestamp: '2026-01-01T00:00:00.000Z', detail: 'BUY 0.01' },
    ]);
  });

  it('surfaces a typed unavailable error when no internal transfer tool is in the granted scopes', async () => {
    const session = realProtocolSession(FULL_CATALOG, () => {
      throw new Error('should not be called');
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    await expect(
      adapter.internalTransfer({ asset: 'USDT', amount: '5000', from: 'spot', to: 'funding' }),
    ).rejects.toBeInstanceOf(McpToolUnavailableError);
  });

  it('calls a discovered transfer tool when one is present in the scopes', async () => {
    const catalog: Catalog = { ...FULL_CATALOG, 'asset-management': [{ name: 'wallet.assetTransfer' }] };
    const session = realProtocolSession(catalog, (toolName, args) => {
      if (toolName === 'wallet.assetTransfer') {
        return text({ tranId: 'T-42', status: 'COMPLETED', asset: args.asset });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    const result = await adapter.internalTransfer({ asset: 'USDT', amount: '5000', from: 'spot', to: 'funding' });

    expect(session.executeTool).toHaveBeenCalledWith('wallet.assetTransfer', expect.objectContaining({ asset: 'USDT' }));
    expect(result.transfer.transferId).toBe('T-42');
    expect(result.transfer.status).toBe('COMPLETED');
  });

  it('throws a typed unavailable error with the discovered catalog when a required tool is renamed or missing', async () => {
    const catalog: Catalog = { 'market-data': [{ name: 'spot.ticker24hr' }] };
    const session = realProtocolSession(catalog, () => {
      throw new Error('should not be called');
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    await expect(adapter.getMarketQuote('BTC')).rejects.toBeInstanceOf(McpToolUnavailableError);
  });

  it('discovers the tool catalog once and caches it for the session', async () => {
    const session = realProtocolSession(FULL_CATALOG, (toolName) => {
      if (toolName === 'spot.tickerPrice') return text({ symbol: 'BTCUSDT', price: '60002.50' });
      if (toolName === 'spot.ticker24hr') {
        return text({ symbol: 'BTCUSDT', bidPrice: '60000.00', askPrice: '60005.00', lastPrice: '60002.50', priceChangePercent: '2.50', closeTime: 1767225600000 });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const adapter = new McpBinanceSessionAdapter(session, clock);
    await adapter.getMarketQuote('BTC');
    const callsAfterFirst = (session.searchTools as ReturnType<typeof vi.fn>).mock.calls.length;
    await adapter.getMarketQuote('ETH');
    const callsAfterSecond = (session.searchTools as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it('paginates tool_search via nextCursor until a category is exhausted', async () => {
    let marketDataCalls = 0;
    const session = {
      connect: vi.fn(async () => {}),
      searchTools: vi.fn(async (category: string, cursor?: string) => {
        if (category === 'market-data') {
          marketDataCalls += 1;
          if (!cursor && marketDataCalls === 1) {
            return { tools: [{ name: 'spot.tickerPrice' }], nextCursor: 'page-2' };
          }
          return { tools: [{ name: 'spot.ticker24hr' }] };
        }
        if (category === 'account') return { tools: [{ name: 'spot.getAccount' }, { name: 'spot.myTrades' }] };
        if (category === 'trade') return { tools: [{ name: 'spot.newOrder' }] };
        return { tools: [] };
      }),
      executeTool: vi.fn(async (toolName: string) => {
        if (toolName === 'spot.tickerPrice') return text({ symbol: 'BTCUSDT', price: '60002.50' });
        if (toolName === 'spot.ticker24hr') {
          return text({ symbol: 'BTCUSDT', bidPrice: '60000.00', askPrice: '60005.00', lastPrice: '60002.50', priceChangePercent: '2.50', closeTime: 1767225600000 });
        }
        throw new Error(`Unexpected tool ${toolName}`);
      }),
      close: vi.fn(async () => {}),
    } as unknown as McpBinanceSession;

    const adapter = new McpBinanceSessionAdapter(session, clock);
    const quote = await adapter.getMarketQuote('BTC');
    expect(quote.bid).toBe('60000.00');
    expect(quote.ask).toBe('60005.00');
    // The market-data category required two pages to expose both quote tools.
    expect(marketDataCalls).toBe(2);
  });
});
