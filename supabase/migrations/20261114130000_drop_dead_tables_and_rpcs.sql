-- DROP DEAD TABLES, RPCS, COLUMNS AND A DUPLICATE POLICY (db-cleanup audit, 2026-09-28).
--
-- Released 2026-09-29 (Samuel: apply the safe drops).
--
-- Evidence for every item (code refs, rows, last write) is in
-- docs/db-cleanup-audit.md, measured 2026-09-28 against production. "No code"
-- below means no reference outside the generated src/shared/supabase/types.ts
-- in src/, packages/, apps/, dopl-desktop-app/ or scripts/.
--
--   1. FUNCTION increment_ingestion_count(uuid) + COLUMN profiles.ingestion_count
--      — the setup-engine ingestion counter. No code calls the RPC; every
--      profile's count is 0. The function is the column's only writer.
--   2. FUNCTION chat_replace_messages(uuid, uuid, jsonb) — no caller; chats use
--      chat_create_with_messages / chat_append_messages.
--   3. TABLE user_preferences (+ its four owner policies) — no code reads or
--      writes it; 3 rows (keys `onboarding`, `theme`), last write 2026-06-09.
--   4. TABLE channel_task_participants (+ policy, workspace-guard trigger) and
--      FUNCTION channel_task_child_workspace_guard() — breakout-room
--      participants, write-dead since the channels rollback (2026-08-01 last
--      insert, 8 rows). The only code reference, repository-tasks.ts ›
--      deleteTaskParticipants, was removed (the FK already cascaded that
--      delete). ⚠ APPLY ONLY AFTER that code is deployed: an older server
--      still issues the delete and would 500 thread deletion.
--      The guard function is used by this table's trigger alone.
--   5. COLUMNS channel_agents.engaged_at / engaged_by + idx_channel_agents_engaged_by
--      — engagement was deleted in the rollback; the mapper already drops both
--      fields. (The TABLE stays: its rows still attribute old agent messages.)
--   6. POLICY chats_owner_select — byte-identical to chats_member_select
--      (both `dopl_chat_readable(id)`, SELECT, PUBLIC), flagged by the
--      multiple_permissive_policies advisor. The pair assertions now pin
--      chats_member_select alone.
--
-- Order: policies → triggers → tables → functions, every statement IF EXISTS.
-- Rollback: the definitions are in 20260415000000 (baseline), 20260707190000,
-- 20260731130000 and 20260921120000; the dropped data is the rows counted above.

-- 6. duplicate chats policy
DROP POLICY IF EXISTS chats_owner_select ON public.chats;

-- 4. breakout participants
DROP TRIGGER IF EXISTS channel_task_participants_workspace_guard ON public.channel_task_participants;
DROP TABLE IF EXISTS public.channel_task_participants;
DROP FUNCTION IF EXISTS public.channel_task_child_workspace_guard();

-- 3. user preferences (policies go with the table)
DROP TABLE IF EXISTS public.user_preferences;

-- 5. channel_agents engagement columns
DROP INDEX IF EXISTS public.idx_channel_agents_engaged_by;
ALTER TABLE IF EXISTS public.channel_agents DROP COLUMN IF EXISTS engaged_by;
ALTER TABLE IF EXISTS public.channel_agents DROP COLUMN IF EXISTS engaged_at;

-- 1. ingestion counter
DROP FUNCTION IF EXISTS public.increment_ingestion_count(uuid);
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS ingestion_count;

-- 2. orphan chat RPC
DROP FUNCTION IF EXISTS public.chat_replace_messages(uuid, uuid, jsonb);
