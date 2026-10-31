-- DEV PORTAL, PHASE 3 REVIEW. Additive: one index, one function body changed, one new function.
--
-- dev_webhook_deliveries_project_env_created_idx   Webhooks and Activity read a project's newest deliveries.
-- dev_portal_metrics.last_delivery                 Now the last delivery a device took. A refused call to an
--                                                  offline device must not make its user read as active.
-- dev_portal_roll_seed                             Moves the 5eed0000- demo rows forward by whole days, so their
--                                                  7-day figures stay full and the 30-day prune never reaches them.
--                                                  Only touches rows with that id prefix. No rows, no work.
--
-- ROLLBACK (prose): DROP FUNCTION public.dev_portal_roll_seed(); DROP the index; restore last_delivery from
-- 20261124115000_dev_portal_reads.sql.

CREATE INDEX IF NOT EXISTS dev_webhook_deliveries_project_env_created_idx ON public.dev_webhook_deliveries (project_id, env, created_at DESC);

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
             max(ts) FILTER (WHERE is_delivery AND outcome = 'ok' AND coalesce(action_status, 'done') IN ('delivered', 'done')) AS last_delivery
        FROM rows
       GROUP BY 1, 2, 3, 4, 5
    ) c;
$function$;

-- A device seeded as online holds a last_seen in the future and stays put. Everything else keeps its age.
CREATE OR REPLACE FUNCTION public.dev_portal_roll_seed()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_days integer;
  v_by interval;
BEGIN
  SELECT floor(extract(epoch FROM now() - max(ts)) / 86400)::integer INTO v_days FROM dev_events WHERE event_id::text LIKE '5eed0000-%';
  IF coalesce(v_days, 0) < 1 THEN RETURN 0; END IF;
  v_by := v_days * interval '1 day';

  UPDATE dev_events SET ts = ts + v_by WHERE event_id::text LIKE '5eed0000-%';
  UPDATE dev_actions
     SET created_at = created_at + v_by, updated_at = updated_at + v_by, delivered_at = delivered_at + v_by, settled_at = settled_at + v_by,
         result = CASE WHEN result ? 'answered_at' THEN jsonb_set(result, '{answered_at}', to_jsonb((result->>'answered_at')::timestamptz + v_by)) ELSE result END
   WHERE id::text LIKE '5eed0000-%';
  UPDATE dev_webhook_outbox
     SET created_at = created_at + v_by, next_attempt_at = next_attempt_at + v_by,
         payload = jsonb_set(payload, '{timestamp}', to_jsonb((payload->>'timestamp')::timestamptz + v_by))
   WHERE id::text LIKE '5eed0000-%';
  UPDATE dev_webhook_deliveries
     SET created_at = created_at + v_by, updated_at = updated_at + v_by, delivered_at = delivered_at + v_by, next_attempt_at = next_attempt_at + v_by
   WHERE id::text LIKE '5eed0000-%';
  UPDATE dev_webhook_attempts SET attempted_at = attempted_at + v_by WHERE id::text LIKE '5eed0000-%';
  UPDATE dev_webhook_endpoints
     SET created_at = created_at + v_by, updated_at = updated_at + v_by, disabled_at = disabled_at + v_by
   WHERE id::text LIKE '5eed0000-%';
  UPDATE devices
     SET created_at = created_at + v_by, last_seen = CASE WHEN last_seen > now() THEN last_seen ELSE least(last_seen + v_by, now()) END
   WHERE id::text LIKE '5eed0000-%';
  UPDATE connections SET created_at = created_at + v_by WHERE id::text LIKE '5eed0000-%';
  UPDATE dev_end_users SET created_at = created_at + v_by WHERE id::text LIKE '5eed0000-%';
  UPDATE dev_api_keys
     SET created_at = created_at + v_by, last_used_at = least(last_used_at + v_by, now()), revoked_at = revoked_at + v_by
   WHERE id::text LIKE '5eed0000-%';
  RETURN v_days;
END;
$function$;

REVOKE ALL ON FUNCTION public.dev_portal_metrics(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dev_portal_metrics(uuid, text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.dev_portal_roll_seed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dev_portal_roll_seed() TO service_role;
