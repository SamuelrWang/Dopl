-- DEVICE SDK PROSUMER → SDK DEVICE MIGRATION (W1.1, Plans/Dopl SDK Split §8 steps 1-4).
--
-- Dopl dogfoods its own SDK: a Dopl user's paired glasses become an SDK connection under the
-- internal "Dopl App" project (`dev_orgs.internal`, 20261122800000), as end user
-- `external_user_id = <dopl user id>`. This file holds the functions that move a glasses row over
-- and back, and the per-user `sdk_delivery` flag. It MIGRATES NOTHING by itself: no row changes
-- until someone calls `migrate_prosumer_device`, and prod calls need Samuel's go-ahead.
--
-- ⚠ D1 ("an end user is never a Dopl user id", 20261122100000) is deliberately broken for the
--   internal project ONLY: the functions refuse any project whose org is not `internal`.
--
-- THE TWO ROWS. `devices` (20261122200000) is the SDK object model: one owner shape per row
-- (`devices_owner_shape_check`, prosumer `user_id` XOR SDK `project_id`+`env`+`end_user_id`). That
-- check is NOT relaxed here: a migrated row is SDK-shaped, full stop. `glasses_device_links` is the
-- legacy APP table and stays exactly as it is (user_id, token_hash, Hey Even key): the plugin is a
-- Dopl-app client (§7), and its app routes (menu, voice, channels) authenticate there. Keeping it
-- is what makes the move "no re-pair": the same bearer keeps working everywhere, and the device id
-- is the link's id (the A3 backfill copied ids), so nothing is remapped.
--   * Its token hash is COPIED into `device_credentials` (kind `device_token`), so the SDK lens path
--     (`sdk-glasses-port.ts › deviceFromTokenHash`) resolves the same bearer.
--   * A copy is only safe if it cannot outlive the original (A3's reason for not backfilling
--     credentials). `glasses_device_links_sdk_sync` mirrors every legacy revoke, token change and
--     delete onto the SDK side in the same transaction.
--   * Dual read (§8.4): every prosumer lookup by `user_id` (Settings > Devices, Overview tiles,
--     `hasActiveGlasses`, pair claim, reply mirror) reads `glasses_device_links`, never `devices`
--     (`device-migration-dual-read.test.ts` pins that), so nulling `devices.user_id` hides nothing.
--
-- THE FLAG (§8.3). `sdk_delivery_users` holds users who opted in. It is never trusted alone:
-- `sdk_delivery_state` answers enabled only when the flag row exists AND at least one live
-- SDK-shaped even_g2 device under an internal project carries this user as end user, with a live
-- device_token credential and an active connection. `set_sdk_delivery(on)` refuses a user with no
-- such device; `revert_sdk_device` clears the flag when it reverts the user's last one.
--
-- SECURITY. Every table is service role only (RLS on, no policy). Every function is SECURITY
-- INVOKER with a pinned search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted to
-- service_role only (the 20261121120000 pattern; INVARIANTS §9 bans SECURITY DEFINER).
--
-- ROLLBACK. Per device: SELECT public.revert_sdk_device('<device id>'). Whole file (after every
-- device is reverted): DROP TRIGGER glasses_device_links_sdk_sync ON public.glasses_device_links;
-- DROP FUNCTION public.glasses_device_links_sdk_sync(), public.set_sdk_delivery(uuid, boolean),
-- public.sdk_delivery_state(uuid), public.revert_sdk_device(uuid),
-- public.migrate_prosumer_device(uuid, uuid); DROP TABLE public.sdk_delivery_users.

-- ─── The flag ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sdk_delivery_users (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  enabled_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sdk_delivery_users IS
  'Per-user sdk_delivery flag (Plans/Dopl SDK Split §8.3). Never read alone: sdk_delivery_state also checks the migrated device row. Service role only.';

ALTER TABLE public.sdk_delivery_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sdk_delivery_users FROM anon, authenticated;
GRANT ALL ON public.sdk_delivery_users TO service_role;

-- ─── Migrate ───────────────────────────────────────────────────────────────────────────────
-- Moves every LIVE paired glasses of p_user_id (legacy link not revoked, token collected) into
-- p_project_id's `live` env. One transaction (a function call is one). Idempotent: a device already
-- SDK-owned by this user under this project comes back as 'already' and changes nothing.

CREATE OR REPLACE FUNCTION public.migrate_prosumer_device(p_user_id uuid, p_project_id uuid)
  RETURNS TABLE (device_id uuid, outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_end_user uuid;
  v_link     record;
  v_dev      record;
BEGIN
  IF p_user_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'migrate_prosumer_device: user and project are required';
  END IF;

  PERFORM 1
    FROM public.dev_projects p
    JOIN public.dev_orgs o ON o.id = p.org_id
   WHERE p.id = p_project_id
     AND o.internal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'migrate_prosumer_device: project % is not an internal (Dopl App) project', p_project_id;
  END IF;

  INSERT INTO public.dev_end_users (project_id, env, external_user_id)
  VALUES (p_project_id, 'live', p_user_id::text)
  ON CONFLICT (project_id, env, external_user_id) DO NOTHING;

  SELECT e.id INTO v_end_user
    FROM public.dev_end_users e
   WHERE e.project_id = p_project_id
     AND e.env = 'live'
     AND e.external_user_id = p_user_id::text;

  FOR v_link IN
    SELECT g.*
      FROM public.glasses_device_links g
     WHERE g.user_id = p_user_id
       AND g.revoked_at IS NULL
       AND g.token_hash IS NOT NULL
     ORDER BY g.created_at
       FOR UPDATE
  LOOP
    IF v_link.token_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'migrate_prosumer_device: link % token hash is not sha256 hex', v_link.id;
    END IF;

    -- The A3 backfill mirrored links paired before it; a later pair has no `devices` row yet.
    -- Same mapping as that backfill (adapter_version = adapters/even-g2.ts › EVEN_G2_ADAPTER_VERSION).
    INSERT INTO public.devices (
      id, kind, vendor, model, firmware, adapter_id, adapter_version, display_name,
      user_id, legacy_source, last_seen, created_at, revoked_at
    ) VALUES (
      v_link.id,
      'glasses',
      CASE v_link.platform WHEN 'even_g2' THEN 'even_realities' ELSE v_link.platform END,
      v_link.platform,
      NULL,
      v_link.platform,
      '0.1.0',
      v_link.name,
      p_user_id,
      'glasses_device_links',
      v_link.last_seen,
      v_link.created_at,
      NULL
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT d.* INTO v_dev FROM public.devices d WHERE d.id = v_link.id FOR UPDATE;

    IF v_dev.legacy_source IS DISTINCT FROM 'glasses_device_links' THEN
      RAISE EXCEPTION 'migrate_prosumer_device: device % is not a glasses_device_links mirror', v_link.id;
    END IF;
    IF v_dev.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'migrate_prosumer_device: device % is revoked but its link is live', v_link.id;
    END IF;

    IF v_dev.user_id IS NULL THEN
      IF v_dev.project_id = p_project_id AND v_dev.env = 'live' AND v_dev.end_user_id = v_end_user THEN
        device_id := v_link.id;
        outcome := 'already';
        RETURN NEXT;
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'migrate_prosumer_device: device % is SDK-owned by another project or end user', v_link.id;
    END IF;
    IF v_dev.user_id <> p_user_id THEN
      RAISE EXCEPTION 'migrate_prosumer_device: device % belongs to another user', v_link.id;
    END IF;

    -- One owner shape, in one statement: devices_owner_shape_check sees prosumer → SDK.
    UPDATE public.devices d
       SET user_id = NULL,
           project_id = p_project_id,
           env = 'live',
           end_user_id = v_end_user,
           display_name = v_link.name,
           last_seen = v_link.last_seen
     WHERE d.id = v_link.id;

    -- A revert left the old credential revoked; a re-migrate mints a fresh live row for the same hash
    -- only if no row holds it (hash is UNIQUE), else revives the revoked one.
    UPDATE public.device_credentials c
       SET revoked_at = NULL, last_used_at = NULL
     WHERE c.hash = v_link.token_hash
       AND c.device_id = v_link.id
       AND c.kind = 'device_token'
       AND c.revoked_at IS NOT NULL;
    IF NOT FOUND THEN
      INSERT INTO public.device_credentials (device_id, kind, hash)
      VALUES (v_link.id, 'device_token', v_link.token_hash)
      ON CONFLICT DO NOTHING;
    END IF;
    PERFORM 1
      FROM public.device_credentials c
     WHERE c.device_id = v_link.id
       AND c.kind = 'device_token'
       AND c.hash = v_link.token_hash
       AND c.revoked_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'migrate_prosumer_device: could not place a live credential for device %', v_link.id;
    END IF;

    -- The grant Connect would write for an even_g2 (its published families). tier_grants =
    -- connect/scopes.ts › tierGrants(...) of these scopes (device-sdk-prosumer-migration-sql.test.ts).
    INSERT INTO public.connections (project_id, env, end_user_id, device_id, granted_scopes, tier_grants, status)
    SELECT p_project_id, 'live', v_end_user, v_link.id,
           ARRAY['presence.read', 'present.*', 'ask.*', 'input.*']::text[],
           '{"presence.read":"T0","present.*":"T1","ask.*":"T1","input.*":"T1"}'::jsonb,
           'active'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.connections c
        WHERE c.device_id = v_link.id
          AND c.project_id = p_project_id
          AND c.env = 'live'
          AND c.end_user_id = v_end_user
          AND c.revoked_at IS NULL
     );

    device_id := v_link.id;
    outcome := 'migrated';
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.migrate_prosumer_device(uuid, uuid) IS
  'W1.1: move a Dopl user''s live glasses into an INTERNAL project as SDK rows (same device id, token hash copied, active connection). Idempotent; reverse with revert_sdk_device. Service role only.';

-- ─── Revert ────────────────────────────────────────────────────────────────────────────────
-- Puts one migrated device back to the prosumer shape, owned by its legacy link's user. Revokes
-- the SDK credential and connections; clears the user's flag if no migrated device is left.
-- Works on a revoked device too (the revoke stays). Returns the restored owner.

CREATE OR REPLACE FUNCTION public.revert_sdk_device(p_device_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_dev  record;
  v_user uuid;
  v_ext  text;
BEGIN
  -- Link first, then device: the order glasses_device_links_sdk_sync and migrate lock in.
  SELECT g.user_id INTO v_user FROM public.glasses_device_links g WHERE g.id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revert_sdk_device: no glasses_device_links row for %', p_device_id;
  END IF;

  SELECT d.* INTO v_dev FROM public.devices d WHERE d.id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revert_sdk_device: no device %', p_device_id;
  END IF;
  IF v_dev.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'revert_sdk_device: device % is already prosumer-owned', p_device_id;
  END IF;
  IF v_dev.legacy_source IS DISTINCT FROM 'glasses_device_links' THEN
    RAISE EXCEPTION 'revert_sdk_device: device % was born in the SDK; it has no prosumer owner to return to', p_device_id;
  END IF;

  SELECT e.external_user_id INTO v_ext FROM public.dev_end_users e WHERE e.id = v_dev.end_user_id;
  IF v_ext IS DISTINCT FROM v_user::text THEN
    RAISE EXCEPTION 'revert_sdk_device: device % end user does not match its legacy owner', p_device_id;
  END IF;

  UPDATE public.connections c
     SET status = 'revoked', revoked_at = now()
   WHERE c.device_id = p_device_id
     AND c.revoked_at IS NULL;

  UPDATE public.device_credentials c
     SET revoked_at = now()
   WHERE c.device_id = p_device_id
     AND c.revoked_at IS NULL;

  UPDATE public.devices d
     SET user_id = v_user,
         project_id = NULL,
         env = NULL,
         end_user_id = NULL
   WHERE d.id = p_device_id;

  IF NOT EXISTS (
    SELECT 1
      FROM public.devices d
      JOIN public.dev_end_users e ON e.id = d.end_user_id
     WHERE e.external_user_id = v_user::text
       AND d.legacy_source = 'glasses_device_links'
       AND d.revoked_at IS NULL
  ) THEN
    DELETE FROM public.sdk_delivery_users f WHERE f.user_id = v_user;
  END IF;

  RETURN v_user;
END;
$function$;

COMMENT ON FUNCTION public.revert_sdk_device(uuid) IS
  'W1.1 rollback: one migrated glasses device back to its prosumer owner; revokes SDK credential + connections; clears sdk_delivery when the user has no migrated device left. Service role only.';

-- ─── Flag read ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sdk_delivery_state(p_user_id uuid)
  RETURNS TABLE (enabled boolean, device_ids uuid[])
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  WITH migrated AS (
    SELECT d.id
      FROM public.devices d
      JOIN public.dev_end_users e ON e.id = d.end_user_id
      JOIN public.dev_projects p ON p.id = d.project_id
      JOIN public.dev_orgs o ON o.id = p.org_id
     WHERE o.internal
       AND d.env = 'live'
       AND e.env = 'live'
       AND e.external_user_id = p_user_id::text
       AND d.adapter_id = 'even_g2'
       AND d.revoked_at IS NULL
       AND EXISTS (
         SELECT 1 FROM public.device_credentials c
          WHERE c.device_id = d.id AND c.kind = 'device_token' AND c.revoked_at IS NULL
       )
       AND EXISTS (
         SELECT 1 FROM public.connections c
          WHERE c.device_id = d.id AND c.end_user_id = d.end_user_id
            AND c.status = 'active' AND c.revoked_at IS NULL
            AND (c.expires_at IS NULL OR c.expires_at > now())
       )
  )
  SELECT
    EXISTS (SELECT 1 FROM public.sdk_delivery_users f WHERE f.user_id = p_user_id)
      AND EXISTS (SELECT 1 FROM migrated) AS enabled,
    coalesce((SELECT array_agg(m.id ORDER BY m.id) FROM migrated m), '{}'::uuid[]) AS device_ids;
$function$;

COMMENT ON FUNCTION public.sdk_delivery_state(uuid) IS
  'sdk_delivery read path (§8.3): enabled = flag row AND >=1 live migrated even_g2 under an internal project with live credential + active connection. device_ids = those devices. Service role only.';

-- ─── Flag write ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_sdk_delivery(p_user_id uuid, p_on boolean)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_on THEN
    IF cardinality((SELECT s.device_ids FROM public.sdk_delivery_state(p_user_id) s)) = 0 THEN
      RAISE EXCEPTION 'set_sdk_delivery: user % has no migrated glasses; run migrate_prosumer_device first', p_user_id;
    END IF;
    INSERT INTO public.sdk_delivery_users (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  ELSE
    DELETE FROM public.sdk_delivery_users f WHERE f.user_id = p_user_id;
  END IF;
  RETURN (SELECT s.enabled FROM public.sdk_delivery_state(p_user_id) s);
END;
$function$;

COMMENT ON FUNCTION public.set_sdk_delivery(uuid, boolean) IS
  'Turns the sdk_delivery flag on (only after a device migrated) or off. Returns sdk_delivery_state.enabled. Service role only.';

-- ─── Legacy → SDK sync ─────────────────────────────────────────────────────────────────────
-- A migrated device's credential is a COPY of the link's token hash. Every change to the original
-- reaches the copy in the same transaction, so a revoked or rotated token never stays live here.
-- Only rows whose `devices` mirror is SDK-shaped are touched; prosumer rows see a no-op.

CREATE OR REPLACE FUNCTION public.glasses_device_links_sdk_sync()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_dev record;
BEGIN
  SELECT d.id, d.end_user_id INTO v_dev
    FROM public.devices d
   WHERE d.id = OLD.id
     AND d.user_id IS NULL
     AND d.legacy_source = 'glasses_device_links'
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- The link goes when its Dopl account goes (ON DELETE CASCADE): the SDK copy goes with it.
    -- Deleting the device cascades its credentials and connections.
    DELETE FROM public.devices d WHERE d.id = OLD.id;
    DELETE FROM public.dev_end_users e
     WHERE e.id = v_dev.end_user_id
       AND NOT EXISTS (SELECT 1 FROM public.devices d WHERE d.end_user_id = e.id);
    RETURN NULL;
  END IF;

  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    UPDATE public.devices d SET revoked_at = NEW.revoked_at WHERE d.id = NEW.id AND d.revoked_at IS NULL;
    UPDATE public.device_credentials c SET revoked_at = NEW.revoked_at
     WHERE c.device_id = NEW.id AND c.revoked_at IS NULL;
    UPDATE public.connections c SET status = 'revoked', revoked_at = NEW.revoked_at
     WHERE c.device_id = NEW.id AND c.revoked_at IS NULL;
    RETURN NULL;
  END IF;

  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    UPDATE public.device_credentials c SET revoked_at = now()
     WHERE c.device_id = NEW.id AND c.kind = 'device_token' AND c.revoked_at IS NULL;
    IF NEW.token_hash IS NOT NULL AND NEW.revoked_at IS NULL THEN
      -- A hash rotated back to this device's own revoked row: drop the dead row (hash is UNIQUE).
      DELETE FROM public.device_credentials c
       WHERE c.hash = NEW.token_hash AND c.device_id = NEW.id AND c.revoked_at IS NOT NULL;
      INSERT INTO public.device_credentials (device_id, kind, hash)
      VALUES (NEW.id, 'device_token', NEW.token_hash);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.glasses_device_links_sdk_sync() IS
  'Mirrors legacy glasses_device_links revoke / token change / delete onto a migrated SDK device (credential, devices.revoked_at, connections). No-op for prosumer rows.';

DROP TRIGGER IF EXISTS glasses_device_links_sdk_sync ON public.glasses_device_links;
CREATE TRIGGER glasses_device_links_sdk_sync
  AFTER UPDATE OF token_hash, revoked_at OR DELETE ON public.glasses_device_links
  FOR EACH ROW
  EXECUTE FUNCTION public.glasses_device_links_sdk_sync();

-- ─── Grants ────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.migrate_prosumer_device(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migrate_prosumer_device(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.migrate_prosumer_device(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_prosumer_device(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.revert_sdk_device(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revert_sdk_device(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.revert_sdk_device(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revert_sdk_device(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.sdk_delivery_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sdk_delivery_state(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sdk_delivery_state(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sdk_delivery_state(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.set_sdk_delivery(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_sdk_delivery(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.set_sdk_delivery(uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_sdk_delivery(uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.glasses_device_links_sdk_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.glasses_device_links_sdk_sync() FROM anon;
REVOKE ALL ON FUNCTION public.glasses_device_links_sdk_sync() FROM authenticated;

-- ─── Self-check ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  f text;
  v_oid oid;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sdk_delivery_users'::regclass) THEN
    RAISE EXCEPTION 'ABORT: RLS is off on sdk_delivery_users';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sdk_delivery_users') THEN
    RAISE EXCEPTION 'ABORT: sdk_delivery_users must carry no policy (service role only)';
  END IF;
  IF has_table_privilege('anon', 'public.sdk_delivery_users', 'SELECT')
     OR has_table_privilege('authenticated', 'public.sdk_delivery_users', 'SELECT')
     OR has_table_privilege('authenticated', 'public.sdk_delivery_users', 'INSERT') THEN
    RAISE EXCEPTION 'ABORT: sdk_delivery_users is reachable by anon/authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_owner_shape_check') THEN
    RAISE EXCEPTION 'ABORT: devices_owner_shape_check (prosumer XOR SDK) is missing';
  END IF;

  FOREACH f IN ARRAY ARRAY['migrate_prosumer_device', 'revert_sdk_device', 'sdk_delivery_state', 'set_sdk_delivery', 'glasses_device_links_sdk_sync']
  LOOP
    SELECT p.oid INTO v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'ABORT: public.% is missing', f;
    END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'ABORT: % is SECURITY DEFINER (INVARIANTS §9)', f;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'ABORT: anon/authenticated can EXECUTE %', f;
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY['migrate_prosumer_device', 'revert_sdk_device', 'sdk_delivery_state', 'set_sdk_delivery']
  LOOP
    SELECT p.oid INTO v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'ABORT: service_role cannot EXECUTE %', f;
    END IF;
  END LOOP;
END $$;
