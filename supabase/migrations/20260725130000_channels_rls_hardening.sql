-- Channels — RLS write hardening + per-channel insert serialization.
--
-- The initial channels migration (20260725120000) shipped permissive
-- INSERT/UPDATE/DELETE RLS policies gated ONLY on the workspace-editor rank.
-- Every channel write in the app goes through the service role (routes ->
-- supabaseAdmin, RLS-bypassing), so those direct-DML policies were never
-- needed and each was exploitable via direct PostgREST:
--
--   C1  channel_members_editor_insert  — any workspace editor could insert
--       themselves into any PRIVATE channel as role='owner', then read the
--       transcript and manage the channel.
--   H3  channel_messages_editor_insert — editors could forge messages into
--       channels they aren't members of (incl. cross-workspace: their ws A's
--       workspace_id + a channel_id in ws B, surfaced to ws B by the
--       channel_id-only service read path).
--   M1  channels_editor_update / _delete — any editor could rename / archive
--       / flip visibility / soft- or HARD-delete (cascade!) any public
--       channel, and UPDATE could reparent workspace_id cross-workspace.
--   M2  channel_members_editor_delete  — editors could kick arbitrary
--       members from public channels.
--
-- Fix: writes stay service-role only. (a) REVOKE INSERT/UPDATE/DELETE on the
-- three tables from authenticated + anon (SELECT stays, for Realtime / RLS
-- reads); (b) DROP every write policy so only the SELECT policies remain
-- (matches the chats model, which has no write policy at all and relies on
-- RLS default-deny). Defense-in-depth: both the grant and the policy are
-- removed, so a future re-GRANT can't silently re-enable direct DML.
--
-- Also:
--   * A workspace_id-consistency guard trigger on channel_members /
--     channel_messages (a CHECK can't cross-reference channels), so a
--     service-layer bug can't write a child row whose workspace_id differs
--     from its channel's — the exact cross-workspace shape H3 abused.
--   * channel_message_insert() RPC: per-channel advisory-lock serialization
--     of the IDENTITY seq assignment so seq commit order is monotonic per
--     channel (H1) — a concurrent poster can no longer commit a lower seq
--     after a higher one is already visible, which would let an await cursor
--     permanently skip the lower-seq message.

-- ===========================================================================
-- C1 / H3 / M1 / M2 — drop direct-DML surface (grants + write policies)
-- ===========================================================================
REVOKE INSERT, UPDATE, DELETE ON public.channels          FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.channel_members   FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.channel_messages  FROM authenticated, anon;

DROP POLICY IF EXISTS channels_editor_insert         ON public.channels;
DROP POLICY IF EXISTS channels_editor_update         ON public.channels;
DROP POLICY IF EXISTS channels_editor_delete         ON public.channels;
DROP POLICY IF EXISTS channel_members_editor_insert  ON public.channel_members;
DROP POLICY IF EXISTS channel_members_editor_delete  ON public.channel_members;
DROP POLICY IF EXISTS channel_messages_editor_insert ON public.channel_messages;

-- The three *_member_select policies are intentionally left in place — they
-- carry the direct-read model for Realtime and RLS reads.


-- ===========================================================================
-- workspace_id consistency guard (defense-in-depth for the service layer)
-- ===========================================================================
-- A child row's denormalized workspace_id MUST equal its channel's
-- workspace_id — the Realtime filter and the service read path both trust it.
-- Enforced by trigger because a CHECK constraint can't reference channels.
CREATE OR REPLACE FUNCTION public.channel_child_workspace_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $function$
DECLARE
  parent_ws uuid;
BEGIN
  SELECT c.workspace_id INTO parent_ws
  FROM public.channels c
  WHERE c.id = NEW.channel_id;

  IF parent_ws IS NULL THEN
    RAISE EXCEPTION 'channel % does not exist', NEW.channel_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM parent_ws THEN
    RAISE EXCEPTION
      'channel child workspace_id % does not match channel % workspace %',
      NEW.workspace_id, NEW.channel_id, parent_ws
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Inert PUBLIC EXECUTE on a trigger function trips the Supabase security
-- advisor; revoke it (trigger firing does not depend on the grant).
REVOKE EXECUTE ON FUNCTION public.channel_child_workspace_guard()
  FROM PUBLIC, anon, authenticated;

-- `UPDATE OF workspace_id, channel_id` so the frequent last_read_at bump on
-- channel_members (which touches neither column) never fires the guard.
DROP TRIGGER IF EXISTS channel_members_workspace_guard ON public.channel_members;
CREATE TRIGGER channel_members_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id ON public.channel_members
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

DROP TRIGGER IF EXISTS channel_messages_workspace_guard ON public.channel_messages;
CREATE TRIGGER channel_messages_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id ON public.channel_messages
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();


-- ===========================================================================
-- H1 — channel_message_insert: per-channel serialized insert
-- ===========================================================================
-- seq is a GENERATED ALWAYS IDENTITY: nextval is assigned at INSERT time but
-- only becomes visible at COMMIT. Two concurrent posters can therefore commit
-- out of order (poster with seq=N+1 commits before the poster with seq=N),
-- and an await/read cursor that advances past N+1 permanently misses N.
--
-- Taking a per-channel advisory xact lock BEFORE the INSERT (before nextval)
-- forces the seq assignment + commit to be serialized per channel: the next
-- poster can't reach nextval until the prior poster's transaction ends. seq
-- commit order is then monotonic per channel, which is sufficient because
-- every cursor read is per-channel. Per-channel message volume is low, so the
-- lock is uncontended in practice.
--
-- SECURITY DEFINER (runs as owner, bypasses RLS like the rest of the write
-- path); EXECUTE granted to service_role only — the app's sole writer.
CREATE OR REPLACE FUNCTION public.channel_message_insert(
  p_channel_id     uuid,
  p_workspace_id   uuid,
  p_author_user_id uuid,
  p_author_kind    text,
  p_kind           text,
  p_body           text,
  p_metadata       jsonb,
  p_client_msg_id  text
)
  RETURNS public.channel_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  result public.channel_messages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_channel_id::text, 0));

  INSERT INTO public.channel_messages (
    channel_id, workspace_id, author_user_id, author_kind,
    kind, body, metadata, client_msg_id
  ) VALUES (
    p_channel_id, p_workspace_id, p_author_user_id, p_author_kind,
    p_kind, p_body, p_metadata, p_client_msg_id
  )
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.channel_message_insert(
  uuid, uuid, uuid, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_message_insert(
  uuid, uuid, uuid, text, text, text, jsonb, text
) TO service_role;
