import type { FastifyInstance } from "fastify";
import { readBinanceConfig } from "../config/binance.js";
import { BinanceDailyUsageRepository, InMemoryBinanceDailyUsageStore, binanceUsageDate, type BinanceDailyUsageStore } from "../db/binance-daily-usage-repository.js";
import { createDatabaseClient } from "../db/client.js";

/** Demo profile served while there is no real user store (matches the
 * frontend contract mirrored in apps/nana-wallet/src/lib/api-types.ts). */
const PROFILE = {
  displayName: "Héctor Bianchi",
  greetingName: "Don Héctor",
  initials: "H",
  documentLast3: "552",
  city: "Lanús",
  verifiedAt: "2026-07-18T11:00:00-03:00",
  verificationHuman: "Tus datos están bien",
};

function formatUsd(amount: string): string {
  const [intPart] = amount.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$ ${grouped}`;
}

async function dailySpentUsd(store: BinanceDailyUsageStore, userId: string): Promise<string> {
  try {
    const raw = await store.getUsage(userId, binanceUsageDate());
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return "0";
    return String(value);
  } catch {
    // The profile must never fail because usage accounting is unavailable.
    return "0";
  }
}

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/me", async () => {
    const config = readBinanceConfig(process.env);
    const demoUserId = process.env.DEMO_USER_ID ?? "";
    let store: BinanceDailyUsageStore = new InMemoryBinanceDailyUsageStore();
    if (process.env.DATABASE_URL) {
      try {
        store = new BinanceDailyUsageRepository(createDatabaseClient(process.env.DATABASE_URL));
      } catch {
        // Keep the in-memory fallback when the database is unreachable.
      }
    }
    const spent = await dailySpentUsd(store, demoUserId);
    const limit = config.maxDailyUsd;

    return {
      ok: true,
      data: {
        ...PROFILE,
        dailyLimit: { amount: String(limit), currency: "USD", display: formatUsd(String(limit)) },
        dailySpent: { amount: spent, currency: "USD", display: formatUsd(spent) },
      },
    };
  });
}
