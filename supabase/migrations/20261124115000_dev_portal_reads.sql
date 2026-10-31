-- DEV PORTAL, PHASE 3 (docs/specs/dev-portal-live/PLAN.md section 5). Additive only: every column is
-- nullable with no default, no existing select names them, so the running web build is unaffected.
--
-- dev_api_keys.name, created_by    what the Keys page shows. Older rows read a fallback.
-- dev_end_users.display_name       a readable name beside the developer's own id.
-- dev_org_members.last_active_at   Team's Last active, touched at most hourly by the portal.
-- dev_actions_queued_idx           the minute sweep that finishes an action stuck at queued.
-- *_created_idx                    the daily 30-day retention deletes.
-- dev_portal_metrics               one grouped read, so every page's figures come from one query.
--
-- ROLLBACK (prose): DROP FUNCTION public.dev_portal_metrics(uuid, text, timestamptz); DROP each index
-- and column above.

ALTER TABLE public.dev_api_keys
  ADD COLUMN IF NOT EXISTS name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.dev_end_users
  ADD COLUMN IF NOT EXISTS display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120);

ALTER TABLE public.dev_org_members
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

CREATE INDEX IF NOT EXISTS dev_actions_queued_idx ON public.dev_actions (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS dev_actions_created_idx ON public.dev_actions (created_at);
CREATE INDEX IF NOT EXISTS dev_device_messages_created_idx ON public.dev_device_messages (created_at);
CREATE INDEX IF NOT EXISTS dev_webhook_outbox_created_idx ON public.dev_webhook_outbox (created_at);

-- One row per (UTC day, user, device, kind, key). A delivery is a call that asked a device to do
-- something: not a poll, not a replay, not a person's message, not the bridge's report of its own cast.
-- Delivered = accepted, and its action (when it has one) reached delivered or done.
CREATE OR REPLACE FUNCTION public.dev_portal_metrics(p_project uuid, p_env text, p_since timestamptz)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  WITH rows AS (
    SELECT e.ts, e.external_user_id, e.device_id, e.device_kind, e.api_key_id, e.outcome, a.status AS action_status,
           (e.capability IS NOT NULL
            AND e.capability NOT LIKE 'input.%'
            AND coalesce(e.operation, '') NOT IN ('action.read', 'bridge.cast', 'device.read')
            AND coalesce(e.route_decision->>'reason', '') NOT LIKE 'poll:%'
            AND coalesce(e.route_decision->>'reason', '') NOT LIKE 'idempotent replay:%') AS is_delivery
      FROM public.dev_events e
      LEFT JOIN public.dev_actions a ON a.id = e.action_id
     WHERE e.project_id = p_project
       AND e.env = p_env
       AND e.ts >= p_since
  )
  SELECT coalesce(jsonb_agg(c), '[]'::jsonb)
    FROM (
      SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
             external_user_id AS "user",
             device_id AS device,
             device_kind AS kind,
             api_key_id AS key,
             count(*) AS calls,
             count(*) FILTER (WHERE outcome <> 'ok') AS errors,
             count(*) FILTER (WHERE is_delivery) AS deliveries,
             count(*) FILTER (WHERE is_delivery AND outcome = 'ok' AND coalesce(action_status, 'done') IN ('delivered', 'done')) AS delivered,
             count(*) FILTER (WHERE is_delivery AND (outcome <> 'ok' OR action_status = 'failed')) AS failed,
             max(ts) FILTER (WHERE is_delivery) AS last_delivery
        FROM rows
       GROUP BY 1, 2, 3, 4, 5
    ) c;
$function$;

REVOKE ALL ON FUNCTION public.dev_portal_metrics(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dev_portal_metrics(uuid, text, timestamptz) TO service_role;
