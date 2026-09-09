import { describe, expect, it } from "vitest";
import { evaluateBinanceOrderPolicy } from "../../../src/agent/policy-binance.js";
import type { BinanceConfig } from "../../../src/config/binance.js";

const config: BinanceConfig = {
  source: "fixture",
  mcpTransport: "http",
  mcpDegrade: true,
  allowedSymbols: ["BTC", "ETH", "BNB"],
  maxOrderUsd: 100,
  maxDailyUsd: 1000,
};

const order = { side: "BUY" as const, orderType: "MARKET" as const, quantity: "0.01", value: "50" };

describe("evaluateBinanceOrderPolicy symbol matching", () => {
  it("allows the raw asset from the allowlist", () => {
    const decision = evaluateBinanceOrderPolicy({ ...order, symbol: "BNB" }, config, "0");
    expect(decision.ok).toBe(true);
  });

  it("allows the trading pair when its base asset is allowlisted", () => {
    for (const symbol of ["BNBUSDT", "BTCUSDT", "ETHUSDT"]) {
      const decision = evaluateBinanceOrderPolicy({ ...order, symbol }, config, "0");
      expect(decision.ok, `${symbol} should be allowed`).toBe(true);
    }
  });

  it("holds orders below the exchange minimum notional (~$5)", () => {
    const decision = evaluateBinanceOrderPolicy({ ...order, quantity: "0.000025", value: "1.96", symbol: "BTCUSDT" }, config, "0");
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("anomaly_hold");
  });

  it("allows orders at the exchange minimum notional", () => {
    const decision = evaluateBinanceOrderPolicy({ ...order, quantity: "0.000064", value: "5.01", symbol: "BTCUSDT" }, config, "0");
    expect(decision.ok).toBe(true);
  });

  it("still holds pairs whose base asset is not allowlisted", () => {
    const decision = evaluateBinanceOrderPolicy({ ...order, symbol: "DOGEUSDT" }, config, "0");
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("symbol_not_allowed");
  });
});
