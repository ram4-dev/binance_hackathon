CREATE TABLE IF NOT EXISTS binance_daily_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  usage_date DATE NOT NULL,
  used_usd NUMERIC(38, 18) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS binance_daily_usage_user_date_idx
  ON binance_daily_usage (user_id, usage_date);

ALTER TABLE binance_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE binance_daily_usage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS binance_daily_usage_user_isolation ON binance_daily_usage;
CREATE POLICY binance_daily_usage_user_isolation ON binance_daily_usage
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO recipient_app;
GRANT SELECT, INSERT, UPDATE ON binance_daily_usage TO recipient_app;
