import { createDatabaseClient, DatabaseClient } from './client.js';
import { readRecipientMemoryConfig } from '../config/env.js';

/**
 * Persisted, per-user, per-UTC-day Binance order usage.
 *
 * The store is keyed by `(user_id, usage_date)` so the daily cap survives restarts
 * and is shared across sessions. Row-level security keeps every row scoped to the
 * authenticated user via the same `app.user_id` session setting the recipient
 * memory uses.
 */

export interface BinanceDailyUsageStore {
  getUsage(userId: string, date: string): Promise<string>;
  addUsage(userId: string, date: string, amountUsd: string): Promise<string>;
}

type UsageRow = { used_usd: string };

/** Current UTC calendar day as `YYYY-MM-DD`. */
export function binanceUsageDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** DB-backed store. Persists usage across restarts. */
export class BinanceDailyUsageRepository implements BinanceDailyUsageStore {
  public constructor(private readonly database: DatabaseClient) {}

  public async getUsage(userId: string, date: string): Promise<string> {
    return this.database.withUserTransaction(userId, async (client) => {
      const result = await client.query<UsageRow>(
        `SELECT used_usd FROM binance_daily_usage WHERE user_id = $1 AND usage_date = $2`,
        [userId, date],
      );
      return result.rows[0]?.used_usd ?? '0';
    });
  }

  public async addUsage(userId: string, date: string, amountUsd: string): Promise<string> {
    return this.database.withUserTransaction(userId, async (client) => {
      const result = await client.query<UsageRow>(
        `INSERT INTO binance_daily_usage (user_id, usage_date, used_usd)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, usage_date)
         DO UPDATE SET used_usd = binance_daily_usage.used_usd + EXCLUDED.used_usd, updated_at = now()
         RETURNING used_usd`,
        [userId, date, amountUsd],
      );
      return result.rows[0]?.used_usd ?? amountUsd;
    });
  }
}

/**
 * In-memory fallback used when `DATABASE_URL` is not configured (fixture/test
 * mode). Usage is process-local and keyed by `(userId, date)`.
 */
export class InMemoryBinanceDailyUsageStore implements BinanceDailyUsageStore {
  private readonly usage = new Map<string, string>();

  private key(userId: string, date: string): string {
    return `${userId}::${date}`;
  }

  public async getUsage(userId: string, date: string): Promise<string> {
    return this.usage.get(this.key(userId, date)) ?? '0';
  }

  public async addUsage(userId: string, date: string, amountUsd: string): Promise<string> {
    const key = this.key(userId, date);
    const current = this.usage.get(key) ?? '0';
    const total = addDecimals(current, amountUsd);
    this.usage.set(key, total);
    return total;
  }
}

export function createBinanceDailyUsageStore(
  environment: NodeJS.ProcessEnv = process.env,
): BinanceDailyUsageStore {
  const config = readRecipientMemoryConfig(environment);
  if (!config.databaseUrl) return new InMemoryBinanceDailyUsageStore();
  return new BinanceDailyUsageRepository(createDatabaseClient(config.databaseUrl));
}

function addDecimals(left: string, right: string): string {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(width, '0')}`);
  const rightScaled = BigInt(`${rightWhole}${rightFraction.padEnd(width, '0')}`);
  const sum = (leftScaled + rightScaled).toString().padStart(width + 1, '0');
  if (width === 0) return sum;
  const integerPart = sum.slice(0, -width);
  const fractionPart = sum.slice(-width).replace(/0+$/u, '');
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}
