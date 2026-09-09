import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";

const original = {
  BINANCE_MAX_DAILY_USD: process.env.BINANCE_MAX_DAILY_USD,
  DEMO_USER_ID: process.env.DEMO_USER_ID,
};

afterEach(() => {
  for (const key of Object.keys(original) as (keyof typeof original)[]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("GET /v1/me", () => {
  it("returns the demo profile with the configured Binance daily limit", async () => {
    process.env.BINANCE_MAX_DAILY_USD = "1000";
    process.env.DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    const me = body.data as {
      displayName: string;
      greetingName: string;
      initials: string;
      documentLast3: string;
      city: string;
      verifiedAt: string | null;
      verificationHuman: string;
      dailyLimit: { amount: string; currency: string; display: string };
      dailySpent: { amount: string; currency: string; display: string };
    };
    expect(me.displayName).toBe("Héctor Bianchi");
    expect(me.greetingName).toBe("Don Héctor");
    expect(me.initials).toBe("H");
    expect(me.documentLast3).toBe("552");
    expect(me.city).toBe("Lanús");
    expect(me.verificationHuman).toBe("Tus datos están bien");
    expect(me.dailyLimit).toEqual({ amount: "1000", currency: "USD", display: "$ 1.000" });
    // Daily spent starts at zero for the day (no Binance orders yet).
    expect(me.dailySpent).toEqual({ amount: "0", currency: "USD", display: "$ 0" });
    await app.close();
  });

  it("reflects a custom configured daily limit", async () => {
    process.env.BINANCE_MAX_DAILY_USD = "250";
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { dailyLimit: { amount: string; display: string } } };
    expect(body.data.dailyLimit.amount).toBe("250");
    expect(body.data.dailyLimit.display).toBe("$ 250");
    await app.close();
  });
});
