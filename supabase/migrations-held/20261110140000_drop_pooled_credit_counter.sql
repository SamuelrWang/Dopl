-- DROP THE RETIRED POOLED CREDIT COUNTER — F-667 (db-cleanup audit, 2026-09-28).
--
-- ⚠ HELD — WRITTEN, NOT APPLIED. Samuel's ruling for the audit: "List + draft
-- drops, don't apply". Release per supabase/migrations-held/README.md.
--
-- `workspace_credit_usage` and `consume_workspace_credits` were retired from
-- writes by 20260930120000_credit_wallets.sql §5 (applied to production as
-- `credit_wallets`, version 20260907213504 — matched by NAME). F-667 names this
-- exact drop and three gates:
--   (a) credit_wallets applied and verified            — MET (measured 2026-09-28).
--   (b) live long enough that a rollback is off the table — releases 1.33–1.37.1
--       have shipped on the wallets since 2026-09-07; last counter write
--       2026-09-07 14:02 UTC.
--   (c) retention of the historical rows                — SAMUEL'S CALL. 6 rows
--       of pre-wallet spend. They cannot be converted into per-member
--       allocations (F-667); keep them only as history. Export first if wanted:
--
--         SELECT * FROM public.workspace_credit_usage ORDER BY period_start;
--
-- No code calls the function or reads the table (comments only); no view,
-- policy-function or trigger references either. The table's one policy
-- (workspace_credit_usage_member_select) goes with it.
--
-- After release: re-generate src/shared/supabase/types.ts, and close F-667.

DROP FUNCTION IF EXISTS public.consume_workspace_credits(uuid, timestamptz, integer, integer);
DROP TABLE IF EXISTS public.workspace_credit_usage;
