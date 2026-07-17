-- Workspace-level billing + MCP tool-call instrumentation.
--
-- Billing moves from PER-USER (profiles.subscription_*) to PER-WORKSPACE.
-- Pro is per-seat: a Stripe subscription whose quantity tracks the
-- workspace's active member count. The old per-user profiles columns are
-- intentionally LEFT IN PLACE (no destructive change) — the one existing
-- live subscription is grandfathered into workspace_billing by the webhook
-- (legacy $20 price -> plan='pro'), and the profile columns simply stop
-- being written.
--
-- RLS convention (mirrors the workspace-scoped tables introduced in
-- 20260430200656_workspace_aware_rls.sql and the teams/ontology migrations):
-- members can SELECT, but there are NO client write policies — every write
-- comes from the Stripe webhook via the service-role client (which bypasses
-- RLS). Billing state must never be mutable from the browser.

-- ════════════════════════════════════════════════════════════════════
-- 1. workspace_billing — one row per workspace, the billing source of truth
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workspace_billing (
  workspace_id           UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id        TEXT,
  seat_count             INTEGER,
  status                 TEXT NOT NULL DEFAULT 'free'
                         CHECK (status IN ('free', 'active', 'past_due', 'canceled')),
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook reverse-lookups: map an incoming Stripe customer / subscription
-- back to its workspace. Partial (NOT NULL) so the free-plan rows stay out.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_billing_stripe_customer_idx
  ON workspace_billing (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_billing_stripe_subscription_idx
  ON workspace_billing (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE workspace_billing ENABLE ROW LEVEL SECURITY;

-- Members may read their workspace's plan/status (drives the entitlements
-- UI + any client realtime). Writes are service-role only — no INSERT/
-- UPDATE/DELETE policy is defined, so RLS denies every client write while
-- the webhook's service-role client bypasses RLS entirely.
DROP POLICY IF EXISTS workspace_billing_member_select ON workspace_billing;
CREATE POLICY workspace_billing_member_select ON workspace_billing
  FOR SELECT USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

-- ════════════════════════════════════════════════════════════════════
-- 2. mcp_tool_calls — per-op MCP instrumentation (usage foundation)
-- ════════════════════════════════════════════════════════════════════
--
-- Insert-only, from the service-role client at the /api choke point. Feeds
-- future usage analytics / usage-based billing. Kept deliberately narrow:
-- who (user), where (workspace), what (tool + op), and whether it mutated.

CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tool         TEXT NOT NULL,
  op           TEXT NOT NULL DEFAULT '',
  is_write     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_workspace_created_idx
  ON mcp_tool_calls (workspace_id, created_at);

ALTER TABLE mcp_tool_calls ENABLE ROW LEVEL SECURITY;

-- Admins may read usage for their workspace; nobody may write from a client
-- (service-role inserts bypass RLS). No INSERT/UPDATE/DELETE policy on purpose.
DROP POLICY IF EXISTS mcp_tool_calls_admin_select ON mcp_tool_calls;
CREATE POLICY mcp_tool_calls_admin_select ON mcp_tool_calls
  FOR SELECT USING (is_workspace_member(workspace_id, auth.uid(), 'admin'));
