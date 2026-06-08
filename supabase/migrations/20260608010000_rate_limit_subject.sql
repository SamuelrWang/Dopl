-- Generic, FK-free rate-limit counter.
--
-- The original check_and_record_rate_limit writes to api_key_usage, whose
-- api_key_id FKs to api_keys — so it CANNOT be used for OAuth access tokens
-- (their ids aren't in api_keys; the insert FK-violates and the call fails
-- closed → spurious 429s). This table is keyed by an opaque text subject
-- (e.g. "mcp:<token_id>") with no FK, so it works for any caller.
--
-- Service-role only (RLS on, no policies), like api_key_usage.

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject      TEXT NOT NULL,
  endpoint     TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_events_subject_time_idx
  ON rate_limit_events (subject, requested_at);

ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Atomic check-and-record, mirroring check_and_record_rate_limit but keyed on
-- an arbitrary text subject (advisory lock serializes per subject).
CREATE OR REPLACE FUNCTION public.check_and_record_rate_limit_subject(
  p_subject text,
  p_rpm integer,
  p_endpoint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  current_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_subject));

  SELECT COUNT(*) INTO current_count
  FROM rate_limit_events
  WHERE subject = p_subject
    AND requested_at >= now() - interval '60 seconds';

  IF current_count >= p_rpm THEN
    RETURN false;
  END IF;

  INSERT INTO rate_limit_events (subject, endpoint, requested_at)
  VALUES (p_subject, p_endpoint, now());

  RETURN true;
END;
$function$;
