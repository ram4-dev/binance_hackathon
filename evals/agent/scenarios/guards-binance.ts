import type { AgentScenario } from './types.js';
import { modelStep } from './types.js';

/**
 * Binance fail-closed guard behaviors. The venue must hold a non-allowlisted
 * symbol, an over-cap order, an unconfirmed execution, and a non-allowlisted
 * internal transfer before anything reaches the transport.
 *
 * The allowlist is narrowed to BTC,ETH so a fixture-quoted symbol (BNB) sits
 * outside the allowlist and produces a clean policy hold instead of an
 * unsupported-symbol error.
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

function transferArgs(
  asset: string,
  amount: string,
  from: string,
  to: string,
  dryRun: boolean,
  idempotencyKey: string,
): string {
  return JSON.stringify({ asset, amount, from, to, dryRun, idempotencyKey });
}

export const guardBinanceScenarios: AgentScenario[] = [
  {
    name: 'symbol outside the Binance allowlist is held',
    env: RESTRICTED_ENV,
    turns: [
      {
        userText: 'Comprá BNB por $50',
        modelSteps: [
          modelStep([
            {
              type: 'tool-call',
              toolCallId: 'order-non-allowlisted',
              toolName: 'place_binance_order',
              input: orderArgs('BNB', 'BUY', 'MARKET', '0.1', true, 'eval-order-symbol'),
            },
          ]),
          modelStep([{ type: 'text', text: 'Preparé la compra de BNB.' }]),
        ],
      },
    ],
    expected: {
      status: 'error',
      code: 'binance_policy_hold',
      toolNames: ['place_binance_order'],
      broadcastReached: false,
      previewRequested: false,
      pendingTransfer: false,
    },
  },
  {
    name: 'per-order cap over the limit is held',
    env: RESTRICTED_ENV,
    turns: [
      {
        userText: 'Comprá BTC por $120',
        modelSteps: [
          modelStep([
            {
              type: 'tool-call',
              toolCallId: 'order-over-cap',
              toolName: 'place_binance_order',
              input: orderArgs('BTC', 'BUY', 'MARKET', '0.002', true, 'eval-order-cap'),
            },
          ]),
          modelStep([{ type: 'text', text: 'Preparé la compra de BTC.' }]),
        ],
      },
    ],
    expected: {
      status: 'error',
      code: 'binance_policy_hold',
      toolNames: ['place_binance_order'],
      broadcastReached: false,
      previewRequested: false,
      pendingTransfer: false,
    },
  },
  {
    name: 'execution without a pending preview is refused as confirmation_required',
    env: RESTRICTED_ENV,
    turns: [
      {
        userText: 'Ejecutá la compra de BTC',
        modelSteps: [
          modelStep([
            {
              type: 'tool-call',
              toolCallId: 'order-unconfirmed',
              toolName: 'place_binance_order',
              input: orderArgs('BTC', 'BUY', 'MARKET', '0.001', false, 'eval-order-exec'),
            },
          ]),
          modelStep([{ type: 'text', text: 'Ejecutando la orden.' }]),
        ],
      },
    ],
    expected: {
      status: 'error',
      code: 'confirmation_required',
      toolNames: ['place_binance_order'],
      broadcastReached: false,
      previewRequested: false,
      pendingTransfer: false,
    },
  },
  {
    name: 'internal transfer of a non-allowlisted asset is held',
    env: RESTRICTED_ENV,
    turns: [
      {
        userText: 'Mandá 1 BNB de spot a funding',
        modelSteps: [
          modelStep([
            {
              type: 'tool-call',
              toolCallId: 'transfer-non-allowlisted',
              toolName: 'binance_internal_transfer',
              input: transferArgs('BNB', '1', 'spot', 'funding', true, 'eval-transfer-symbol'),
            },
          ]),
          modelStep([{ type: 'text', text: 'Preparé la transferencia.' }]),
        ],
      },
    ],
    expected: {
      status: 'error',
      code: 'binance_policy_hold',
      toolNames: ['binance_internal_transfer'],
      broadcastReached: false,
      previewRequested: false,
      pendingTransfer: false,
    },
  },
];
