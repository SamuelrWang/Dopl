-- F-062 — repo-wide TRUNCATE over-grant (RLS-bypassing privilege), latent.
--
-- Supabase's stock schema setup does `GRANT ALL` / `ALTER DEFAULT PRIVILEGES`
-- on `public`, so `TRUNCATE` was granted to `authenticated` + `anon` on nearly
-- every table (35 of 47 public base tables at authoring time — including all
-- six channels-family tables whose own hardening migrations revoked only
-- INSERT/UPDATE/DELETE and let TRUNCATE ride along untouched).
--
-- Why this matters: **TRUNCATE is NOT row-scoped — RLS policies do not apply to
-- it at all.** It is a whole-table wipe that the default-deny row policies these
-- tables rely on cannot see. Not reachable today (PostgREST issues only DML +
-- RPC, and has no TRUNCATE verb), so it is a standing over-grant / defense-in-
-- depth gap, not a live hole — but the privilege has no legitimate holder among
-- `authenticated`/`anon`, so it is removed repo-wide here rather than per-table.
--
-- Precedent: F-051 brought the channels tables to write-grant parity
-- (INSERT/UPDATE/DELETE revoke); this is the TRUNCATE analogue, done ONCE
-- across the whole `public` schema instead of table-by-table.
--
-- Scope of this migration — ONLY TRUNCATE, ONLY from authenticated + anon.
-- service_role, postgres, and every other role are untouched; the correctly
-- managed per-table SELECT/INSERT/UPDATE/DELETE grants are untouched.
--
-- (a) Existing tables: revoke the standing TRUNCATE grant.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated, anon;

-- (b) Future tables: stop new tables from re-inheriting TRUNCATE.
--     The creating role for this project is `postgres`: every one of the 47
--     public tables is owned by postgres and migrations run as postgres, so a
--     table created by a future migration applies postgres's default ACL.
--     (A parallel default-ACL entry exists FOR supabase_admin, but that is
--     Supabase's platform-level default applying only to tables supabase_admin
--     itself creates — not this project's migration path — and postgres, being
--     neither a superuser nor a member of supabase_admin, cannot and need not
--     alter it. So this single FOR ROLE postgres statement fully closes the
--     inheritance for tables created here.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM authenticated, anon;
