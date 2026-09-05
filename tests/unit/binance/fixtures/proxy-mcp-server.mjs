// Fake Binance MCP server used by the mcp-remote proxy transport tests.
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

if (MODE === 'auth-required') {
  process.stderr.write('[12345] Authentication required. Initializing auth...\n');
  process.stderr.write('[12345] To authorize this client, visit: https://accounts.binance.com/agentic-oauth/authorize\n');
  process.stderr.write('[12345] Could not open a browser automatically. Please copy and paste the URL above into your browser.\n');
  setTimeout(() => process.exit(1), 50);
} else {
  const server = new McpServer({ name: 'fake-binance', version: '0.0.1' });

  server.registerTool('get_market_quote', {
    description: 'Read a live Binance market quote.',
    inputSchema: { symbol: z.string().optional() },
  }, (args) => {
    const symbol = (args?.symbol ?? 'BTC').toUpperCase();
    return textResult({
      symbol,
      bid: '60000.00',
      ask: '60005.00',
      last: '60002.50',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  server.registerTool('get_binance_balance', {
    description: 'Read Binance balances.',
    inputSchema: { asset: z.string().optional() },
  }, () =>
    textResult({ balances: [{ asset: 'USDT', free: '10000', locked: '0' }] }),
  );

  server.registerTool('place_binance_order', {
    description: 'Place a Binance order.',
    inputSchema: {
      symbol: z.string(),
      side: z.string(),
      type: z.string(),
      quantity: z.string(),
    },
  }, (args) =>
    textResult({ orderId: 4242, status: 'NEW', executedQty: '0', symbol: (args?.symbol ?? '').toUpperCase() }),
  );

  server.registerTool('binance_internal_transfer', {
    description: 'Internal Binance transfer.',
    inputSchema: { asset: z.string(), amount: z.string() },
  }, (args) =>
    textResult({ tranId: 'T-42', status: 'COMPLETED', asset: (args?.asset ?? '').toUpperCase() }),
  );

  server.registerTool('get_binance_history', {
    description: 'Read Binance history.',
    inputSchema: { asset: z.string().optional() },
  }, () =>
    textResult({
      history: [{ orderId: '1', symbol: 'BTC', status: 'FILLED', executedQty: '0.01' }],
    }),
  );

  server.registerTool('hang_forever', {
    description: 'Never resolves; probe for client timeouts.',
    inputSchema: {},
  }, () => new Promise(() => {}));

  await server.connect(new StdioServerTransport());
}
