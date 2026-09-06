// Fake Binance Agent OS MCP server used by the mcp transport tests.
//
// It mirrors the REAL Agent OS protocol shape: `tools/list` exposes only the
// discovery/execution tools (`tool_search` and `tool_execute`); every other
// capability (spot.tickerPrice, spot.getAccount, spot.newOrder, spot.myTrades,
// wallet.assetTransfer) is VIRTUAL — it is not registered as a top-level tool but
// is discovered through `tool_search` (paginated by category) and executed through
// `tool_execute` by name.
//
// It speaks the MCP stdio protocol (newline-delimited JSON over stdin/stdout) so
// the SDK `Client` can connect to it exactly as it would connect to mcp-remote.
//
// Two modes:
//   * default: a working server that lists/calls the Binance tools and echoes
//     canned payloads, plus `hang_forever` as a timeout probe.
//   * MCP_PROXY_FIXTURE_MODE=auth-required: writes OAuth "authentication
//     required" markers to stderr and exits with code 1, simulating a first-run
//     connection where the operator has not authenticated yet.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const MODE = process.env.MCP_PROXY_FIXTURE_MODE;

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

// Virtual tool catalog returned by tool_search, grouped by the categories the
// real server uses. Each entry carries the descriptor the adapter reads.
const CATALOG = {
  'market-data': [
    { name: 'spot.tickerPrice', description: 'Read the latest price for a symbol.', inputSchema: { symbol: z.string().optional() } },
    { name: 'spot.ticker24hr', description: 'Read 24-hour statistics for a symbol.', inputSchema: { symbol: z.string().optional() } },
  ],
  account: [
    { name: 'spot.getAccount', description: 'Read the authorized spot account.', inputSchema: {} },
    { name: 'spot.myTrades', description: 'Read the authorized account trades.', inputSchema: { symbol: z.string().optional() } },
  ],
  trade: [
    {
      name: 'spot.newOrder',
      description: 'Place a spot order.',
      inputSchema: {
        symbol: z.string(),
        side: z.string(),
        type: z.string(),
        quantity: z.string().optional(),
        quoteOrderQty: z.string().optional(),
      },
    },
  ],
  'asset-management': [
    { name: 'wallet.assetTransfer', description: 'Transfer an asset internally.', inputSchema: { asset: z.string(), amount: z.string() } },
  ],
};

if (MODE === 'auth-required') {
  process.stderr.write('[12345] Authentication required. Initializing auth...\n');
  process.stderr.write('[12345] To authorize this client, visit: https://accounts.binance.com/agentic-oauth/authorize\n');
  process.stderr.write('[12345] Could not open a browser automatically. Please copy and paste the URL above into your browser.\n');
  setTimeout(() => process.exit(1), 50);
} else {
  const server = new McpServer({ name: 'fake-binance', version: '0.0.1' });

  server.registerTool('tool_search', {
    description: 'Discover Binance Agent OS tools by category (paginated).',
    inputSchema: { category: z.string(), cursor: z.string().optional() },
  }, (args) => {
    const category = args?.category ?? 'market-data';
    return textResult({ tools: CATALOG[category] ?? [] });
  });

  server.registerTool('tool_execute', {
    description: 'Execute a discovered Binance Agent OS tool by name.',
    inputSchema: { toolName: z.string(), arguments: z.record(z.any()).optional() },
  }, (args) => {
    const toolName = args?.toolName ?? '';
    const toolArgs = args?.arguments ?? {};
    switch (toolName) {
      case 'spot.tickerPrice': {
        const symbol = String(toolArgs.symbol ?? 'BTCUSDT').toUpperCase();
        return textResult({ symbol, price: '60002.50' });
      }
      case 'spot.ticker24hr': {
        const symbol = String(toolArgs.symbol ?? 'BTCUSDT').toUpperCase();
        return textResult({
          symbol,
          bidPrice: '60000.00',
          askPrice: '60005.00',
          lastPrice: '60002.50',
          priceChangePercent: '2.50',
          closeTime: 1767225600000,
        });
      }
      case 'spot.getAccount': {
        return textResult({ canTrade: true, balances: [{ asset: 'USDT', free: '10000', locked: '0' }] });
      }
      case 'spot.myTrades': {
        const symbol = String(toolArgs.symbol ?? 'BTCUSDT').toUpperCase();
        return textResult([{ id: 1, symbol, price: '60000', qty: '0.01', quoteQty: '600', time: 1767225600000, isBuyer: true }]);
      }
      case 'spot.newOrder': {
        const symbol = String(toolArgs.symbol ?? 'BTCUSDT').toUpperCase();
        return textResult({ orderId: 4242, status: 'NEW', executedQty: '0', symbol });
      }
      case 'wallet.assetTransfer': {
        const asset = String(toolArgs.asset ?? 'USDT').toUpperCase();
        return textResult({ tranId: 'T-42', status: 'COMPLETED', asset });
      }
      case 'hang_forever':
        return new Promise(() => {});
      default:
        return textResult({ error: `Unknown tool ${toolName}` });
    }
  });

  server.registerTool('hang_forever', {
    description: 'Never resolves; probe for client timeouts.',
    inputSchema: {},
  }, () => new Promise(() => {}));

  await server.connect(new StdioServerTransport());
}
