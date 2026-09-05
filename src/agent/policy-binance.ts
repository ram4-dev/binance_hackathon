import type { BinanceConfig } from '../config/binance.js';
import { normalizeBinanceSymbol } from '../binance/types.js';

/**
 * Binance CEX policy.
 *
 * All decisions are fail-closed: an ambiguous, non-plain, or over-cap amount is
 * rejected before it can reach the transport. A rejected action is a hold, never
 * a definitive failure, so callers can distinguish "we refused this" from "the
 * venue rejected it". Money-moving operations are the only ones this policy
 * governs; market-data reads (quote/balance/history) never consult it.
 */

export type BinancePolicyCode =
  | 'symbol_not_allowed'
  | 'order_cap_exceeded'
  | 'daily_cap_exceeded'
  | 'anomaly_hold';

export type BinancePolicyDecision =
  | { ok: true }
  | { ok: false; code: BinancePolicyCode; message: string };

export type BinanceOrderPolicyInput = {
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: string;
  /** Estimated USD value of the order (quantity × reference price). */
  value: string;
};

export type BinanceTransferPolicyInput = {
  asset: string;
  amount: string;
};

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/u;

function positivePlainDecimal(value: string): boolean {
  const normalized = value.trim();
  if (!PLAIN_DECIMAL.test(normalized)) return false;
  return /[1-9]/u.test(normalized.replace('.', ''));
}

/** Exact decimal comparison without floating-point rounding. Returns <0, 0, >0. */
export function compareBinanceDecimals(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.trim().split('.');
  const [rightWhole, rightFraction = ''] = right.trim().split('.');
  if (leftWhole.length !== rightWhole.length) {
    return leftWhole.length < rightWhole.length ? -1 : 1;
  }
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftPadded = leftFraction.padEnd(width, '0');
  const rightPadded = rightFraction.padEnd(width, '0');
  if (leftPadded === rightPadded) return 0;
  return leftPadded < rightPadded ? -1 : 1;
}

/** Exact decimal addition, returned as a plain decimal string. */
export function addBinanceDecimals(left: string, right: string): string {
  const [leftWhole, leftFraction = ''] = left.trim().split('.');
  const [rightWhole, rightFraction = ''] = right.trim().split('.');
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(width, '0')}`);
  const rightScaled = BigInt(`${rightWhole}${rightFraction.padEnd(width, '0')}`);
  const sum = (leftScaled + rightScaled).toString().padStart(width + 1, '0');
  if (width === 0) return sum;
  const integerPart = sum.slice(0, -width);
  const fractionPart = sum.slice(-width).replace(/0+$/u, '');
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

function symbolAllowed(symbol: string, allowedSymbols: string[]): boolean {
  const normalized = normalizeBinanceSymbol(symbol);
  return allowedSymbols.includes(normalized);
}

/**
 * Evaluates the policy for a Binance order. `currentDailyUsd` is the accumulated
 * usage for the current UTC day (the empty string means zero).
 */
export function evaluateBinanceOrderPolicy(
  input: BinanceOrderPolicyInput,
  config: BinanceConfig,
  currentDailyUsd: string,
): BinancePolicyDecision {
  const symbol = normalizeBinanceSymbol(input.symbol);
  if (!symbolAllowed(symbol, config.allowedSymbols)) {
    return {
      ok: false,
      code: 'symbol_not_allowed',
      message: `Binance ${symbol} is not in the allowlist, so the operation is held.`,
    };
  }
  if (!positivePlainDecimal(input.quantity)) {
    return {
      ok: false,
      code: 'anomaly_hold',
      message: 'The order quantity is not a valid positive amount, so the operation is held.',
    };
  }
  if (!positivePlainDecimal(input.value)) {
    return {
      ok: false,
      code: 'anomaly_hold',
      message: 'The order value is not a valid positive amount, so the operation is held.',
    };
  }
  if (compareBinanceDecimals(input.value, String(config.maxOrderUsd)) > 0) {
    return {
      ok: false,
      code: 'order_cap_exceeded',
      message: `The order value exceeds the per-order cap of $${config.maxOrderUsd}, so it is held.`,
    };
  }
  const totalUsd = currentDailyUsd ? addBinanceDecimals(currentDailyUsd, input.value) : input.value;
  if (compareBinanceDecimals(totalUsd, String(config.maxDailyUsd)) > 0) {
    return {
      ok: false,
      code: 'daily_cap_exceeded',
      message: `The order would exceed the daily cap of $${config.maxDailyUsd}, so it is held.`,
    };
  }
  return { ok: true };
}

/**
 * Evaluates the policy for a Binance internal transfer. Transfers move an asset
 * between internal accounts; the only fail-closed rule is the symbol allowlist
 * (an out-of-allowlist asset is held).
 */
export function evaluateBinanceTransferPolicy(
  input: BinanceTransferPolicyInput,
  config: BinanceConfig,
): BinancePolicyDecision {
  const asset = normalizeBinanceSymbol(input.asset);
  if (!symbolAllowed(asset, config.allowedSymbols)) {
    return {
      ok: false,
      code: 'symbol_not_allowed',
      message: `Binance ${asset} is not in the allowlist, so the transfer is held.`,
    };
  }
  if (!positivePlainDecimal(input.amount)) {
    return {
      ok: false,
      code: 'anomaly_hold',
      message: 'The transfer amount is not a valid positive amount, so the transfer is held.',
    };
  }
  return { ok: true };
}
