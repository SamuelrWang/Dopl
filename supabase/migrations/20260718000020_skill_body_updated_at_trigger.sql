-- Microsecond-precision CAS clock for the SKILL.md body (F-25).
--
-- `skills.body_updated_at` is the optimistic-concurrency token that skill
-- body reads return and body writes check (op="read" → op="write"). It was
-- stamped app-side via `new Date().toISOString()` (millisecond precision), so
-- two writes landing in the same JS millisecond could mint IDENTICAL tokens —
-- when the new token equals the old one, the compare-and-swap on
-- body_updated_at stops detecting a concurrent overwrite. Move the clock into
-- Postgres: `now()` (transaction_timestamp) carries microsecond precision, so
-- each write transaction advances the token. This matches how
-- knowledge_entries drive their `updated_at` CAS (a DB trigger, never JS).
--
-- The trigger fires ONLY when `body` actually changes, so this clock stays
-- deliberately independent of `skills.updated_at` (bumped by
-- skills_touch_updated_at on every metadata edit): a metadata PATCH must not
-- move the body clock, and a body write must not false-412 a metadata
-- precondition. It is BEFORE UPDATE, so the fresh value is written in the same
-- row write and returned by RETURNING; the app no longer sets body_updated_at
-- itself. The CAS still gates on the OLD value via the PostgREST
-- `.eq('body_updated_at', expected)` filter (evaluated before the row write),
-- which the trigger does not affect.
--
-- Inserts are unaffected: the column keeps its `DEFAULT now()` (already
-- microsecond). Idempotent (CREATE OR REPLACE + pg_trigger guard), SQL-only —
-- never run against a remote project.

CREATE OR REPLACE FUNCTION touch_skill_body_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.body_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'skills_touch_body_updated_at'
  ) THEN
    CREATE TRIGGER skills_touch_body_updated_at
      BEFORE UPDATE ON skills
      FOR EACH ROW EXECUTE FUNCTION touch_skill_body_updated_at();
  END IF;
END $$;
