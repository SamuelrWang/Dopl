-- Channels v1.2 — per-teammate standing consent (agent trust rules).
--
-- Standing consent is an explicit, revocable choice about a PERSON, never a
-- capability: "always allow requests from Alice's agent". A rule means the
-- operator auto-allows INBOUND consent requests whose requester_user_id =
-- trusted_user_id in that workspace (recorded as status='auto_allowed',
-- decided_by='trust' for the web audit). It NEVER affects outbound review —
-- a reply leaving the operator's machine always needs a fresh confirm.
--
-- Rows are the operator's own private data. Writes are service-role only
-- (routes -> supabaseAdmin), so — like the other channels tables — the base
-- authenticated/anon DML grants are revoked and only a SELECT policy remains.

CREATE TABLE agent_trust_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trusted_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One rule per (operator, trusted teammate, workspace).
  UNIQUE (operator_user_id, trusted_user_id, workspace_id)
);

-- The UNIQUE index leads with operator_user_id, so the "my rules in this
-- workspace" read + the operator FK are already covered. Add covering
-- indexes for the other two FKs (advisor: unindexed FK).
CREATE INDEX agent_trust_rules_trusted_idx
  ON agent_trust_rules (trusted_user_id);

CREATE INDEX agent_trust_rules_workspace_idx
  ON agent_trust_rules (workspace_id);


-- ===========================================================================
-- RLS — SELECT-only read model (writes go via service role)
-- ===========================================================================
ALTER TABLE agent_trust_rules ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.agent_trust_rules FROM authenticated, anon;

-- The operator sees ONLY their own rules, and only while a workspace member.
CREATE POLICY agent_trust_rules_operator_select ON agent_trust_rules
  FOR SELECT
  USING (
    (operator_user_id = (SELECT auth.uid()))
    AND is_current_workspace_member(workspace_id, 'viewer'::text)
  );
