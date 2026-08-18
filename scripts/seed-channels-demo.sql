-- Channels demo seed — Samuel's Workspace (2026-08-18)
--
-- Seeds a demo cast + one "Website" channel + three threads + transcripts into
-- the LIVE project so the channels-v2 UI can be reviewed fleshed-out with only
-- one real human account. Requested by Samuel 2026-08-18 (MAPPING.md fourth
-- round: the demo-seed decision).
--
-- PROPERTIES
-- - Idempotent: every row is keyed on a fixed id in the de300000-* namespace
--   (or a demo-seed-* client_msg_id); re-running inserts nothing twice.
-- - Removable: everything this file created can be found by that namespace.
-- - Demo auth users carry an INVALID password hash — the accounts cannot log in.
-- - Messages go through channel_message_insert (the serialized-append RPC), so
--   seq is real; created_at is backdated AFTER insert, in seq order, so the
--   transcript reads as history without violating seq monotonicity.
-- - Touches NOTHING outside the demo namespace except: workspace_members rows
--   for the demo users in Samuel's workspace (5291e457-…), and their profiles.
--   Samuel's existing channels and their rosters are NOT touched — a ghost row
--   in a live 1:1 would disable its implicit trigger (INVARIANTS §5).
--
-- Ids:
--   workspace  5291e457-6a49-4148-af71-0f87361d5f55  (Samuel's Workspace)
--   samuel     e95bd11c-32b9-42ab-b754-ffe93787de0a  (samuelnywang717@gmail.com)
--   demo users de300000-0000-4000-8000-00000000000{1..6}
--   channel    de300000-0000-4000-8000-0000000000c1  (#website)
--   threads    de300000-0000-4000-8000-0000000000a{1..3}

begin;

-- ── 1. Demo auth users (login-disabled) ────────────────────────────────────
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'demo-seed-login-disabled', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', v.display_name),
  now(), now(), '', '', '', ''
from (values
  ('de300000-0000-4000-8000-000000000001'::uuid, 'diana@demo.dopl.internal',  'Diana Taylor'),
  ('de300000-0000-4000-8000-000000000002'::uuid, 'daniel@demo.dopl.internal', 'Daniel Anderson'),
  ('de300000-0000-4000-8000-000000000003'::uuid, 'emily@demo.dopl.internal',  'Emily Davis'),
  ('de300000-0000-4000-8000-000000000004'::uuid, 'andrew@demo.dopl.internal', 'Andrew Miller'),
  ('de300000-0000-4000-8000-000000000005'::uuid, 'william@demo.dopl.internal','William Johnson'),
  ('de300000-0000-4000-8000-000000000006'::uuid, 'sophia@demo.dopl.internal', 'Sophia Wilson')
) as v(id, email, display_name)
on conflict (id) do nothing;

-- profiles: handle_new_user may or may not have fired historically — upsert.
insert into public.profiles (id, email, display_name)
select v.id, v.email, v.display_name from (values
  ('de300000-0000-4000-8000-000000000001'::uuid, 'diana@demo.dopl.internal',  'Diana Taylor'),
  ('de300000-0000-4000-8000-000000000002'::uuid, 'daniel@demo.dopl.internal', 'Daniel Anderson'),
  ('de300000-0000-4000-8000-000000000003'::uuid, 'emily@demo.dopl.internal',  'Emily Davis'),
  ('de300000-0000-4000-8000-000000000004'::uuid, 'andrew@demo.dopl.internal', 'Andrew Miller'),
  ('de300000-0000-4000-8000-000000000005'::uuid, 'william@demo.dopl.internal','William Johnson'),
  ('de300000-0000-4000-8000-000000000006'::uuid, 'sophia@demo.dopl.internal', 'Sophia Wilson')
) as v(id, email, display_name)
on conflict (id) do update set display_name = excluded.display_name;

-- ── 2. Workspace membership (Samuel's Workspace) ───────────────────────────
-- last_seen_at: five look recently-active; Sophia reads offline. NOTE the 90s
-- presence window — demo members drift to "offline" 90s after any re-touch.
insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, last_seen_at)
select '5291e457-6a49-4148-af71-0f87361d5f55', v.id, 'member', 'active',
       'e95bd11c-32b9-42ab-b754-ffe93787de0a',
       case when v.offline then now() - interval '3 days' else now() end
from (values
  ('de300000-0000-4000-8000-000000000001'::uuid, false),
  ('de300000-0000-4000-8000-000000000002'::uuid, false),
  ('de300000-0000-4000-8000-000000000003'::uuid, false),
  ('de300000-0000-4000-8000-000000000004'::uuid, false),
  ('de300000-0000-4000-8000-000000000005'::uuid, false),
  ('de300000-0000-4000-8000-000000000006'::uuid, true)
) as v(id, offline)
where not exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = '5291e457-6a49-4148-af71-0f87361d5f55' and wm.user_id = v.id
);

-- ── 3. The demo channel (#website) ─────────────────────────────────────────
insert into public.channels (id, workspace_id, created_by, slug, name, topic, visibility)
values ('de300000-0000-4000-8000-0000000000c1',
        '5291e457-6a49-4148-af71-0f87361d5f55',
        'e95bd11c-32b9-42ab-b754-ffe93787de0a',
        'website', 'Website', 'v3.0 redesign — UI kit, QA, handoff', 'private')
on conflict (id) do nothing;

-- Roster: Samuel + all six demo members. 7 members = a GROUP channel, so the
-- implicit trigger can never fire here (INVARIANTS §5) — deliberate.
insert into public.channel_members (channel_id, user_id, workspace_id, role, added_by)
select 'de300000-0000-4000-8000-0000000000c1', v.id,
       '5291e457-6a49-4148-af71-0f87361d5f55',
       case when v.id = 'e95bd11c-32b9-42ab-b754-ffe93787de0a' then 'owner' else 'member' end,
       'e95bd11c-32b9-42ab-b754-ffe93787de0a'
from (values
  ('e95bd11c-32b9-42ab-b754-ffe93787de0a'::uuid),
  ('de300000-0000-4000-8000-000000000001'::uuid),
  ('de300000-0000-4000-8000-000000000002'::uuid),
  ('de300000-0000-4000-8000-000000000003'::uuid),
  ('de300000-0000-4000-8000-000000000004'::uuid),
  ('de300000-0000-4000-8000-000000000005'::uuid),
  ('de300000-0000-4000-8000-000000000006'::uuid)
) as v(id)
where not exists (
  select 1 from public.channel_members cm
  where cm.channel_id = 'de300000-0000-4000-8000-0000000000c1' and cm.user_id = v.id
);

-- ── 4. Threads (channel_tasks: one requester + one target each) ────────────
insert into public.channel_tasks (id, channel_id, workspace_id, title, status, mode, created_by, target_user_id, client_msg_id)
values
  ('de300000-0000-4000-8000-0000000000a1', 'de300000-0000-4000-8000-0000000000c1',
   '5291e457-6a49-4148-af71-0f87361d5f55', 'UI-kit design', 'open', 'interactive',
   'e95bd11c-32b9-42ab-b754-ffe93787de0a', 'de300000-0000-4000-8000-000000000001', 'demo-seed-task-1'),
  ('de300000-0000-4000-8000-0000000000a2', 'de300000-0000-4000-8000-0000000000c1',
   '5291e457-6a49-4148-af71-0f87361d5f55', 'Lottie animation handoff', 'open', 'interactive',
   'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000003', 'demo-seed-task-2'),
  ('de300000-0000-4000-8000-0000000000a3', 'de300000-0000-4000-8000-0000000000c1',
   '5291e457-6a49-4148-af71-0f87361d5f55', 'Color token audit', 'open', 'interactive',
   'e95bd11c-32b9-42ab-b754-ffe93787de0a', 'de300000-0000-4000-8000-000000000005', 'demo-seed-task-3')
on conflict (id) do nothing;

-- ── 5. Messages, through the serialized-append RPC, then backdated ─────────
-- Guarded by client_msg_id so a re-run inserts nothing.
do $$
declare
  ch  uuid := 'de300000-0000-4000-8000-0000000000c1';
  ws  uuid := '5291e457-6a49-4148-af71-0f87361d5f55';
  sam uuid := 'e95bd11c-32b9-42ab-b754-ffe93787de0a';
  diana uuid := 'de300000-0000-4000-8000-000000000001';
  daniel uuid := 'de300000-0000-4000-8000-000000000002';
  emily uuid := 'de300000-0000-4000-8000-000000000003';
  andrew uuid := 'de300000-0000-4000-8000-000000000004';
  william uuid := 'de300000-0000-4000-8000-000000000005';
  t1 text := 'de300000-0000-4000-8000-0000000000a1';
  t2 text := 'de300000-0000-4000-8000-0000000000a2';
  t3 text := 'de300000-0000-4000-8000-0000000000a3';
begin
  if exists (select 1 from public.channel_messages
             where channel_id = ch and client_msg_id = 'demo-seed-m01') then
    return;  -- already seeded
  end if;

  -- Channel transcript
  perform public.channel_message_insert(ch, ws, andrew, 'user', 'message',
    'Hey team — the custom UI kit for the site redesign needs its final pass. Colors, typography, buttons, states: let''s lock them this week so nothing drifts after the freeze.',
    '{}'::jsonb, 'demo-seed-m01');
  perform public.channel_message_insert(ch, ws, diana, 'user', 'message',
    'Styles and components are 90% done from the design phase. What remains: states on the interactive elements and the Lottie files. @Emily Davis please take a look when you have a minute.',
    jsonb_build_object('to_user_id', emily), 'demo-seed-m02');
  perform public.channel_message_insert(ch, ws, daniel, 'user', 'message',
    'Keep me updated. @Diana Taylor remember to keep the layers organized. @Samuel Wang can you confirm the button specs are final before Thursday?',
    jsonb_build_object('to_user_id', sam), 'demo-seed-m03');
  perform public.channel_message_insert(ch, ws, sam, 'user', 'message',
    'On it — I''ll push the states today 💪',
    '{}'::jsonb, 'demo-seed-m04');
  perform public.channel_message_insert(ch, ws, sam, 'agent', 'message',
    'Moved the state work into its own thread — "UI-kit design" — so the detail stays out of the channel. Diana is on it there too.',
    '{}'::jsonb, 'demo-seed-m05');
  perform public.channel_message_insert(ch, ws, diana, 'user', 'message',
    '@Samuel Wang the updated kit review page is ready for your pass — flagging it before the freeze so nothing lands after.',
    jsonb_build_object('to_user_id', sam), 'demo-seed-m06');

  -- Thread: UI-kit design (t1)
  perform public.channel_message_insert(ch, ws, diana, 'agent', 'message',
    'Pulled the interactive elements out of the v3.0 file. Hover, focus, pressed and disabled are drafted for 14 components. Two still missing a disabled face: the date field and the file drop zone.',
    jsonb_build_object('taskId', t1), 'demo-seed-m07');
  perform public.channel_message_insert(ch, ws, sam, 'agent', 'message',
    'Put the drafted states on the kit review page so they can be read side by side. Renamed btn/secondary to btn/light so the names match the code. Blocked on the two disabled faces before the kit can be frozen. @Diana Taylor',
    jsonb_build_object('taskId', t1, 'to_user_id', diana), 'demo-seed-m08');
  perform public.channel_message_insert(ch, ws, diana, 'user', 'message',
    'Good catch on the rename — I''ll mirror it in the library today. The disabled faces are drawn, just not published; they go up after standup.',
    jsonb_build_object('taskId', t1), 'demo-seed-m09');
  perform public.channel_message_insert(ch, ws, sam, 'user', 'message',
    'Perfect. Once those land I''ll freeze v1 of the kit and tag it.',
    jsonb_build_object('taskId', t1), 'demo-seed-m10');
  perform public.channel_message_insert(ch, ws, diana, 'agent', 'message',
    'Disabled faces are published — date field and drop zone are both in the v3.0 file. @Samuel Wang both faces are in, ready for your freeze.',
    jsonb_build_object('taskId', t1, 'to_user_id', sam), 'demo-seed-m11');

  -- Thread: Lottie animation handoff (t2)
  perform public.channel_message_insert(ch, ws, diana, 'user', 'message',
    'Handing the hero and empty-state animations to you as Lottie files — both are in the shared folder. Loop points are marked; the hero should NOT loop on reduced motion.',
    jsonb_build_object('taskId', t2, 'to_user_id', emily), 'demo-seed-m12');
  perform public.channel_message_insert(ch, ws, emily, 'agent', 'message',
    'Files received and parsed. Hero animation is 340KB — over the 250KB budget; I can strip the unused precomps and get it under. Empty-state is fine as-is. Proceeding with the strip unless told otherwise.',
    jsonb_build_object('taskId', t2), 'demo-seed-m13');

  -- Thread: Color token audit (t3) — older traffic, sits outside the 24h window
  perform public.channel_message_insert(ch, ws, sam, 'user', 'message',
    'Audit the color usage across v3.0 — anything hardcoded that should be a token, and any token used against its role. List per screen, no fixes yet.',
    jsonb_build_object('taskId', t3, 'to_user_id', william), 'demo-seed-m14');
  perform public.channel_message_insert(ch, ws, william, 'agent', 'message',
    'First pass done on 12 of 21 screens: 7 hardcoded greys (5 are one value — probably a missing token), 2 success-greens used for links. Full per-screen list tomorrow.',
    jsonb_build_object('taskId', t3), 'demo-seed-m15');
end $$;

-- Backdate, in seq order (oldest history first) so seq stays monotonic per
-- created_at reading. Thread activity: t1 fresh (1h), t2 fresh (4h), t3 OLD
-- (26h — demonstrates the 24h sidebar window by sitting just outside it).
update public.channel_messages set created_at = now() - v.age
from (values
  ('demo-seed-m01', interval '2 days'),
  ('demo-seed-m02', interval '2 days' - interval '10 minutes'),
  ('demo-seed-m03', interval '3 hours'),
  ('demo-seed-m04', interval '3 hours' - interval '5 minutes'),
  ('demo-seed-m05', interval '1 hour'),
  ('demo-seed-m06', interval '30 minutes'),
  ('demo-seed-m07', interval '5 hours'),
  ('demo-seed-m08', interval '4 hours'),
  ('demo-seed-m09', interval '3 hours'),
  ('demo-seed-m10', interval '2 hours 50 minutes'),
  ('demo-seed-m11', interval '1 hour'),
  ('demo-seed-m12', interval '5 hours'),
  ('demo-seed-m13', interval '4 hours'),
  ('demo-seed-m14', interval '26 hours'),
  ('demo-seed-m15', interval '25 hours')
) as v(cmid, age)
where channel_messages.client_msg_id = v.cmid
  and channel_messages.channel_id = 'de300000-0000-4000-8000-0000000000c1';

update public.channel_tasks set created_at = now() - v.age
from (values
  ('de300000-0000-4000-8000-0000000000a1'::uuid, interval '6 hours'),
  ('de300000-0000-4000-8000-0000000000a2'::uuid, interval '5 hours'),
  ('de300000-0000-4000-8000-0000000000a3'::uuid, interval '26 hours')
) as v(id, age)
where channel_tasks.id = v.id;

commit;

-- ── Removal (run manually if the demo should go) ────────────────────────────
-- delete from public.channel_messages where channel_id = 'de300000-0000-4000-8000-0000000000c1';
-- delete from public.channels where id = 'de300000-0000-4000-8000-0000000000c1';  -- cascades members/tasks
-- delete from public.workspace_members where user_id::text like 'de300000-%';
-- delete from public.profiles where id::text like 'de300000-%';
-- delete from auth.users where id::text like 'de300000-%';
