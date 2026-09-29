-- ============================================================================
-- UNIFIED DISPLAY (2026-09-28) — docs/specs/unified-display.md §7.4
-- ============================================================================
-- Three additive pieces:
--   * `channel_messages_display_id_idx` — replace-by-id lookup (`dopl_show` with a
--     `display_id`): the newest message in a channel carrying that display id.
--   * `public.replace_channel_message_display(...)` — replaces an UNANSWERED display
--     in place (body, metadata.display and the decision index `metadata.escalation`)
--     in ONE statement, fenced to the author account. `p_escalation` null removes the
--     index. False when not the author, already stamped, or any answer message
--     references it.
--   * `public.stamp_channel_message_display_answer(...)` — writes
--     metadata.display.answer ONCE (compare-and-set on a null/absent answer).
-- Both functions: EXECUTE is service_role ONLY. The only UPDATE trigger on
-- channel_messages (`channel_messages_workspace_guard`) fires on workspace_id /
-- channel_id only, so a body change touches nothing else (checked 2026-09-28).
-- ADDITIVE ONLY. Apply by name.

CREATE INDEX IF NOT EXISTS channel_messages_display_id_idx
  ON public.channel_messages (channel_id, (metadata -> 'display' ->> 'display_id'))
  WHERE metadata ? 'display';

CREATE OR REPLACE FUNCTION public.replace_channel_message_display(
  p_message_id uuid,
  p_author_user_id uuid,
  p_body text,
  p_display jsonb,
  p_escalation jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH moved AS (
    UPDATE public.channel_messages m
       SET body = p_body,
           metadata = CASE
             WHEN p_escalation IS NULL THEN (m.metadata - 'escalation') || jsonb_build_object('display', p_display)
             ELSE m.metadata || jsonb_build_object('display', p_display, 'escalation', p_escalation)
           END
     WHERE m.id = p_message_id
       AND m.author_user_id = p_author_user_id
       AND jsonb_typeof(m.metadata -> 'display') = 'object'
       AND jsonb_typeof(m.metadata -> 'display' -> 'answer') IS DISTINCT FROM 'object'
       AND NOT EXISTS (
         SELECT 1 FROM public.channel_messages a
          WHERE a.channel_id = m.channel_id
            AND a.metadata -> 'escalationAnswer' ->> 'escalationMessageId' = p_message_id::text
       )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM moved);
$$;

CREATE OR REPLACE FUNCTION public.stamp_channel_message_display_answer(
  p_message_id uuid,
  p_answer jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH moved AS (
    UPDATE public.channel_messages
       SET metadata = jsonb_set(metadata, '{display,answer}', p_answer)
     WHERE id = p_message_id
       AND jsonb_typeof(metadata -> 'display') = 'object'
       AND jsonb_typeof(metadata -> 'display' -> 'answer') IS DISTINCT FROM 'object'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM moved);
$$;

COMMENT ON FUNCTION public.replace_channel_message_display(uuid, uuid, text, jsonb, jsonb) IS
  'Replaces an unanswered channel display in place (unified display). EXECUTE is service_role ONLY.';
COMMENT ON FUNCTION public.stamp_channel_message_display_answer(uuid, jsonb) IS
  'Stamps metadata.display.answer once (unified display). EXECUTE is service_role ONLY.';

REVOKE ALL ON FUNCTION public.replace_channel_message_display(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_channel_message_display(uuid, uuid, text, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_channel_message_display(uuid, uuid, text, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.stamp_channel_message_display_answer(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_channel_message_display_answer(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_channel_message_display_answer(uuid, jsonb) TO service_role;
