-- ═══════════════════════════════════════════════════════════════
-- DocsValidate — Supabase Schema
-- ═══════════════════════════════════════════════════════════════

-- users: one row per Clerk user, linked to Stripe
CREATE TABLE IF NOT EXISTS users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id            TEXT         UNIQUE NOT NULL,
  email               TEXT         DEFAULT '',
  plan                TEXT         NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'growth', 'professional', 'enterprise')),
  validations_used    INT          NOT NULL DEFAULT 0,
  stripe_customer_id  TEXT,
  last_reset          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_id ON users (clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users (stripe_customer_id);

-- ─────────────────────────────────────────────────────────────

-- validation_history: stores each validation run per user
CREATE TABLE IF NOT EXISTS validation_history (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id      TEXT         NOT NULL,
  bl_number     TEXT,
  vessel_name   TEXT,
  status        TEXT         NOT NULL CHECK (status IN ('approved', 'warning', 'rejected')),
  doc_count     INT          NOT NULL DEFAULT 0,
  error_count   INT          NOT NULL DEFAULT 0,
  warning_count INT          NOT NULL DEFAULT 0,
  summary_text  TEXT,
  result_json   JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index for listing a user's history (sorted by date)
CREATE INDEX IF NOT EXISTS idx_validation_history_clerk_id
  ON validation_history (clerk_id, created_at DESC);

-- Index for BL number search
CREATE INDEX IF NOT EXISTS idx_validation_history_bl_number
  ON validation_history (bl_number);

-- Row-level security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_history ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only read/update their own row
CREATE POLICY "Users read own row" ON users
  FOR SELECT USING (clerk_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users update own row" ON users
  FOR UPDATE USING (clerk_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- RLS policies: users can only access their own validation history
CREATE POLICY "Users read own history" ON validation_history
  FOR SELECT USING (clerk_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users insert own history" ON validation_history
  FOR INSERT WITH CHECK (clerk_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Service role (used by Netlify functions) bypasses RLS automatically

-- ─────────────────────────────────────────────────────────────

-- webhook_events: deduplication table for Stripe webhook replay protection
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id    TEXT         PRIMARY KEY,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-cleanup: delete events older than 7 days (run via Supabase cron or pg_cron)
-- SELECT cron.schedule('cleanup-webhook-events', '0 3 * * *', $$DELETE FROM webhook_events WHERE created_at < now() - interval '7 days'$$);
