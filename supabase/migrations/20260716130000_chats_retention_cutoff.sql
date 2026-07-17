-- Free-plan chats retention window (hide, never delete).
--
-- On free workspaces the chat archive shows only sessions newer than the
-- entitlements window (FREE_CHATS_WINDOW_DAYS = 90). The cutoff DATE is
-- computed here, on the DB clock, so callers can push
-- `session_date >= cutoff` into the query instead of doing JS date math on
-- rows (timezone-sensitive boundary lives in Postgres, not the Node clock).
--
-- STABLE: one value per statement. Returns a DATE to compare against the
-- `chats.session_date` DATE column directly.
CREATE OR REPLACE FUNCTION chats_retention_cutoff(p_window_days integer)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (now() - make_interval(days => p_window_days))::date;
$$;
