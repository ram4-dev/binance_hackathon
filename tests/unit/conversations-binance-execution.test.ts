import { describe, expect, it } from "vitest";
import { classifyBinanceExecutionError } from "../../src/conversations/service.js";

describe("classifyBinanceExecutionError", () => {
  it("treats clean Binance rejections as definitive (order not executed)", () => {
    for (const message of [
      "Binance API error -2010: Account has insufficient balance for requested action.",
      "Filter failure: MIN_NOTIONAL",
      "Binance API error -1013: Lot size is not valid for this symbol.",
      "Order would trigger immediately: insufficient quote asset balance.",
    ]) {
      expect(classifyBinanceExecutionError(new Error(message))).toBe("definitive_rejection");
    }
  });

  it("treats ambiguous transport failures as uncertain", () => {
    for (const message of [
      "fetch failed",
      "Request timed out after 15000 ms",
      "socket hang up",
      "Unexpected server response: 502",
    ]) {
      expect(classifyBinanceExecutionError(new Error(message))).toBe("uncertain");
    }
  });
});
