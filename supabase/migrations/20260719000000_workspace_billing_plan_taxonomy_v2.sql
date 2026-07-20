-- Plan taxonomy v2: Free / Solo ($5.99 flat, single-member workspace) /
-- Team ($7.99 per seat — the plan previously named 'pro').
--
-- Renames existing 'pro' rows to 'team' and widens the CHECK to the new
-- three-value set. Safe to run ahead of the code deploy: workspace_billing
-- is only read by the (not yet deployed) per-workspace billing code — the
-- live deployment still reads the legacy profiles.* billing columns.

ALTER TABLE workspace_billing DROP CONSTRAINT IF EXISTS workspace_billing_plan_check;
UPDATE workspace_billing SET plan = 'team' WHERE plan = 'pro';
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_plan_check
  CHECK (plan IN ('free', 'solo', 'team'));
