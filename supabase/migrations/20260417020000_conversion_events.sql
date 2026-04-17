-- Conversion funnel events for the launch analytics dashboard.
-- Append-only log, one row per discrete lifecycle event.
--
-- Event types:
--   signup                    — new profile row
--   trial_started             — trial_started_at stamped
--   first_cluster_built       — user's first non-global cluster created
--   first_ingest_completed    — user's first entry reached status=complete
--   trial_expired             — cron flipped status from trialing → expired
--   subscribed                — Stripe subscription became active
--   reactivation_email_sent   — reactivation email sent via cron
--   reactivated               — subscribed AFTER a trial_expired event
--   churned                   — subscription canceled / deleted

CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Funnel queries group by event_type and time-bucket by occurred_at.
CREATE INDEX IF NOT EXISTS conversion_events_type_time_idx
  ON conversion_events (event_type, occurred_at DESC);

-- Per-user lookups (e.g. "did this user ever fire first_cluster_built?").
CREATE INDEX IF NOT EXISTS conversion_events_user_type_idx
  ON conversion_events (user_id, event_type);

-- Admin-only read. Writes via service role only (server-side emit).
ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;

-- No policies = default deny. Service role bypasses RLS. Admins query
-- via the service-role supabaseAdmin() client on the server.
