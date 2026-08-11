-- ONE-TIME BACKFILL: remove every `channel_members` row whose user is no longer
-- an active member of that channel's workspace (C-20's sweep half).
--
-- WRITTEN, NOT APPLIED. Read the verification SELECT below on the target
-- database first; it prints exactly what the DELETE will take.
--
-- WHY. Until 2026-08-10 nothing swept `channel_members` when somebody left a
-- workspace. The membership row outlived the departure, so every roster kept
-- rendering the departed member and every read path kept counting them. One of
-- those counts is a BEHAVIOUR, not a label: the desktop's `classify` fires its
-- implicit trigger only on a known-exact `memberCount === 2` (ENGINEERING §8,
-- N-PARTY SEMANTICS). A single ghost row turns a live 1:1 room into a "3-party"
-- room and SILENTLY DISABLES the trigger for the two people still in it — an
-- unaddressed ask in that room now wakes nobody, with no error anywhere. That
-- is the user-visible damage this backfill repairs, and it is why the sweep is
-- a delete rather than a read-side filter (Samuel, 2026-08-10: "fully and
-- cleanly removed").
--
-- The go-forward path is `channels/server/service-workspace-departure.ts`,
-- called from `workspaces/server/membership-admin.removeMember`. This file is
-- the same rule expressed as SQL, for rows that departed before that wiring
-- existed — and it doubles as the repair path if that best-effort call ever
-- logs a failure. It is IDEMPOTENT: a second run matches nothing.
--
-- "NO LONGER AN ACTIVE MEMBER" IS A MISSING ROW, and the app agrees. Nothing in
-- the codebase ever writes `workspace_members.status` to anything but 'active'
-- (every add path upserts it; the only exits are the DELETE in `removeMember`
-- and the `auth.users` cascade behind account deletion). The predicate below
-- still spells out `status = 'active'` rather than relying on that, so a future
-- soft-deactivation cannot quietly turn this migration into a no-op.
--
-- ── THE DM RULE, APPLIED THE SAME WAY THE SERVICE APPLIES IT ────────────────
--
-- A direct channel whose peer has left must ALSO be closed, not just emptied of
-- one row. Deleting the leaver's membership on its own leaves a one-member DM,
-- and this codebase renders that badly in two places at once: `buildDirectPeers`
-- resolves the peer as `ids.find(id => id !== self) ?? ids[0]`, so the survivor
-- sees the conversation under THEIR OWN name and avatar; and `resolveDirectPeer`
-- requires exactly two members, so the survivor's next post is auto-addressed to
-- nobody and (at memberCount 1) triggers nobody. A DM with one member is a
-- broken object here, not a smaller one.
--
-- So step 1 stamps `channels.deleted_at` on those pairs FIRST. On a direct
-- channel that stamp is not a trash — it is the CLOSE half of close/reopen
-- (ENGINEERING §7), the exit either side already has unilaterally. The
-- transcript survives: if the departed user ever rejoins the workspace, either
-- side's next open finds the hidden row (`findDirectChannelAnyStatus`), revives
-- it and re-asserts both member rows, history intact. NOTHING HERE HARD-DELETES
-- A DM, and nothing may: §7 forbids it, and one member's departure must never
-- vaporize a shared transcript.
--
-- Order matters for the same reason it matters in the service: close first,
-- delete second. Interrupted between them, the pair is hidden with its roster
-- intact — inert and self-healing. The other order leaves precisely the
-- one-member DM this rule exists to prevent.
--
-- NON-DM CHANNELS ARE NOT TOUCHED beyond the member row. A group channel simply
-- has one fewer member, which is the correct outcome.
--
-- OUT OF SCOPE, DELIBERATELY: `channel_tasks`. Open threads created by or
-- addressed to a departed member are left alone — addressing already fails
-- closed on the write path and the survivor keeps `closeTask`. That half of
-- C-20 stays open.
--
-- ── VERIFICATION (run BEFORE applying; both should be re-run after) ─────────
--
--   -- (a) The member rows this migration will delete, by channel kind:
--   SELECT c.is_direct, count(*) AS rows_to_delete
--   FROM channel_members cm
--   JOIN channels c ON c.id = cm.channel_id
--   WHERE NOT EXISTS (
--           SELECT 1 FROM workspace_members wm
--           WHERE wm.workspace_id = cm.workspace_id
--             AND wm.user_id      = cm.user_id
--             AND wm.status       = 'active')
--   GROUP BY c.is_direct;
--
--   -- (b) The live DMs this migration will close:
--   SELECT count(*) AS dms_to_close
--   FROM channels c
--   WHERE c.is_direct AND c.deleted_at IS NULL
--     AND EXISTS (
--           SELECT 1 FROM channel_members cm
--           WHERE cm.channel_id = c.id
--             AND NOT EXISTS (
--                   SELECT 1 FROM workspace_members wm
--                   WHERE wm.workspace_id = cm.workspace_id
--                     AND wm.user_id      = cm.user_id
--                     AND wm.status       = 'active'));
--
--   -- (c) After applying, (a) and (b) must both return zero rows / 0.
--   -- (d) And no live channel may be left with a member who is not an active
--   --     workspace member — the invariant, stated directly:
--   SELECT count(*) AS violations
--   FROM channel_members cm
--   WHERE NOT EXISTS (
--           SELECT 1 FROM workspace_members wm
--           WHERE wm.workspace_id = cm.workspace_id
--             AND wm.user_id      = cm.user_id
--             AND wm.status       = 'active');
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
-- THE MEMBER-ROW DELETE IS NOT REVERSIBLE BY A DOWN MIGRATION and no attempt is
-- made to write one: the rows carry `role`, `last_read_at`, `added_by` and
-- `joined_at`, which are gone once deleted, and re-inserting them would restore
-- the exact ghost this migration exists to remove. Take a backup of
-- `channel_members` first if the environment warrants it:
--
--   CREATE TABLE channel_members_departed_backup_20260810 AS
--   SELECT cm.* FROM channel_members cm
--   WHERE NOT EXISTS (
--           SELECT 1 FROM workspace_members wm
--           WHERE wm.workspace_id = cm.workspace_id
--             AND wm.user_id      = cm.user_id
--             AND wm.status       = 'active');
--
-- THE DM CLOSE IS FULLY REVERSIBLE, and reversing it is a one-liner — clear
-- the stamp on the pairs this migration closed (they are the direct channels
-- whose `deleted_at` equals this run's timestamp):
--
--   UPDATE channels SET deleted_at = NULL
--   WHERE is_direct AND deleted_at = '<the timestamp observed after apply>';
--
-- Reversing the close WITHOUT restoring the member rows re-creates the
-- one-member DM. Reverse both or neither.

BEGIN;

-- 1. Close every LIVE direct channel that has a departed member on either side.
--    `deleted_at IS NULL` keeps an already-closed pair's original close time.
UPDATE channels c
SET deleted_at = now()
WHERE c.is_direct
  AND c.deleted_at IS NULL
  AND EXISTS (
        SELECT 1
        FROM channel_members cm
        WHERE cm.channel_id = c.id
          AND NOT EXISTS (
                SELECT 1
                FROM workspace_members wm
                WHERE wm.workspace_id = cm.workspace_id
                  AND wm.user_id      = cm.user_id
                  AND wm.status       = 'active'));

-- 2. Delete the departed members' rows everywhere — DMs and group channels
--    alike. `channel_members.workspace_id` is denormalized (it backs the RLS
--    fence and the Realtime filter), so this needs no join back to `channels`.
DELETE FROM channel_members cm
WHERE NOT EXISTS (
        SELECT 1
        FROM workspace_members wm
        WHERE wm.workspace_id = cm.workspace_id
          AND wm.user_id      = cm.user_id
          AND wm.status       = 'active');

COMMIT;
