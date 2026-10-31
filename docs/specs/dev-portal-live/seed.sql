-- FAKE PORTAL ROWS (Samuel, 2026-10-31: "You can have the agents seed fake rows ... Otherwise, it'll look too empty").
-- Project: Dopl App (internal org, so nothing here reaches dev_billable_events). Every row's id starts 5eed0000-.
-- Removal SQL is in PROGRESS.md. Safe to re-run only after removing.
--
-- Webhooks: nothing is left pending, so the sender never picks a seeded delivery up. The enabled endpoints listen only to
-- events nothing emits today, and the one with live event names is paused, so real traffic never fans out to a fake URL.
-- Keys: each hash is of a random value nobody holds, so a seeded key can never authenticate.
DO $seed$
DECLARE
  v_project uuid := '62742126-2d87-450c-b02e-2551a03d040b';
  v_org uuid := '0795df4b-e4fc-4627-83d6-ec492109f4bc';
  v_owner uuid := (SELECT owner_user_id FROM public.dev_orgs WHERE id = '0795df4b-e4fc-4627-83d6-ec492109f4bc');
  v_people text[] := ARRAY['Maya Chen','Tom Okafor','Priya Nair','Lucas Meyer','Sofia Rossi','Daniel Kim','Hannah Berg','Omar Haddad','Elena Petrova','Jack Sullivan','Aiko Tanaka','Grace Mensah','Noah Fischer','Isabel Ortiz','Ravi Shah','Clara Dubois'];
  v_notices text[] := ARRAY[
    'Deploy finished. All checks passed.','Your 2pm moved to 3pm.','Build failed on main: two tests red.','PR 482 is ready for your review.','Customer call starts in 10 minutes.',
    'Standup notes are in the channel.','Invoice 1187 was paid.','Staging is back up.','The migration finished in 4 minutes.','Agent finished the summary. Three items need you.',
    'Weather alert: rain from 4pm.','Package arrived at the front desk.','Q3 numbers are ready to read.','Flight UA 214 is boarding at gate 22.','Your agent drafted the reply to Sam.'];
  v_asks text[] := ARRAY['Ship it?','Approve the refund for order 8841?','Merge the dependency update?','Reply to Sam now or tonight?','Book the 9am train?','Restart the staging worker?','Send the draft to the team?'];
  v_inbound text[] := ARRAY['Summarize what changed today','What is on my calendar tomorrow?','Tell the team I am running ten minutes late','Draft a reply to the last email','Remind me to call Dana at five','Check whether the deploy finished','Read me the open action items','Push the release to Friday','Who is on call this week?','Add milk to the shopping list'];
  v_speak text[] := ARRAY['Dinner is ready in ten minutes.','Your meeting starts in five minutes.','The laundry cycle is done.','Time to leave for the airport.','The front door was left unlocked.'];
  v_keys uuid[]; v_key uuid; v_end uuid; v_dev uuid; v_ext text; v_name text;
  v_devs jsonb := '[]'::jsonb; v_d jsonb; v_consider jsonb;
  n int := 0; a int := 0; i int; d int; c int; r float; v_ts timestamptz; v_act uuid; v_ev uuid; v_status text; v_outcome text; v_code text; v_cap text; v_intent text; v_text text; v_label text; v_lat int; v_opts jsonb;
  v_ok boolean; v_http int; v_seen timestamptz; v_dep uuid; v_ob uuid; v_ep uuid; x int; tries int; v_t timestamptz; v_kind text;
BEGIN
  PERFORM setseed(0.42);
  IF EXISTS (SELECT 1 FROM public.dev_end_users WHERE id::text LIKE '5eed0000-%') THEN RAISE EXCEPTION 'seed rows already exist; remove them first'; END IF;

  -- Keys
  v_keys := ARRAY['5eed0000-0006-4000-8000-000000000001','5eed0000-0006-4000-8000-000000000002','5eed0000-0006-4000-8000-000000000003']::uuid[];
  INSERT INTO public.dev_api_keys (id, project_id, env, kind, prefix, key_hash, scopes, name, created_by, created_at, last_used_at, revoked_at) VALUES
    ('5eed0000-0006-4000-8000-000000000001', v_project, 'live', 'secret', 'sk_live_Mx7a', encode(sha256(gen_random_uuid()::text::bytea),'hex'), ARRAY['actions:write','devices:read'], 'Assistant backend', v_owner, now()-interval '41 days', now()-interval '4 minutes', NULL),
    ('5eed0000-0006-4000-8000-000000000002', v_project, 'live', 'secret', 'sk_live_Rk2p', encode(sha256(gen_random_uuid()::text::bytea),'hex'), ARRAY['actions:write'], 'Notifications worker', v_owner, now()-interval '26 days', now()-interval '38 minutes', NULL),
    ('5eed0000-0006-4000-8000-000000000003', v_project, 'live', 'secret', 'sk_live_Tz9c', encode(sha256(gen_random_uuid()::text::bytea),'hex'), ARRAY['devices:read','analytics:read'], 'Reporting job', v_owner, now()-interval '19 days', now()-interval '2 hours', NULL),
    ('5eed0000-0006-4000-8000-000000000004', v_project, 'live', 'secret', 'sk_live_Hn4w', encode(sha256(gen_random_uuid()::text::bytea),'hex'), ARRAY['analytics:read'], 'Old export script', v_owner, now()-interval '75 days', now()-interval '44 days', NULL),
    ('5eed0000-0006-4000-8000-000000000005', v_project, 'live', 'publishable', 'pk_Vd3e', encode(sha256(gen_random_uuid()::text::bytea),'hex'), ARRAY['connect'], 'Connect widget', v_owner, now()-interval '41 days', now()-interval '3 hours', NULL),
    ('5eed0000-0006-4000-8000-000000000006', v_project, 'live', 'secret', 'sk_live_Bq8s', encode(sha256(gen_random_uuid()::text::bytea),'hex'), ARRAY['actions:write'], 'Contractor sandbox', v_owner, now()-interval '60 days', now()-interval '33 days', now()-interval '30 days'),
    ('5eed0000-0006-4000-8000-000000000007', v_project, 'test', 'secret', 'sk_test_Lp5y', encode(sha256(gen_random_uuid()::text::bytea),'hex'), ARRAY['actions:write','devices:read','connect','analytics:read'], 'Local development', v_owner, now()-interval '30 days', now()-interval '1 hour', NULL);

  -- Live users and their devices
  FOR i IN 1 .. array_length(v_people, 1) LOOP
    v_name := v_people[i];
    v_ext := 'usr_' || substr(md5(v_name), 1, 8);
    v_end := ('5eed0000-0001-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO public.dev_end_users (id, project_id, env, external_user_id, display_name, created_at) VALUES (v_end, v_project, 'live', v_ext, v_name, now() - (3 + i * 2.1) * interval '1 day');
    FOR d IN 1 .. 3 LOOP
      -- Everyone has glasses; about half a Mac; about a third a speaker.
      CONTINUE WHEN (d = 2 AND i % 2 = 1) OR (d = 3 AND i % 3 <> 0);
      n := n + 1;
      v_dev := ('5eed0000-0002-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
      -- Two stale pairings, the rest seen in the last days.
      v_seen := CASE WHEN n IN (7, 15) THEN now() - (18 + n) * interval '1 day' ELSE now() - random() * 5 * interval '1 day' END;
      INSERT INTO public.devices (id, kind, vendor, model, firmware, adapter_id, adapter_version, display_name, project_id, env, end_user_id, last_seen, created_at)
      VALUES (v_dev,
        (ARRAY['glasses','desktop','home_hub'])[d], (ARRAY['even_realities','apple','google'])[d], (ARRAY['even_g2','macos','Google Home'])[d],
        (ARRAY['1.4.2','26.1',NULL])[d], (ARRAY['even_g2','desktop','google_home'])[d], '0.1.0',
        split_part(v_name, ' ', 1) || (ARRAY['''s G2','''s MacBook','''s Nest Mini'])[d], v_project, 'live', v_end, v_seen, now() - (2 + i * 2.1) * interval '1 day');
      INSERT INTO public.connections (id, project_id, env, end_user_id, device_id, granted_scopes, tier_grants, status, created_at)
      VALUES (('5eed0000-0003-4000-8000-' || lpad(n::text, 12, '0'))::uuid, v_project, 'live', v_end, v_dev,
        CASE d WHEN 1 THEN ARRAY['presence.read','present.*','ask.choice','input.*'] WHEN 2 THEN ARRAY['presence.read'] ELSE ARRAY['presence.read','present.speak'] END,
        '{}'::jsonb, CASE WHEN n IN (4, 12) THEN 'needs_reauth' ELSE 'active' END, now() - (2 + i * 2.1) * interval '1 day');
      v_devs := v_devs || jsonb_build_array(jsonb_build_object('id', v_dev, 'd', d, 'end', v_end, 'ext', v_ext, 'kind', (ARRAY['glasses','desktop','home_hub'])[d], 'vendor', (ARRAY['even_realities','apple','google'])[d], 'model', (ARRAY['even_g2','macos','Google Home'])[d], 'name', split_part(v_name, ' ', 1)));
    END LOOP;
  END LOOP;

  -- 28 days of traffic, weekdays heavier, growing toward today.
  FOR x IN 0 .. 27 LOOP
    c := round((CASE WHEN extract(isodow FROM now() - x * interval '1 day') >= 6 THEN 9 ELSE 20 END) * (1.25 - x * 0.02) * (0.8 + random() * 0.5));
    FOR i IN 1 .. c LOOP
      a := a + 1;
      v_d := v_devs -> floor(random() * jsonb_array_length(v_devs))::int;
      v_ts := CASE WHEN x = 0 THEN now() - random() * interval '5 hours' - interval '2 minutes' ELSE now() - x * interval '1 day' - random() * interval '10 hours' END;
      v_ev := ('5eed0000-0005-4000-8000-' || lpad(a::text, 12, '0'))::uuid;
      v_key := v_keys[1 + floor(random() * 2)::int];

      IF (v_d->>'d')::int = 2 THEN
        -- A Mac only sends: a person's message, as it does for real.
        INSERT INTO public.dev_events (event_id, ts, org_id, project_id, env, external_user_id, device_id, device_kind, vendor, model, adapter_version, outcome, latency_ms, operation, message_text)
        VALUES (v_ev, v_ts, v_org, v_project, 'live', v_d->>'ext', v_d->>'id', 'desktop', 'apple', 'macos', '0.1.0', 'ok', '{"api":0}'::jsonb, 'message.from_desktop', v_inbound[1 + floor(random() * array_length(v_inbound, 1))::int]);
        CONTINUE;
      END IF;

      r := random();
      IF (v_d->>'d')::int = 1 AND r < 0.14 THEN
        INSERT INTO public.dev_events (event_id, ts, org_id, project_id, env, external_user_id, device_id, device_kind, vendor, model, adapter_version, capability, outcome, latency_ms, operation, message_text)
        VALUES (v_ev, v_ts, v_org, v_project, 'live', v_d->>'ext', v_d->>'id', 'glasses', 'even_realities', 'even_g2', '0.1.0', 'input.utterance', 'ok', '{"api":0}'::jsonb, 'message.from_glasses', v_inbound[1 + floor(random() * array_length(v_inbound, 1))::int]);
        CONTINUE;
      END IF;
      IF r < 0.24 THEN
        INSERT INTO public.dev_events (event_id, ts, org_id, project_id, env, external_user_id, outcome, latency_ms, api_key_id, operation, http_method, route, http_status)
        VALUES (v_ev, v_ts, v_org, v_project, 'live', v_d->>'ext', 'ok', jsonb_build_object('api', 20 + floor(random() * 90)), '5eed0000-0006-4000-8000-000000000003', 'context.read', 'GET', '/api/v1/users/' || (v_d->>'ext') || '/context', 200);
        CONTINUE;
      END IF;

      IF (v_d->>'d')::int = 3 THEN
        v_cap := 'present.speak'; v_intent := 'message'; v_text := v_speak[1 + floor(random() * array_length(v_speak, 1))::int]; v_label := NULL;
      ELSIF random() < 0.2 THEN
        v_cap := 'ask.choice'; v_intent := 'ask'; v_text := v_asks[1 + floor(random() * array_length(v_asks, 1))::int];
        v_label := (ARRAY['Yes','No','Later'])[1 + floor(random() * 3)::int];
      ELSE
        v_cap := CASE WHEN random() < 0.5 THEN 'present.notify' ELSE 'present.display' END;
        v_intent := CASE WHEN v_cap = 'present.notify' THEN 'notify' ELSE 'message' END;
        v_text := v_notices[1 + floor(random() * array_length(v_notices, 1))::int]; v_label := NULL;
      END IF;

      r := random();
      v_code := CASE WHEN r < 0.045 THEN 'device_offline' WHEN r < 0.06 THEN 'grant_missing' WHEN r < 0.07 THEN 'rate_limited' ELSE NULL END;
      v_ok := v_code IS NULL;
      v_lat := 40 + floor(random() * 240);
      v_consider := jsonb_build_array(jsonb_build_object('device_id', v_d->>'id', 'kind', v_d->>'kind', 'verdict', CASE WHEN v_ok THEN 'chosen' ELSE 'skipped' END, 'reason', CASE WHEN v_ok THEN 'most recently active online device' WHEN v_code = 'device_offline' THEN 'offline' ELSE 'not granted' END));

      IF v_ok THEN
        v_act := ('5eed0000-0004-4000-8000-' || lpad(a::text, 12, '0'))::uuid;
        v_status := CASE WHEN random() < 0.03 THEN 'failed' WHEN v_cap = 'present.speak' THEN 'delivered' ELSE 'done' END;
        IF v_cap = 'ask.choice' AND v_status = 'done' AND random() < 0.12 THEN v_status := 'delivered'; v_label := NULL; END IF;
        INSERT INTO public.dev_actions (id, project_id, env, end_user_id, device_id, source, capability, intent, status, idempotency_key, request_hash, http_status, response, result, error, route_decision, created_at, updated_at, delivered_at, settled_at)
        VALUES (v_act, v_project, 'live', (v_d->>'end')::uuid, (v_d->>'id')::uuid, 'deliver', v_cap, v_intent, v_status, 'seed:' || a, encode(sha256(('seed:' || a)::bytea), 'hex'), 202,
          jsonb_build_object('status', v_status, 'delivery_id', v_act, 'routed_to', jsonb_build_object('kind', v_d->>'kind', 'reason', 'most recently active online device', 'device_id', v_d->>'id')),
          CASE WHEN v_label IS NOT NULL AND v_status = 'done' THEN jsonb_build_object('index', 0, 'label', v_label, 'answered_at', v_ts + (5 + random() * 40) * interval '1 second') END,
          CASE WHEN v_status = 'failed' THEN jsonb_build_object('code', 'vendor_error', 'message', 'The device transport failed while sending.') END,
          jsonb_build_object('target', 'auto', 'reason', 'most recently active online device', 'candidates', jsonb_build_array(v_d->>'id')),
          v_ts, v_ts + interval '30 seconds',
          CASE WHEN v_status <> 'failed' THEN v_ts + (1 + random() * 3) * interval '1 second' END,
          CASE WHEN v_status IN ('done', 'failed') THEN v_ts + (2 + random() * 30) * interval '1 second' END);
      ELSE
        v_act := NULL;
      END IF;

      INSERT INTO public.dev_events (event_id, ts, org_id, project_id, env, external_user_id, device_id, device_kind, vendor, model, adapter_version, capability, intent, route_decision, profile_id, profile_version, outcome, error_code, latency_ms, bytes_in, bytes_out, api_key_id, action_id, operation, http_method, route, http_status, message_text)
      VALUES (v_ev, v_ts, v_org, v_project, 'live', v_d->>'ext', v_d->>'id', v_d->>'kind', v_d->>'vendor', v_d->>'model', '0.1.0', v_cap, v_intent,
        jsonb_build_object('target', 'auto', 'reason', CASE WHEN v_ok THEN 'most recently active online device' WHEN v_code = 'device_offline' THEN 'every candidate is offline' ELSE 'no candidate holds a grant for this' END, 'candidates', jsonb_build_array(v_d->>'id'), 'considered', v_consider),
        (CASE WHEN (v_d->>'d')::int = 3 THEN 'home_hub-default' ELSE 'glasses-default' END), 1, CASE WHEN v_ok THEN 'ok' WHEN v_code = 'grant_missing' THEN 'denied' ELSE 'error' END, v_code,
        jsonb_build_object('api', v_lat, 'device_delivery', CASE WHEN v_ok THEN 400 + floor(random() * 1400) END),
        120 + floor(random() * 300), 90, v_key, v_act, 'deliver', 'POST', '/api/v1/users/' || (v_d->>'ext') || '/deliver', CASE WHEN v_ok THEN 202 WHEN v_code = 'grant_missing' THEN 403 WHEN v_code = 'rate_limited' THEN 429 ELSE 409 END, v_text);
    END LOOP;
  END LOOP;

  -- Webhook endpoints
  INSERT INTO public.dev_webhook_endpoints (id, project_id, env, url, description, enabled_events, secret_id, disabled_at, created_at, updated_at) VALUES
    ('5eed0000-0007-4000-8000-000000000001', v_project, 'live', 'https://hooks.acme-assistant.example/dopl/presence', 'Presence dashboard', ARRAY['device.online','device.offline'], gen_random_uuid(), NULL, now()-interval '29 days', now()-interval '29 days'),
    ('5eed0000-0007-4000-8000-000000000002', v_project, 'live', 'https://ops.acme-assistant.example/hooks/relink', 'Relink alerts', ARRAY['connection.needs_reauth','ask.answered'], gen_random_uuid(), NULL, now()-interval '21 days', now()-interval '21 days'),
    ('5eed0000-0007-4000-8000-000000000003', v_project, 'live', 'https://data.acme-assistant.example/ingest/dopl', 'Analytics warehouse', ARRAY['action.completed','action.failed','connection.created'], gen_random_uuid(), now()-interval '2 days', now()-interval '27 days', now()-interval '2 days'),
    ('5eed0000-0007-4000-8000-000000000004', v_project, 'test', 'https://staging.acme-assistant.example/dopl/events', 'Staging', ARRAY['device.online','device.offline'], gen_random_uuid(), NULL, now()-interval '14 days', now()-interval '14 days');

  a := 0;
  FOR x IN 0 .. 26 LOOP
    FOR i IN 1 .. (3 + floor(random() * 6))::int LOOP
      a := a + 1;
      r := random();
      v_ep := ('5eed0000-0007-4000-8000-00000000000' || (CASE WHEN r < 0.5 THEN 1 WHEN r < 0.75 THEN 2 ELSE 3 END))::uuid;
      -- The paused endpoint stopped two days ago; the failing one's newest sends all failed.
      CONTINUE WHEN r >= 0.75 AND x < 3;
      v_kind := CASE WHEN r < 0.5 THEN (ARRAY['device.online','device.offline'])[1 + floor(random() * 2)::int] WHEN r < 0.75 THEN 'connection.needs_reauth' ELSE (ARRAY['action.completed','action.completed','action.failed'])[1 + floor(random() * 3)::int] END;
      v_t := now() - x * interval '1 day' - random() * interval '20 hours' - interval '5 minutes';
      v_ob := ('5eed0000-0008-4000-8000-' || lpad(a::text, 12, '0'))::uuid;
      v_dep := ('5eed0000-0009-4000-8000-' || lpad(a::text, 12, '0'))::uuid;
      v_ok := NOT (r >= 0.5 AND r < 0.75 AND x < 4) AND random() > 0.04;
      tries := CASE WHEN v_ok THEN 1 + (random() < 0.08)::int ELSE 8 END;
      v_d := v_devs -> floor(random() * jsonb_array_length(v_devs))::int;
      INSERT INTO public.dev_webhook_outbox (id, project_id, env, event_type, payload, status, attempts, next_attempt_at, created_at)
      VALUES (v_ob, v_project, 'live', v_kind, jsonb_build_object('id', 'evt_' || v_ob, 'type', v_kind, 'api_version', '2026-10-01', 'timestamp', v_t, 'livemode', true, 'data', jsonb_build_object('device_id', v_d->>'id', 'external_user_id', v_d->>'ext')), 'delivered', 1, v_t, v_t);
      INSERT INTO public.dev_webhook_deliveries (id, outbox_id, endpoint_id, project_id, env, event_type, status, attempts, next_attempt_at, last_status_code, last_error, delivered_at, created_at, updated_at)
      VALUES (v_dep, v_ob, v_ep, v_project, 'live', v_kind, CASE WHEN v_ok THEN 'delivered' ELSE 'failed' END, tries, v_t, CASE WHEN v_ok THEN 200 ELSE 500 END, CASE WHEN v_ok THEN NULL ELSE 'Endpoint answered 500' END, CASE WHEN v_ok THEN v_t + interval '1 second' END, v_t, v_t);
      FOR d IN 1 .. tries LOOP
        INSERT INTO public.dev_webhook_attempts (id, delivery_id, attempt, attempted_at, status_code, error, duration_ms)
        VALUES (('5eed0000-000a-4000-8' || lpad(d::text, 3, '0') || '-' || lpad(a::text, 12, '0'))::uuid, v_dep, d, v_t + d * interval '5 minutes', CASE WHEN v_ok AND d = tries THEN 200 ELSE 500 END, NULL, 80 + floor(random() * 500));
      END LOOP;
    END LOOP;
  END LOOP;

  -- Test environment: a few simulated users, so Test is not bare.
  n := 100; a := 100000;
  FOR i IN 1 .. 3 LOOP
    v_name := (ARRAY['Test user one','Test user two','Test user three'])[i];
    v_ext := 'test_user_' || i;
    v_end := ('5eed0000-0001-4000-8000-' || lpad((100 + i)::text, 12, '0'))::uuid;
    v_dev := ('5eed0000-0002-4000-8000-' || lpad((100 + i)::text, 12, '0'))::uuid;
    INSERT INTO public.dev_end_users (id, project_id, env, external_user_id, display_name, created_at) VALUES (v_end, v_project, 'test', v_ext, v_name, now() - interval '14 days');
    INSERT INTO public.devices (id, kind, vendor, model, adapter_id, adapter_version, display_name, project_id, env, end_user_id, last_seen, created_at)
    VALUES (v_dev, 'phone', 'dopl', 'simulated_phone', 'simulator', '0.1.0', 'Simulated phone ' || i, v_project, 'test', v_end, now() - random() * interval '3 days', now() - interval '14 days');
    INSERT INTO public.connections (id, project_id, env, end_user_id, device_id, granted_scopes, tier_grants, status, created_at)
    VALUES (('5eed0000-0003-4000-8000-' || lpad((100 + i)::text, 12, '0'))::uuid, v_project, 'test', v_end, v_dev, ARRAY['presence.read','present.*','ask.*'], '{}'::jsonb, 'active', now() - interval '14 days');
    FOR x IN 0 .. 13 LOOP
      FOR d IN 1 .. (1 + floor(random() * 4))::int LOOP
        a := a + 1;
        v_ts := now() - x * interval '1 day' - random() * interval '6 hours' - interval '3 minutes';
        v_act := ('5eed0000-0004-4000-8000-' || lpad(a::text, 12, '0'))::uuid;
        v_ev := ('5eed0000-0005-4000-8000-' || lpad(a::text, 12, '0'))::uuid;
        v_text := v_notices[1 + floor(random() * array_length(v_notices, 1))::int];
        INSERT INTO public.dev_actions (id, project_id, env, end_user_id, device_id, source, capability, intent, status, idempotency_key, request_hash, http_status, response, route_decision, created_at, updated_at, delivered_at, settled_at)
        VALUES (v_act, v_project, 'test', v_end, v_dev, 'deliver', 'present.notify', 'notify', 'done', 'seed:' || a, encode(sha256(('seed:' || a)::bytea), 'hex'), 202, jsonb_build_object('status', 'done', 'delivery_id', v_act), jsonb_build_object('target', 'auto', 'reason', 'most recently active online device', 'candidates', jsonb_build_array(v_dev)), v_ts, v_ts, v_ts, v_ts);
        INSERT INTO public.dev_events (event_id, ts, org_id, project_id, env, external_user_id, device_id, device_kind, vendor, model, adapter_version, capability, intent, route_decision, profile_id, profile_version, outcome, latency_ms, api_key_id, action_id, operation, http_method, route, http_status, message_text)
        VALUES (v_ev, v_ts, v_org, v_project, 'test', v_ext, v_dev::text, 'phone', 'dopl', 'simulated_phone', '0.1.0', 'present.notify', 'notify', jsonb_build_object('target', 'auto', 'reason', 'most recently active online device', 'candidates', jsonb_build_array(v_dev), 'considered', jsonb_build_array(jsonb_build_object('device_id', v_dev, 'kind', 'phone', 'verdict', 'chosen', 'reason', 'most recently active online device'))), 'phone-default', 1, 'ok', jsonb_build_object('api', 30 + floor(random() * 80)), '5eed0000-0006-4000-8000-000000000007', v_act, 'deliver', 'POST', '/api/v1/users/' || v_ext || '/deliver', 202, v_text);
      END LOOP;
    END LOOP;
  END LOOP;
END;
$seed$;

-- Devices that read online: a future last_seen stays inside every adapter's online window, with no cron. Skips the
-- stale and needs-relink ones and every third device. `dev_portal_roll_seed` leaves these alone.
UPDATE public.devices d SET last_seen = now() + interval '10 years'
  FROM public.connections c
 WHERE d.id::text LIKE '5eed0000-0002-%' AND d.env = 'live' AND c.device_id = d.id AND c.status = 'active'
   AND right(d.id::text, 12)::int % 3 <> 0 AND right(d.id::text, 12)::int NOT IN (4, 7, 12, 15);
