-- DEV PORTAL, PHASE 2 (docs/specs/dev-portal-live/PLAN.md, steps 11-14). Additive only.
--
-- 1. `dev_events` gains the fields a message row needs: its text (Samuel, 2026-10-31: "show the text"),
--    the channel and the channel message. They are written only for messages under the internal
--    Dopl App project, are capped by the writer, and go with the row at the 30-day prune.
--    `dev_billable_events` is deliberately NOT re-created: its `e.*` was expanded at creation, so it
--    never carries message text, and it excludes internal orgs anyway. `/v1/events` drops them too
--    (`PRIVATE_EVENT_FIELDS`).
-- 2. `link_desktop_device` moves one computer into an INTERNAL project as a connected device, the
--    same owner-shape move `migrate_prosumer_device` makes for glasses and with the same id, so a
--    post's `metadata.source.device_id` names it. It grants `presence.read` ONLY, so SDK delivery
--    stays refused. It changes nothing until it is called.
--
-- ROLLBACK (prose): DROP FUNCTION public.link_desktop_device(uuid, uuid, uuid); DROP COLUMN each column
-- below. For a linked computer: revoke its connection, then set user_id back and null project_id, env, end_user_id.

ALTER TABLE public.dev_events
  ADD COLUMN IF NOT EXISTS message_text text,
  ADD COLUMN IF NOT EXISTS channel_id uuid,
  ADD COLUMN IF NOT EXISTS message_id uuid;

COMMENT ON COLUMN public.dev_events.message_text IS
  'Text of a message row (internal Dopl App project only). Portal read only, never on /v1/events. Pruned with the row at 30 days.';

CREATE OR REPLACE FUNCTION public.link_desktop_device(p_user_id uuid, p_project_id uuid, p_desktop_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_end_user uuid;
  v_desktop  record;
  v_dev      record;
BEGIN
  IF p_user_id IS NULL OR p_project_id IS NULL OR p_desktop_id IS NULL THEN
    RAISE EXCEPTION 'link_desktop_device: user, project and computer are required';
  END IF;

  PERFORM 1
    FROM public.dev_projects p
    JOIN public.dev_orgs o ON o.id = p.org_id
   WHERE p.id = p_project_id
     AND o.internal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_desktop_device: project % is not internal', p_project_id;
  END IF;

  SELECT d.* INTO v_desktop
    FROM public.desktop_devices d
   WHERE d.id = p_desktop_id
     AND d.user_id = p_user_id
     AND d.revoked_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_desktop_device: no live computer % for this user', p_desktop_id;
  END IF;

  INSERT INTO public.dev_end_users (project_id, env, external_user_id)
  VALUES (p_project_id, 'live', p_user_id::text)
  ON CONFLICT (project_id, env, external_user_id) DO NOTHING;

  SELECT e.id INTO v_end_user
    FROM public.dev_end_users e
   WHERE e.project_id = p_project_id
     AND e.env = 'live'
     AND e.external_user_id = p_user_id::text;

  -- Same mapping as the A3 backfill (adapter_version = adapters/desktop.ts › DESKTOP_ADAPTER_VERSION).
  INSERT INTO public.devices (
    id, kind, vendor, model, firmware, adapter_id, adapter_version, display_name,
    user_id, legacy_source, last_seen, created_at, revoked_at
  ) VALUES (
    v_desktop.id,
    'desktop',
    CASE v_desktop.platform WHEN 'macos' THEN 'apple' WHEN 'windows' THEN 'microsoft' ELSE 'linux' END,
    v_desktop.platform,
    v_desktop.os_version,
    'desktop',
    '0.1.0',
    COALESCE(v_desktop.display_name, v_desktop.name),
    p_user_id,
    'desktop_devices',
    v_desktop.last_seen,
    v_desktop.created_at,
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT d.* INTO v_dev FROM public.devices d WHERE d.id = p_desktop_id FOR UPDATE;

  IF v_dev.legacy_source IS DISTINCT FROM 'desktop_devices' THEN
    RAISE EXCEPTION 'link_desktop_device: device % is not a desktop_devices mirror', p_desktop_id;
  END IF;
  IF v_dev.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'link_desktop_device: device % is revoked', p_desktop_id;
  END IF;

  IF v_dev.user_id IS NULL THEN
    IF v_dev.project_id IS DISTINCT FROM p_project_id OR v_dev.env IS DISTINCT FROM 'live' OR v_dev.end_user_id IS DISTINCT FROM v_end_user THEN
      RAISE EXCEPTION 'link_desktop_device: device % is owned by another project or end user', p_desktop_id;
    END IF;
  ELSE
    IF v_dev.user_id <> p_user_id THEN
      RAISE EXCEPTION 'link_desktop_device: device % belongs to another user', p_desktop_id;
    END IF;
    UPDATE public.devices d
       SET user_id = NULL,
           project_id = p_project_id,
           env = 'live',
           end_user_id = v_end_user,
           display_name = COALESCE(v_desktop.display_name, v_desktop.name),
           last_seen = v_desktop.last_seen
     WHERE d.id = p_desktop_id;
  END IF;

  -- presence.read ONLY: SDK delivery to a computer stays refused (grant_missing at the router).
  INSERT INTO public.connections (project_id, env, end_user_id, device_id, granted_scopes, tier_grants, status)
  SELECT p_project_id, 'live', v_end_user, p_desktop_id,
         ARRAY['presence.read']::text[],
         '{"presence.read":"T0"}'::jsonb,
         'active'
   WHERE NOT EXISTS (
     SELECT 1 FROM public.connections c
      WHERE c.device_id = p_desktop_id
        AND c.project_id = p_project_id
        AND c.env = 'live'
        AND c.end_user_id = v_end_user
        AND c.revoked_at IS NULL
   );

  RETURN 'linked';
END;
$function$;

REVOKE ALL ON FUNCTION public.link_desktop_device(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_desktop_device(uuid, uuid, uuid) TO service_role;
