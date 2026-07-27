-- Channels v1.2 — consent requests (inbound consent + outbound review).
--
-- The human-in-the-loop gate for cross-user agent collaboration becomes a
-- server-side row so EITHER surface (web or desktop) can answer it:
--   kind='inbound'  — a teammate's agent addressed the operator; the operator
--                     must Allow / Deny before their machine spawns a session.
--   kind='outbound' — the operator's own agent drafted a reply; the operator
--                     must Send / Cancel before it leaves the machine.
-- `operator_user_id` is WHO must decide (the recipient); `requester_user_id`
-- is who/whose agent asked (inbound only; null for outbound). The desktop
-- creates the row when a trigger fires / a reply is drafted, then waits on
-- either the local dialog or this row flipping status.
--
-- Writes are EXCLUSIVELY service-role (routes -> supabaseAdmin), mirroring the
-- channels v1 hardening: the base authenticated/anon DML grants are REVOKEd
-- and no write policy exists (default-deny). RLS carries only the READ model
-- for direct PostgREST + Realtime — an operator sees ONLY their own pending
-- rows, live. The operator-only decide authorization is enforced in the
-- service layer (every channel write already runs through it).

CREATE TABLE channel_consent_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id         UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- Denormalized for the Realtime `workspace_id=eq.<id>` filter + the RLS fence.
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Who must decide (the recipient / operator). Their account going away
  -- takes their pending requests with it.
  operator_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who / whose agent asked (inbound). Null for outbound (own agent) and when
  -- the requester's account is later deleted.
  requester_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('inbound', 'outbound')),
  -- Inbound: the seq of the triggering message (audit + de-dupe reference).
  message_seq        BIGINT,
  -- Verbatim intent shown on the card (already length-capped upstream).
  summary            TEXT NOT NULL DEFAULT '',
  -- Verbatim request body (inbound) — truncated client-side if huge.
  body_preview       TEXT NOT NULL DEFAULT '',
  -- Outbound: the agent's drafted reply awaiting the operator's Send.
  proposed_reply     TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'allowed', 'denied', 'expired', 'auto_allowed')),
  -- Audit trail of which surface / rule resolved it: 'web' | 'desktop' | 'trust'.
  decided_by         TEXT,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Pending rows expire (service stamps +30 min); a lazy sweep on read flips
  -- an elapsed pending row to 'expired'.
  expires_at         TIMESTAMPTZ
);

-- The operator's inbox: pending rows for a user, newest first.
CREATE INDEX channel_consent_requests_operator_status_idx
  ON channel_consent_requests (operator_user_id, status);

CREATE INDEX channel_consent_requests_channel_idx
  ON channel_consent_requests (channel_id);

CREATE INDEX channel_consent_requests_workspace_idx
  ON channel_consent_requests (workspace_id);

-- Covering index for the requester FK (advisor: unindexed FK).
CREATE INDEX channel_consent_requests_requester_idx
  ON channel_consent_requests (requester_user_id);


-- ===========================================================================
-- workspace_id consistency guard — reuse the channels v1 trigger fn
-- ===========================================================================
-- channel_child_workspace_guard() compares NEW.workspace_id to the parent
-- channel's workspace_id (it only reads NEW.channel_id / NEW.workspace_id), so
-- it applies verbatim to this child table. `UPDATE OF workspace_id, channel_id`
-- so a status/decision UPDATE (which touches neither) never re-fires it.
DROP TRIGGER IF EXISTS channel_consent_requests_workspace_guard ON public.channel_consent_requests;
CREATE TRIGGER channel_consent_requests_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id ON public.channel_consent_requests
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();


-- ===========================================================================
-- RLS — SELECT-only read model (writes go via service role)
-- ===========================================================================
ALTER TABLE channel_consent_requests ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: revoke the base DML grants so a future policy slip can't
-- re-open direct writes (matches channels_rls_hardening). SELECT stays for
-- Realtime + RLS reads.
REVOKE INSERT, UPDATE, DELETE ON public.channel_consent_requests FROM authenticated, anon;

-- An operator sees ONLY their own requests, and only while a workspace member.
CREATE POLICY channel_consent_requests_operator_select ON channel_consent_requests
  FOR SELECT
  USING (
    (operator_user_id = (SELECT auth.uid()))
    AND is_current_workspace_member(workspace_id, 'viewer'::text)
  );


-- ===========================================================================
-- Realtime — publish (idempotent; copy of the 20260717 pattern)
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.channel_consent_requests') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'channel_consent_requests'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_consent_requests;
  END IF;
END
$$;
