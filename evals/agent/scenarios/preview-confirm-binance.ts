import type { AgentScenario } from './types.js';
import { modelStep } from './types.js';

/**
 * Preview → confirm flow for a Binance order: a correct dry-run preview stages a
 * pending Binance order, and the explicit confirm turn executes it against the
 * fixture transport and clears the pending intent.
 */
const RESTRICTED_ENV = {
  BINANCE_ALLOWED_SYMBOLS: 'BTC,ETH',
};

function orderArgs(
  symbol: string,
  side: 'BUY' | 'SELL',
  orderType: 'MARKET' | 'LIMIT',
  quantity: string,
  dryRun: boolean,
  idempotencyKey: string,
): string {
  return JSON.stringify({ symbol, side, orderType, quantity, dryRun, idempotencyKey });
}

export const previewConfirmBinanceScenarios: AgentScenario[] = [
  {
    name: 'correct Binance preview then explicit confirm reaches a fixture execution',
    env: RESTRICTED_ENV,
    turns: [
      {
        userText: 'Comprá 0.001 BTC',
        modelSteps: [
          modelStep([
            {
              type: 'tool-call',
              toolCallId: 'preview-order',
              toolName: 'place_binance_order',
              input: orderArgs('BTC', 'BUY', 'MARKET', '0.001', true, 'eval-order-confirm'),
            },
          ]),
          modelStep([
            { type: 'text', text: 'Preparé la compra de 0.001 BTC. Confirmá para continuar.' },
          ]),
        ],
      },
      { userText: 'confirmo' },
    ],
    expected: {
      status: 'sent',
      toolNames: ['place_binance_order'],
      toolCall: {
        toolName: 'place_binance_order',
        args: {
          symbol: 'BTC',
          side: 'BUY',
          orderType: 'MARKET',
          quantity: '0.001',
          dryRun: true,
          idempotencyKey: 'eval-order-confirm',
        },
      },
      previewRequested: false,
      broadcastReached: true,
      pendingTransfer: false,
    },
  },
];
