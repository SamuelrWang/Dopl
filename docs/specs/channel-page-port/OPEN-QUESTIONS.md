# Open questions (overnight run 2026-10-26)

Workers append a `## <slice>` section per question: the question, what was chosen, where.

## Phase 1 UI primitives (branch `ui/port-primitives`)

1. **Moving `PairedAvatar` whole would break the landing demo.** Its raised frame needs
   onboarding's `web-pieces.tsx › Profile`, and `banner-demo/*` (off limits this phase) calls
   `thinFrame`. Chose: the thin recipe moved to `src/shared/ui/identity-face.tsx › IdentityFace`;
   `onboarding/components/paired-avatar.tsx › PairedAvatar` keeps its props and renders
   `thinFrame` through `IdentityFace`, and keeps the raised onboarding frame. Onboarding importers
   needed no change. Retire `PairedAvatar thinFrame` with the banner-demo swaps (R2).
2. **`channels-staging/data/staging-agents.ts › stagingIdentityFace` builds face DATA (photo,
   colour, logo), not markup.** Kept as the staging data source; every renderer of it is now
   `IdentityFace`.
3. **Which badge shadow is the recipe?** Staging `TaskFace` used the bevel only; `PairedAvatar`
   and the identities fork used bevel + two drops. Chose the latter as the token
   `--raised-light-drop` (globals + tokens.css), read by `IdentityFace` and onboarding's `Face`.
   The tasks faces' badges gain that soft drop.
4. **Which status pill is THE pill?** Three faces exist: the tasks word pill, the demo agent card's
   `.lp-demo-ac-status` (2px pad, weight 500, dot) and identities-staging's white-on-hairline
   `StatusPill`. Chose the tasks geometry for `.status-pill` with an optional dot; the other two are
   not swapped (not a direct swap). Needs Samuel's pick before Phase 3 restyles agent cards.
5. **`CARD_BUTTON` lives in `channels/components/bits.tsx`** (the channels tree is the rename
   worker's this phase). Not touched; DESIGN-SYSTEM's `PILL_BUTTON` row names the family and
   leaves `CARD_BUTTON` for the channel page restyle.
6. **`AvatarStack` vs the identity stack.** Product `AvatarStack` callers (relationship list etc.)
   must not change look this phase, so `IdentityStack` was added beside it in `avatar-stack.tsx`.
   Collapse them when the product callers are restyled.
7. **Visual deltas accepted (all small, all toward the shared recipe):** settings cards
   `#ffffff` + 6/16/.04 shadow → `.white-card` (`#fefefe`, `--shadow-bento`); Add members
   initial circle and "Member" pill → `IdentityFace` / `StatusPill` (raised hairline, `--bg-inset`,
   `text-micro`); the quick view's "All tasks resolved" gains the check icon its tab twin has;
   outlined pills `#ffffff` → `--bg-overlay`; an agent with no colour key rings `neutral` instead of
   `agent-01`; an identities run with no runtime keeps its agent-colour ring (was grey);
   `PairedAvatar thinFrame` without a logo draws no badge (was a grey block).
8. **13px was already a token** (`--text-lead`); the staging literals now read it. 15px was missing
   and is `--text-heading` (both token files, DESIGN-SYSTEM type table).
9. **Pre-existing red, not this slice:** `src/shared/ui/clickable-cursor.test.ts` flags
   `ontology-staging/ontology/components/kanban-column-header.tsx` (untouched here).
   `identities-staging/page/identity-activity-panel.test.ts › scopes every rule to .uis-window` was
   red on master (unscoped `.uis-tk-idface*` and `.uis-st-people*` rules); green now, since both
   rule sets were deleted for the shared primitives.
## Rename (task → thread), branch `refactor/thread-rename`

- **Migration stamp.** `20261121180000_rename_task_to_thread.sql`: after the newest applied file and
  before the held `20261122120000` (the house rule keeps that held file last). Chose this; the new
  tasks migration must sort after it.
- **The held per-channel-numbering file reads `metadata ->> 'threadId'` now.** Its body depends on the
  rename, which sorts before it, so no re-stamp. Edited in `supabase/migrations-held/`.
- **Legacy synthetic ids.** `task-<channel>-<seq>` became `thread-<channel>-<seq>` in code, and the
  migration rewrites stored ones (`metadata.threadId`, `metadata.cites[].thread`) plus the
  `task-open-<id>` opening keys. `mcp_events.arguments` (an audit log) is NOT rewritten.
- **Desktop electron-store.** Session records, the resume map and grant state written by an older
  build carry `taskId` / `allowForTask`; the new build reads `threadId` / `allowForThread` and has no
  shim, so a pre-upgrade session loses its thread binding once. Accepted under the no-alias ruling.
- **`src/shared/supabase/types.ts`** is generated from PRODUCTION, which is not migrated yet, so the
  rename was applied in place (and `channel_tasks_stale` removed) rather than regenerated from the
  local stack, whose unrelated columns differ. The renamed tables match a local `gen types` exactly.
  Regenerate with `--linked` after the orchestrator applies the migration.
- **Floor.** `DEFAULT_MIN_VERSION` and `DEFAULT_DECLARED_LATEST` are `1.43.0`;
  `dopl-desktop-app/package.json` is untouched (the release bumps it). The clamp keeps the floor
  inert until 1.43.0 is on the feed, except when the feed is unreachable on a cold start.
- **Dropped, not renamed:** `channel_tasks_stale` (no caller since 2026-08-18; F-207 resolved).
- **Kept as `task`:** English uses (an agent's job, harness background tasks, event-loop
  (micro)tasks, work-ticket numbers like "task 11"), the Claude CLI's `Task*` tool names, Cursor's
  `task` event type, the desktop prompt tests' guards against the removed `task=` argument, and
  applied migration filenames.
- **Live redteam locally.** Supabase CLI 2.75's GoTrue trusts only its ES256 key, so the HS256
  service-role key from `supabase status` is refused; the run used an ES256 service-role JWT minted
  from the local auth container's own key (100/100 passed). CI pins CLI 2.116 and is unaffected.

## Orchestrator: production migrations
- Applied `rename_task_to_thread` to production 2026-10-26 (history version 20261026103134, statements md5 c63d4e13fd0e302d23eca782d7c8b763 = file). Pre-check: every task-named prod object was covered by the migration.
- NOT applied, not part of this port: `20261121170000_workspace_billing_plan_max.sql` is absent from production history and prod `workspace_billing_plan_check` has no `max`. Left for you.
- `drop_channels_archived_at` has no recorded prod row; its file only carries the drop as a comment, prod still has `channels.archived_at`. Left as is.

## Tasks backend (S1–S3), branch `feat/tasks-backend`

1. **An agent credential assigning a PEER's agent.** The R7 wake goes through `postMessage`, whose `to=`
   carve lets an agent address only its own operator's agents, so the post would 400. Chose: refuse the
   assignment (`ChannelForbiddenError`, `server/service-tasks-assign.ts › assertAssignable`). A person may
   assign anyone's agent. Alternative if wanted: assign without the wake.
2. **Which agents can be named as assignee or subtask owner.** Chose: an agent with a `channel_sessions`
   row in this channel; its operator is read off that row (`service-tasks-shared.ts › resolveTaskActor`).
   Unassign matches the agent id alone, so an ended agent can still be taken off.
3. **The wake post.** Body `Task assigned to you: <title>`, main room even when the task is linked to a
   thread, idempotency key `task-<taskId>-assign-<assigneeRowId>` (a re-assign after an unassign wakes
   again). No post for a person, for an agent assigning itself, or for an existing assignment.
4. **Subtask states do not move the task status.** Chose: none of that automation; status moves only by
   `set_status`.
5. **A guest assignee cannot resolve its own task** (R8: guests read and add notes only). Kept as ruled.
6. **Publication ahead of its subscriber.** `channel_tasks` is published by the migration, so
   `dopl-desktop-app/test/ui-sync-tables.test.mjs › nothing is published that no consumer binds` is red
   on this branch until slice S5 adds it to `main/ui-sync-core.js › SYNC_TABLES` (and the UI slice adds it
   to `channels/constants.ts › CHANNEL_TABLES` with a `live.ts` arm; `guest-realtime-rls.test.ts` then
   checks its guest arm, which the migration already has). They must ship in one release (INVARIANTS §7).
7. **`channel_sessions.runtime` has no column GRANT** — peer-visible through the DTO only, the `color`
   precedent; PostgREST cannot read it. The desktop push that fills it is S5; the MCP render is S4.
8. **Contracts now hold DTOs** (`packages/contracts/src/tasks.ts`), because both trees would otherwise
   declare the same shapes. The index header says so.
9. **The census** (`src/shared/contracts/canonical-sets.test.ts`) leaves out `TaskStatus`,
   `SubtaskState`, `TaskActor` and `TaskLink` while `features/channels-staging` declares fakes of them.
   Add them when staging retires.
10. **`src/shared/supabase/types.ts`** was merged in place from a local `gen types` (production lacks both
    migrations). Regenerate with `--linked` after the orchestrator applies them.
11. **List order** is `updated_at` descending, unfiltered or by `?status=`; any grouping is the UI's.
12. **Local live redteam** needed the rename worker's ES256 service-role JWT (CLI 2.75); 8 files, 111
    tests green including the new `channels/server/rls-redteam-tasks.test.ts`.
