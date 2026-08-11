# Retirement Unwiring Plan — Canvas, Workflows, Configuration

**Date:** 2026-08-07 · **Goal:** hide these three features from users and agents for launch — code stays in the repo, user-facing wiring goes. Produced by a read-only Opus audit against master `0a3b007`. Companion doc: [LAUNCH-READINESS-ROADMAP.md](LAUNCH-READINESS-ROADMAP.md).

---

## ✅ STATUS — PHASES 1–7 EXECUTED (2026-08-07)

**All seven phases below are implemented and are COMMITTED on `master`** (this said "sit UNCOMMITTED in the `master` working tree" until 2026-08-11; verified with `git status --short` — the tree is clean of them, they shipped in the 2026-08-07/08 launch wave). Deploy state is a measurement: re-check rather than trust this clause. Canvas, workflows and configuration are unreachable by a user and invisible to an agent; deletes are permanent app-wide. The durable statement of record is [ENGINEERING.md](ENGINEERING.md) §7 — *"Canvas, Workflows & Configuration — RETIRED FROM EVERY SURFACE"* and *"DELETES ARE PERMANENT"* — not this plan. Read that first; this file is the *why* and the audit trail.

| Phase | Shipped |
|---|---|
| **1 — Nav + landing** | 5 route rows out of `WORKSPACE_PAGES`; 3 nav rows + their `NavSection` members out of `app-sidebar-core.tsx`; `WORKSPACE_HOME_PATH` → `"overview"` (D4); `deep-link-target.js` page table + `WORKSPACE_HOME_PAGE` moved in lockstep; Overview "Workflows" stat card removed. Page components remain on disk, unreferenced. |
| **2 — In-app copy + tour** | Tour steps 2/3 + finish copy; welcome popup; workspace-name step; create-workspace dialog; members role/invite copy and the "Workflow access" section (D7); marketing panel 05; `join-link-card` repoint. |
| **3 — Agent surface** | `HIDDEN_TOOLS` guard in `packages/mcp-server/src/server.ts` unregisters `dopl_workflow` / `dopl_workflow_admin` / `dopl_cluster` / `dopl_cluster_admin` (D1/D2) → **14 tools in `tools/list`**; `buildInstructions` rewritten; `dopl_map` 5→3 domains, `dopl_search` 4→3 groups; `skill-template.ts` "Following a workflow" section gone; `members.ts` workflow-row filter; `tool-profiles.js` `DOPL_SAFE_TOOLS` 11→9 with the two retired admins moved to `RETIRED_DOPL_TOOLS` (**still hard-denied** — a name off a deny list becomes *unclassified*, which resolves to `gate`). `dist/` rebuilt. New suite: `packages/mcp-server/src/retirement.test.ts`. |
| **4 — Seeds + onboarding** | "Workspace upkeep" workflow, `walk-a-workflow` skill, workflow-teaching Dopl Guide KB entries and the `bootstrap-prompt.ts` WORKFLOW rubric all removed; seed order is now KB → skills → ontology → chat. Ontology/knowledge/skills seeds untouched (D5). |
| **5 — Realtime / DB load** | `useWorkflowsRealtime` is an inert stub (the `WORKFLOW_TABLES` literal is **gone, not emptied** — `ui-sync-tables.test.mjs` regexes for it); `ui-sync.js` `SYNC_TABLES` 22 → 17 bindings; paired with migration `20260807100000` (D8, R4). |
| **6 — Soft-delete removal (§2b)** | `features/trash/` deleted whole, with the skills trash modal, every `listTrashed*`/`restore*`/`purge*` service fn, the trash/restore API routes and the `purge-trash` cron + its `vercel.json` entry. All deletes are hard deletes behind a confirm dialog. **MCP deletes blocked entirely** at one choke point (`DELETE_BLOCKED_OPS` + the fail-closed `DELETE_OP_SHAPE`, one `DELETE_REFUSAL` string). `/api/workflows/**` deliberately left soft-deleting (D3 — retired surface, don't half-migrate). |
| **7 — Docs** | This block; ENGINEERING.md §7 rewritten + stale canvas/workflow/cluster references marked retired throughout; RETIRED banners on `WORKFLOW-BUILDER-PLAN.md` and `WORKFLOW-PIVOT-HANDOFF.md`; `LAUNCH-READINESS-ROADMAP.md` scope note updated. `MULTIPLAYER-PLAN.md` needed nothing (zero workflow references). Root `CLAUDE.md` / `README.md` / `CONTRIBUTING.md` re-verified clean. |

### ✅ Migrations — ALL APPLIED (measured 2026-08-11)

**This heading read "⚠️ Migrations WRITTEN but NOT APPLIED" until 2026-08-11, and the third row carried a 🚨 MUST BE APPLIED BEFORE DEPLOY flag. Both were false by then.** Measured against production on **2026-08-11** with `supabase migration list --linked`: **157 local migration files = 157 remote history rows, zero drift.** All four migrations named below — the three in the table and the `20260807000000` straggler under it — are in the remote history, along with everything through the 2026-08-10 security wave. The apply-gate column is kept as the **record of why each one was sequenced the way it was**; it is no longer an instruction.

**Do not trust this paragraph either.** Deploy state is a MEASUREMENT and it expires the moment someone writes a migration — it has no diff, nothing in this repo observes it, and this exact sentence has now been wrong in this file once and in [LAUNCH-READINESS-ROADMAP.md](LAUNCH-READINESS-ROADMAP.md) twice. **Run `supabase migration list --linked` before reasoning about what is applied**, and re-date this line when you do.

| Migration | Effect | Apply gate (HISTORICAL — all applied 2026-08-11) |
|---|---|---|
| `20260807100000_drop_workflow_tables_from_realtime.sql` | Drops the 5 `workflow_*` tables from `supabase_realtime`. Reversible via `ADD TABLE`; what is not recoverable is events occurring while unpublished. | **Ship in the SAME release as the Phase 5 client change (R4).** Applying it early is safe (nothing subscribes); shipping the client change without it only wastes WAL decode. |
| `20260807110000_purge_soft_deleted_rows.sql` | One-time idempotent sweep of the tombstones `purge-trash` would have aged out. `channels` deliberately excluded — `channels.deleted_at` is the DM close/reopen mechanic, not a trash. | Not release-blocking. Until it runs, the surviving `deleted_at IS NULL` read filters are what keep pre-switch tombstones hidden — **do not drop those filters first.** |
| `20260807120000_ontology_cluster_hard_delete_rpc.sql` | Creates `cascade_hard_delete_cluster(UUID, UUID)`. | ✅ **APPLIED** (was flagged 🚨 MUST BE APPLIED BEFORE DEPLOY). `ontology/server/repository.ts` › `cascadeHardDeleteCluster` calls this RPC by name; shipping the code without the function would have made **every ontology cluster delete fail at the DB.** |

Also from the pre-retirement audit and **likewise applied** (this line said "still unapplied" until 2026-08-11): `20260807000000_drop_unbound_tables_from_realtime.sql` (`channel_agents`, `clusters` — written by `0a3b007`, see §0). Same R4 pairing rule, same measurement above.

---

## 0. Framing correction — what git history does NOT cover

The `retirement:` commits on master (`431ab28`, `2ea0126`, `aaa6f9c`, `9f7edfb`) are the **website retirement** (desktop-only migration), not this feature retirement. They deleted the *web copies* of canvas/workflows/configuration pages and the remote-shell loader; the **live desktop SPA copies are untouched**. The web-tree half is done and its redirect map (`src/shared/lib/url/website-retirement.ts` — retired URLs → 302 `/get-started`, billing carve-out intact) should be **left alone** (pinned by `src/proxy-retirement*.test.ts`, and it must keep answering for in-the-wild bookmarks).

Commit `0a3b007` also matters here: it audited realtime-published tables, wrote (did **not** apply) `supabase/migrations/20260807000000_drop_unbound_tables_from_realtime.sql`, and armed `dopl-desktop-app/test/ui-sync-tables.test.mjs` to fail on published-but-unsubscribed drift → see Risk R4.

## Key structural facts

- **Canvas is not its own feature.** `apps/desktop-ui/src/pages/canvas/index.tsx:31-44` renders `GraphView` — a second view of **ontology**. Hiding it costs one view, not data. Ontology page unaffected.
- **Configuration is 100% inert.** Zero API/fetch/supabase calls; fully mock-driven (`src/features/configuration/mock-data.ts`). Cheapest, safest hide. Zero MCP presence.
- **The MCP server reaches `/api/workflows/*` and `/api/clusters/*` over loopback HTTP** (`src/app/api/mcp/route.ts:112` → `DoplClient` → real fetches). Gating those routes kills the agent tools. **Hide at the tool registrar, not the route.**
- **The app's home page IS canvas.** `WORKSPACE_HOME_PATH = "canvas"` (`apps/desktop-ui/src/routes.tsx:69`) with **6 entry points** funneling through it (index redirect, boot, workspace switch, workspace create, ⌘⇧H menu, auth change). Miss the repoint → app boots into a 404.
- **The sidebar nav is NOT in `apps/desktop-ui`.** It lives in shared `src/shared/layout/app-shell/app-sidebar-core.tsx:41-52`. Editing `routes.tsx` alone leaves three nav rows pointing at "Not found."
- Two unrelated "cluster" concepts exist: **workflow clusters** (`dopl_cluster`, table `clusters`, pure workflow containers) and **ontology clusters** (`dopl_ontology` board — zero workflow coupling). Only the former is affected.

---

## 1. Surface map

### Desktop SPA
| Surface | Location | Action |
|---|---|---|
| Sidebar NAV rows (Canvas :44, Workflows :45, Configuration :50) | `src/shared/layout/app-shell/app-sidebar-core.tsx:41-52` | Remove 3 rows; also `NavSection` union `:25-35`, `activeSectionFromPath` default `:68` → `"overview"` |
| Route table (5 rows: canvas, canvas2, workflows, workflows/:slug, configuration) | `apps/desktop-ui/src/routes.tsx:51-65` | Delete rows; `routes.test.tsx:96-110` pins the path list |
| `WORKSPACE_HOME_PATH = "canvas"` | `routes.tsx:69` | → `"overview"` (see D4) |
| Deep-link page table (hand copy of routes) | `dopl-desktop-app/main/deep-link-target.js:48,60-73,88-101,186-192` | Update **in the same commit** — `test/deep-link-target.test.mjs:13-15` reads `routes.tsx` at runtime and fails on drift |
| Overview "Workflows" stat card | `src/features/workspaces/components/overview-stats-core.tsx:29-33`, rendered `pages/overview/index.tsx:112-119` | Remove card + test |
| Product tour steps 2 (Canvas) + 3 (Workflows) — step 2 **navigates** to /canvas | `src/features/tour/tour-steps.ts:26-35`, finish copy `:70` | Remove steps; tour engine would navigate to "Not found" if left |
| No command palette / hotkeys exist | — | Nothing to do |

### Web app
| Surface | Location | Action |
|---|---|---|
| Marketing landing panel 05 "Workflows" | `src/features/marketing/constants.ts:100-106` | Remove panel |
| `join-link-card.tsx:48,54` pushes to `/canvas` | — | Repoint (already broken today — pushes to retired URL) |
| Retirement redirect map, proxy defaults, billing carve-out | `website-retirement.ts`, `proxy.ts:119` | **Leave alone** |
| Pricing / get-started / landing copy | — | Already clean |

### MCP / agent surface (registry: `packages/mcp-server`, NOT `src/features/mcp-connect`; **rebuild `packages/mcp-server/dist` after edits**)
| Surface | Location | Action |
|---|---|---|
| Tool registrations | `server.ts:951-965` (`registerClusterTools` :951, `registerWorkflowTools` :952) | Hide via the existing choke point: copy `READ_ONLY_BLOCKED_TOOLS` pattern (`server.ts:435-442` + `:695`) → `if (HIDDEN_TOOLS.has(name)) return;` — tool never registers, invisible in `tools/list` |
| Server instructions (every agent sees) | `server.ts:127,131,139,151` ("what's on my canvas?"), `:162-167` (6 of 12 decision-tree bullets are workflow/cluster) | Rewrite `buildInstructions` |
| `dopl_map` Workflows section | `packages/mcp-server/src/tools/map.ts:138-145`; `DOMAIN_COUNT = 5` at `:59`, fan-out `:113-119`, description `:56` | Remove section; 5→3 if clusters go too |
| `dopl_search` workflow group | `search.ts:101-104,136-144`; "FOUR domains" `:33`; `reads.notice(4, "groups")` `:169` | Remove group; 4→3 |
| `dopl_cluster` / `_admin` | `cluster.ts` — every op/output line is workflow-speak incl. "Assign workflows to it from the canvas." `:216` | See D1 — recommend hide with workflows |
| `dopl_members` access matrix workflow rows | `members-render.ts:117-122`, `members.ts:315` | Filter rows (rows come from backend payload — hiding the tool does not remove them) — see D7 |
| Generated skill template (the SKILL.md users install) | `src/features/mcp-connect/skill-template.ts:17,27-28,36,43-49`, entire `:60-76` "## Following a workflow" section | Rewrite in lockstep with instructions (its docblock `:9-12` requires it) |
| Incidental descriptions | `tools/knowledge.ts:63,106`; `tools/skills.ts:37,87`; `prompts/skill-authoring-guide.ts:27` | Copy-edit (leave the guide's generic-English "workflow" uses alone) |
| Desktop tool allowlists passed to spawned Claude sessions | `dopl-desktop-app/main/tool-profiles.js:104-128,167-171` | Edit lists; 4 test files assert them |
| Configuration | — | **Zero MCP presence — no work** |

### API routes — leave functional
`/api/workflows/**` (9 routes) + `/api/clusters/**` — all `withWorkspaceAuth` + `minRole:"member"` (security-verified). Loopback consequence above: **do not gate**. If D2 = hide tools, they become unreachable in practice anyway. No canvas/configuration API routes exist.

### Data / realtime / cron
| Item | Note |
|---|---|
| Tables `workflows`, `workflow_steps`, `workflow_step_edges`, `workflow_knowledge_bases`, `workflow_skills`, `clusters` | **Keep data.** Nothing FK-references `workflows.id`; join tables point outward |
| Realtime bindings: 5 workflow tables | `src/features/workflows/client/realtime.ts:5-11` + `hooks/use-workflows.ts:178`; mirrored `dopl-desktop-app/main/ui-sync.js:71-72` | See Phase 5 + R4. Published tables cost WAL-decode + RLS eval on every write even with no subscribers (measured: `realtime.list_changes` 2.97M calls / 386min) |
| `purge-trash` cron includes `workflows` | **Keep** — MCP can still soft-delete; removing leaks tombstones |
| Analytics KPIs `first_cluster_built` → `conversion_signup_to_first_cluster_24h_pct` etc. | Quietly go to ~0/null if clusters hide — accept or swap metric |

### Onboarding & seeds
| Surface | Location |
|---|---|
| Seed orchestrator creates **1 workflow** ("Workspace upkeep", 5 steps) per new workspace | `src/features/workspaces/server/seed-workspace.ts:56-152` → `workflows/server/seed.ts:17,43-103` |
| Seeded `walk-a-workflow` skill teaches agents `dopl_workflow op=step` | `src/features/skills/server/seed.ts:132-145` |
| Dopl Guide KB teaches workflows throughout | `knowledge/server/seed.ts:57-200` |
| Bootstrap agent prompt teaches WORKFLOW as one of three primitives | `src/features/onboarding/bootstrap-prompt.ts:55,73,101` |
| Welcome popup "…and run workflows", workspace-name step, create-workspace dialog copy | `welcome-popup.tsx:139`, `workspace-name-step.tsx:32`, `create-workspace-dialog-core.tsx:88` |

### Residual copy naming hidden features
Role picker + invite dialog "…KBs, skills, canvas" (`member-bits.tsx:18`, `invite-dialog.tsx:39`) · team detail "Workflow access" section (`team-detail.tsx:276,73`) · members list "No knowledge bases or workflows yet." (`members-list-pane.tsx:219,371`) · conflict dialog naming a workflow (`conflict-dialog.tsx:43-46`) · **Trash "Workflows" filter tab** (`workspace-trash-section.tsx` — DELETED with the whole trash feature in Phase 6, so the line numbers this entry carried are unresolvable; see D6) · 409 `SKILL_ATTACHED_TO_WORKFLOWS` user-facing error (`skills/server/service-writes.ts:154-167`) · `layout-shell.tsx:19`.

### Docs that would mislead a future agent
`docs/ENGINEERING.md:324` (**highest risk — CLAUDE.md points every agent here**; currently dirty in the other session), `:217` · `docs/WORKFLOW-BUILDER-PLAN.md` · `docs/WORKFLOW-PIVOT-HANDOFF.md` · `docs/migration-research/web-pages.md` · `docs/REFACTOR-FINDINGS.md:208,216` (also dirty). Root `CLAUDE.md`/`README.md`/`CONTRIBUTING.md` clean.

---

## 2. Decisions — RESOLVED by Samuel, 2026-08-07

- **D1 — Clusters: HIDE with workflows.** `dopl_cluster` + `dopl_cluster_admin` go. (`first_cluster_built` KPI goes dead — accepted.)
- **D2 — MCP workflow tools: UNREGISTER** (disappear from `tools/list`; the `HIDDEN_TOOLS` guard beside `READ_ONLY_BLOCKED_TOOLS`).
- **D3 — API routes: NO GATE.** Leave functional; unreachable in practice once D2 lands.
- **D4 — Landing page: `overview`.**
- **D5 — Seeds: keep seeds for surviving pages (ontology, knowledge, skills); remove workflow-related seeding only.** Concretely: the "Workspace upkeep" workflow (`seed-workspace.ts:130-141` + `workflows/server/seed.ts`), the `walk-a-workflow` skill (`skills/server/seed.ts:132-145`), workflow-teaching Dopl Guide KB entries (`knowledge/server/seed.ts:163-200`), and the WORKFLOW rubric in `bootstrap-prompt.ts:55,73,101`. Everything else seeds as today.
- **D6 — superseded by a bigger call: KILL SOFT-DELETE ENTIRELY.** Samuel wants trash = permanent delete, with an "are you sure" confirm dialog on **every** destructive action app-wide. (The "Workflows" trash tab he couldn't find lived inside Settings → Trash, `workspace-trash-section.tsx` — it went away with the whole trash feature, and the file is deleted.) See §2b — this is a new workstream beyond retirement.
- **D7 — Teams: REMOVE `workflow` as a grantable resource type from UI + access-matrix output.** Existing grant rows stay valid in the DB (harmless); nothing renders them.
- **D8 — Realtime publication: YES, drop the 5 workflow tables.** Clarification vs. the earlier draft: this is **reversible** — `ALTER PUBLICATION supabase_realtime ADD TABLE workflows;` re-enables it any time if workflows return. What is NOT recoverable: events that occurred while unpublished (no replay/backfill), and the silent-failure gotcha that a client binding on an unpublished table reports SUBSCRIBED while delivering nothing — which is why the client-binding removal and the publication migration must ship together (R4).

### §2b — New workstream: soft-delete removal (Samuel, 2026-08-07)

Trash becomes permanent delete everywhere. Scope touches more than the retired pages:
- Every delete path gains a confirm dialog ("are you sure") — many already have `ConfirmDialog`; audit the ones that don't (agent-write toggle deletes, MCP admin ops have no dialog by nature).
- Retire the trash feature surfaces: Settings → Trash section (`workspace-trash-section.tsx`), skills trash modal (`skills-trash-modal.tsx`), `/api/workflows/trash`, restore endpoints, delete-toast Undo flows.
- `purge-trash` cron becomes obsolete (it doesn't run today anyway — `CRON_SECRET` unset); replace with a one-time migration hard-deleting existing tombstones.
- Server: `deleted_at` soft-delete columns/filters can stay in schema initially (hide first, simplify later) but all delete ops switch to hard delete.
- **MCP deletes: BLOCKED entirely (Samuel, 2026-08-07).** Agents cannot delete anything over MCP. Every delete-shaped op across the `_admin` tools (`dopl_kb_admin`, `dopl_skill_admin`, `dopl_chats_admin`, `dopl_ontology_admin`; `dopl_workflow_admin`/`dopl_cluster_admin` are unregistering anyway) returns a standard refusal telling the agent to have the user delete it in the Dopl app — e.g. `Deletion is app-only. Ask the user to delete this in the Dopl app (with confirmation) — agents cannot delete over MCP.` Implement at one choke point (an op-level deny-list beside the `HIDDEN_TOOLS` guard in `packages/mcp-server/src/server.ts`), not per-tool, so future tools inherit it. Also update tool descriptions so `tools/list` doesn't advertise delete ops it will refuse, and the skill-template/instructions text to match. With this, hard-delete becomes safe: the only delete paths left are in-app, and every one carries a confirm dialog.

## 3. Unwire order (each phase shippable)

All decision gates resolved (§2) — every phase is go. ✅ **All seven are now EXECUTED (2026-08-07, working tree) — see the STATUS block at the top for what actually shipped per phase and the three migrations still awaiting apply.** What follows is the original ordering rationale.

1. **Nav + landing** — sidebar rows, `NavSection`, route table, `WORKSPACE_HOME_PATH` → overview, `deep-link-target.js` same commit, overview stat card. Tests: `routes.test.tsx`, `pages/overview/index.test.tsx`, delete/skip the 3 page tests. *Result: unreachable in UI.*
2. **In-app copy + tour** — tour steps 2/3 + finish copy, welcome popup, workspace-name step, create-workspace dialog, members role/invite copy (incl. D7: drop "Workflow access" section + workflow chips), marketing panel 05, `join-link-card` repoint.
3. **Agent surface** — `HIDDEN_TOOLS` guard covering `dopl_workflow`, `dopl_workflow_admin`, `dopl_cluster`, `dopl_cluster_admin`; `buildInstructions` rewrite; `dopl_map` + `dopl_search` sections/counts (5→3 domains, 4→3 groups); `skill-template.ts` rewrite; incidental descriptions; `members.ts:315` workflow-row filter (D7); `tool-profiles.js`. **Rebuild `packages/mcp-server/dist`.** Fix `parity.test.ts:142-270` + 4 desktop session/tool-profile tests.
4. **Seeds + onboarding** — remove workflow seed, `walk-a-workflow` skill, workflow KB entries, bootstrap-prompt workflow rubric. Keep ontology/knowledge/skills seeds intact (D5).
5. **Realtime / DB load** — remove `useWorkflowsRealtime` + the 5 workflow tables from `ui-sync.js:71-72` **paired in the same release with** an `ALTER PUBLICATION … DROP TABLE` migration (model: the unapplied `20260807000000` migration). Re-addable later via `ADD TABLE` if workflows return.
6. **Soft-delete removal (§2b)** — its own workstream; can run parallel to 1–5 but ship the confirm-dialog sweep before or with it.
7. **Docs** — `ENGINEERING.md:324` first; coordinate with the other session (it has that file dirty).

## 4. Risks

- **R1** Nav lives in shared `src/`, not `apps/desktop-ui` — routes-only edit leaves dead nav rows.
- **R2** Home page is canvas with 6 entry funnels — missed repoint = boot into 404.
- **R3** Gating API routes kills MCP tools (loopback) — gate at registrar.
- **R4** `ui-sync-tables.test.mjs` now fails on published-but-unsubscribed drift → realtime binding removal MUST pair with the publication migration; un-publishing is silent-failure territory (a binding on an unpublished table goes SUBSCRIBED and delivers nothing) and re-adding is not an undo.
- **R5** Canvas = ontology view (cheap); Configuration = mock-only (cheapest); Workflows = the real work.
- **R6** Three hard runtime importers of `@/features/workflows` forbid deletion (hiding is fine): `trash/server/service.ts` (**this importer no longer exists** — §2b deleted `features/trash/` whole, so R6 is down to two), `workspaces/server/seed-workspace.ts:9`, `clusters/server/service.ts:5` (circular).
- **R7 (cross-doc)** `src/features/workflows` holds the repo's best optimistic-cache implementation (`use-workflows.ts:229-232`) — **harvest into the shared mutation layer (roadmap Phase B) before any future deletion.**
