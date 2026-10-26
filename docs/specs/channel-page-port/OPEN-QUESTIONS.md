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

## Phase 2 shell (branch `ui/port-shell`)

1. **The 1px line is kit-wide.** `.page-float` (both kit copies) and the account palette skin went
   to the 1px hairline, so the workspace shell's panel and the other `.page-float` mounts thin too
   (a /home change that bleeds, per R12). The workspace shell's routed card
   (`app-shell.module.css › .pageCard`) still says 2px: changing it is workspace-only work, so it
   was left and `frame-palette.test.ts` pins it as is. Needs Samuel's call on R-38 parity.
2. **Profile pill's accessible name** is the visible first name; `title="Profile"`. With no
   display name it reads "Profile" over an `IdentityFace` "?" fallback. The page now gates on
   `GET /api/user/profile` (failure falls back, never errors the page) so the pill paints whole.
3. **Row details taken from staging over older rulings:** a solo channel's description is no
   longer italic (2026-09-15 ruling; staging has none); a pending link's name dims by opacity 60%
   instead of `text-text-secondary`; the selected name is semibold.
4. **Heading-to-first-row gap is 8px (staging 6px)** because the `"heading"` well keeps the shared
   collapse's 8px top bleed (`collapse-wells.tsx › WELL_FACES`); rows are 6px apart as staged.
5. **New channel is its own flat ink face (`.raise-ink`), not `PAGE_ACTION_BTN`.** The 3D page
   pill is worn by the section create buttons on the other four faces and the channel page, which
   this slice does not restyle. Collapse the two when those faces move.
6. **The landing demo still draws its own header and column** (`demo-home-faces.tsx`,
   `.lp-demo-top*` / `.lp-demo-sw*`), now the same look as the product: two implementations until
   R2's demo swap cleanup (Phase 5). The dead product-faithful `DemoHomeHeader` / `DemoChannelList`
   were deleted here. `HomeChannelRow` has no renderer outside the SPA now; it stays in
   `src/shared/ui` because the demo authors its rows as `HomeChannelRowFacts`.
7. **`--channel-divider-w` has no declarer any more**: every divider is the kit hairline, so
   `split-resize-handle.tsx`'s strip always takes its 1px fallback. The variable and
   `info-resize-handle.tsx`'s re-export can retire with the info-column slice (channels tree).
8. **Stale pointer left in the channels tree:** `channels/components/use-info-resize.ts` names
   `frame-palette.test.ts` as the `--info-w` pin; those cases moved to
   `apps/desktop-ui/src/components/app-shell/info-column.test.ts` (the 500-line split). Not edited:
   the rename worker owns that tree today.
9. **Search stays an always-open input** (staging's pill is a button that swaps in a field): it
   lifts on hover and holds still while focused (`.raise-pill:focus-within`).
10. **Worktree environment:** the main checkout's `packages/contracts` carries another worker's
    in-flight edits, and a whole-directory `node_modules` symlink resolves `@dopl/contracts` there
    (the SPA typecheck then fails on `task_*` kinds in untouched files). This worktree's
    `node_modules` is per-entry links with `@dopl/*` pointing at its own packages.
11. **Pre-existing red, unchanged:** `src/shared/ui/clickable-cursor.test.ts` still flags
    `ontology-staging/ontology/components/kanban-column-header.tsx` (Phase 1 item 9).
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
- Applied `channel_tasks` (history 20261026111318, md5 9fa479ac472602ecc05360e47ab5a1e2) and `channel_sessions_runtime` (20261026111323, md5 ed33512e1bb161bb8ba3e9c40ab33bc9) to production; both match their files.
- ⚠ History now holds TWO rows named `channel_tasks`: 20260727150000 (the original thread table, now `channel_threads`) and 20261026111318 (the new tasks feature). Locally the files are `20260727150000_channel_tasks.sql` and `20261121190000_channel_tasks.sql`. Anything that joins history on NAME must also match the md5. Left as is (applied files are never renamed).
- `src/shared/supabase/types.ts` was merged in place by workers; regenerate from production (`--linked`) now that all three migrations are live.

## Phase 3.1 transcript + composer (branch `ui/port-transcript`)

1. **No status dot in the thread card's header.** Staging drew `thread.status` ("Open"), but
   `ThreadStatus` is legacy and unread (`@dopl/contracts › channels.ts`: "nothing may branch on
   it"; INVARIANTS §5, threads do not close). Chose: no header status; liveness lives on the agent
   rows and the "N running" count. `channels/components/thread-card-row.tsx`.
2. **No runtime badge on the thread card's agent rows.** There is no product runtime → logo map,
   the desktop SPA serves no `/img/onboarding/*` assets, and peers carry no runtime (R9). Chose:
   `IdentityFace` with the agent-colour ring (neutral without one) and no badge.
   `channels/components/thread-card-agents.ts`.
3. **Agents compartment when the own feed is unknown.** A plain browser has no own feed
   (`sessions: null`): with no peer on the thread the card draws no compartment (unknown is not
   empty, INVARIANTS §11); with known feeds and nobody on it, "No agents yet". The pop-out thread
   window passes no feeds (thread view has no cards).
4. **"Opened by" for an agent** reads "Opened by your agent" / "Opened by Diana's agent", off the
   opening message's `authorKind` (new `ThreadCardRow.agent`); it does not name the agent.
5. **One choice face.** The decision face (letter badges + strip) and the inline face (labelled
   buttons) are both replaced by option rows, so a bare choice and a legacy decision draw the same
   rows; `isDecisionFace` is deleted. A row button's accessible name is its label, its consequence
   is `aria-describedby`. Non-choice displays wear the same content-width tag, in the same paint,
   reading "Display". `display-choice.tsx`, `escalation-card-face.ts`.
6. **Pane avatar sizes, taken literally from staging's override:** a PERSON's message pill is now
   36px (`Avatar px36`) while an AGENT's badge photo is 32px (`IdentityFace`), and the agent's name
   is `text-lead` against a person's `text-body`. Staging rendered exactly this; flag if the two
   pills should match. Roster + thread parties `px36`, peer activity + the agent stream's viewer
   `px30`. Threads-tab and creator avatars carry their own size override and were left; Agents-tab
   card avatars are slice 2's face.
7. **The send button changed for both composers.** `SendButton` is one shared face, so the agent
   bar's send is round now too (the demo's agent-view send CSS that faked it is deleted). The
   workspace channels skeleton's send ghost (`apps/desktop-ui/src/pages/channels/
   channels-skeleton.tsx`) was re-rounded to keep its pin true: a bleed, not workspace work.
8. **Working chips** are full 18px pills in the agent colour; the cycling dots still sit right
   after the name with no gap (the 2026-10-10 ruling), not the demo chip's 5px gap.
9. **Composer card radius is 20px** (the demo's), on `.white-card` with the hairline inside
   `px-3 py-2.5`, so the content box and height are unchanged.
10. **The staged decision post stays** (`channels-staging/data/decision-fixture.ts`): it is the
    page's only decision example. The scene answers it with an in-memory `async () => true`, so a
    press shows the chosen row; "You chose" needs a stored answer and does not appear.
11. **`cn` did not know `text-heading`** (Phase 1 added the step, not the merge group), so
    `cn("text-heading", "text-text-primary")` would drop the size. Added to
    `shared/lib/utils.ts`.
12. **Not split:** `composer-recipients.test.tsx` and `composer-launch.test.tsx` (500 lines each)
    are untouched by this slice and not over the cap; splitting would duplicate their mock setup.
    `transcript.test.tsx` was split (fan-out → `thread-card-fanout.test.tsx`).
13. **Still swapped in the landing demo** (later slices): `DemoAgentCards`, `DemoAgentStateRows`,
    `DemoAgentViewFaces`, `DemoStreamBoxes`, and the demo agent-view composer's pill rule.
14. **Pre-existing, unchanged:** `src/shared/ui/clickable-cursor.test.ts` red on
    `ontology-staging/.../kanban-column-header.tsx`; `check-doc-refs` asks for
    `docs/ENGINEERING.md::task-panel.tsx` to leave its baseline (not this slice's file).
