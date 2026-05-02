# Plan — Knowledge & Skills Canvas Integration

Multi-phase plan to bridge Knowledge bases and Skills with the Canvas (clusters + agent surfaces). Step 1 (hardcoded panel UI) is already shipped. This doc covers everything remaining.

Follow [docs/ENGINEERING.md](ENGINEERING.md) — feature-first, one thing per file, ≤500 lines, repository → service → handler split, named auth wrappers, no `any`. Each phase ends with `tsc --noEmit` clean and the app behaviorally unchanged for surfaces that aren't yet ported.

---

## Decisions (locked in)

- **Edit in panel.** KB tree, entry editor (Tiptap), skill files, when-to-use, status — all editable inside the canvas panel. Same DB writes as the dedicated `/knowledge/[slug]` and `/skills/[slug]` routes.
- **Junction tables for cluster ↔ KB/Skill.** A KB or skill can be attached to multiple clusters. The junction is the source of truth, independent of canvas/panel state, so the agent can read it without a canvas being loaded.
- **Both agent surfaces.** MCP tools (sk-dopl-*) and the in-canvas chat panel both receive attached KBs + skills as cluster context. One service method, two consumers.

---

## Phase 1 — DB schema & migrations

Goal: create the join tables and extend the `canvas_panels` panel_type enum.

Files:
- `supabase/migrations/<ts>_cluster_knowledge_bases.sql` — junction:
  ```sql
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  added_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, knowledge_base_id)
  ```
  Indexes: `(workspace_id)`, `(knowledge_base_id)` for back-references. RLS: `viewer+` can SELECT, `editor+` can INSERT/DELETE.
- `supabase/migrations/<ts>_cluster_skills.sql` — same shape, FK to `skills(id)`.
- `supabase/migrations/<ts>_extend_canvas_panel_type.sql` — extend the panel_type CHECK to include `'knowledge'`, `'skills'`, `'knowledge-base'`, `'skill'`.

Verification: run migrations against a local Supabase, confirm RLS policies behave (use `pnpm supabase db reset`).

---

## Phase 2 — Server-side data layer

Goal: add the attach/detach + listing methods, in line with the existing repository → service split.

Files (all under `src/features/clusters/server/`):
- `repository.ts` — append:
  - `insertClusterKnowledgeBaseLink(cluster_id, knowledge_base_id, ...)`
  - `deleteClusterKnowledgeBaseLink(cluster_id, knowledge_base_id)`
  - `listClusterKnowledgeBaseLinks(cluster_id)` — joins `knowledge_bases` and returns the rows the cluster service expects.
  - Mirror for skills: `insertClusterSkillLink`, `deleteClusterSkillLink`, `listClusterSkillLinks`.
- `service.ts` — append:
  - `attachKnowledgeBase(clusterSlug, kbId, scope)` — verifies cluster + KB workspace match, calls repository.
  - `detachKnowledgeBase(clusterSlug, kbId, scope)`
  - `listAttachedKnowledgeBases(clusterSlug, scope)`
  - Mirror three for skills.
- `service.ts` — extend `getCluster(slug, scope)` (currently returns `{ ...row, entries }`) to also return `{ knowledge_bases, skills }`. New shape:
  ```ts
  ClusterDetail = { ...ClusterRow, entries, knowledge_bases, skills }
  ```
- `dto.ts` — DTO mappers for the two new shapes (`ClusterKnowledgeBaseRef`, `ClusterSkillRef`).

Cross-feature back-refs (small, no sideways imports needed — clusters owns the read):
- `src/features/knowledge/server/service.ts` — add `listClustersForBase(baseId, scope)` reading `cluster_knowledge_bases` (only used to power the "this base is in N clusters" affordance later; can defer if cut for time).
- `src/features/skills/server/service.ts` — same shape for skills.

Verification: vitest unit tests for the new service methods, hitting a local Supabase per [docs/ENGINEERING.md §13](ENGINEERING.md#13-testing).

---

## Phase 3 — API routes

Goal: thin route handlers (≤80 lines) that delegate to `service.ts`.

Files:
- `src/app/api/clusters/[slug]/knowledge-bases/route.ts` — `POST { knowledge_base_id }` → attach. `GET` → list.
- `src/app/api/clusters/[slug]/knowledge-bases/[kbId]/route.ts` — `DELETE` → detach.
- `src/app/api/clusters/[slug]/skills/route.ts` — `POST { skill_id }` → attach. `GET` → list.
- `src/app/api/clusters/[slug]/skills/[skillId]/route.ts` — `DELETE` → detach.

All wrap `withWorkspaceAuth` (the same wrapper the existing cluster routes use). Use `parseJson` + `HttpError` per `src/shared/api/`.

Extend the existing `GET /api/clusters/[slug]` route's response to include the new fields (no new endpoint — same handler now returns the augmented `ClusterDetail`).

Verification: hit each new route end-to-end via `curl` against `pnpm dev`. Schema validation rejects mismatched workspace IDs.

---

## Phase 4 — Wire detail panels to real data (replace hardcoded UI)

Goal: the four panels now built (workspace Knowledge / workspace Skills / single-KB / single-Skill) all read live data and write through to Supabase via existing `/api/knowledge/*` and `/api/skills/*` routes. Cluster attachment is wired separately in Phase 6.

Files (under `src/features/canvas/panels/`):
- `knowledge/knowledge-panel.tsx` — replace `FAKE_BASES` with a `useKnowledgeBases()` hook (already exists at `src/features/knowledge/client/hooks.ts`). Click on a card → spawn a single-KB panel as today, but pass the real KB id/slug.
- `knowledge-base/knowledge-base-panel.tsx` — replace `FAKE_TREE` with a fetch of `/api/knowledge/bases/[baseId]/tree`. Use the existing `KnowledgeTree` component from `src/features/knowledge/components/knowledge-tree.tsx` and the existing `DocPane` (entry editor) — both should be reusable. The panel becomes a thin wrapper over the same components the dedicated `/knowledge/[slug]` route already renders.
- `skills/skills-panel.tsx` — replace `FAKE_SKILLS` with `GET /api/skills`. Click → spawn single-skill panel.
- `skill/skill-panel.tsx` — replace hardcoded body with the existing `SkillView`'s file-tabs + DocEditor; reuse from `src/features/skills/components/skill-view.tsx`.

Reusing the existing editor components keeps one source of truth — edits in the canvas panel go through the same hooks + endpoints as edits on the dedicated route.

Constraint: any reused component must already be exported from a feature barrel. If it's not, this phase includes promoting it (noted in commit message). No deep cross-feature imports.

Verification: open a KB panel, edit an entry, reload the page → edit persisted. Open the same base in `/[workspaceSlug]/knowledge/[kbSlug]` in another tab → edit visible there too.

---

## Phase 5 — Realtime two-way sync

Goal: edits anywhere (canvas panel, dedicated route, MCP write tool, another browser tab) propagate everywhere within a few hundred ms.

Files:
- `src/features/knowledge/client/hooks.ts` — add a `useKnowledgeRealtime(workspaceId)` hook that subscribes to `knowledge_bases`, `knowledge_folders`, `knowledge_entries` Supabase channels and invalidates the local cache.
- `src/features/skills/client/hooks.ts` (new file if missing) — same shape for `skills` and `skill_files`.
- `src/features/canvas/use-canvas-db-sync.ts` — already syncs `canvas_panels`. No changes for the panels themselves; the realtime layer for KB/skill content is owned by the knowledge/skills features.

Pattern: follow the existing realtime usage in `src/features/canvas/canvas-store/provider.tsx` for `cluster_brain_memories` (channel subscribe → refetch the affected entity → dispatch into store / cache). No optimistic UI in this phase — keep the diff small. Optimistic updates are a polish-pass concern.

Verification: open the same KB in two tabs (canvas panel + dedicated route). Edit in one, watch the other update without manual refresh.

---

## Phase 6 — Cluster attachment wiring (canvas ↔ DB)

Goal: dragging a KB or skill panel into a cluster persists the attachment via the Phase 3 endpoints.

Files (canvas-side):
- `src/features/canvas/canvas-store/provider.tsx` — add a sync bridge `useClusterContentSync` that watches cluster membership changes for `knowledge-base` / `skill` panels:
  - On `ADD_PANEL_TO_CLUSTER` (or `CREATE_CLUSTER` containing such a panel): if the cluster has a `dbId` and no other same-KB/skill panel is already attached → `POST /api/clusters/[slug]/knowledge-bases` (or `/skills`).
  - On `REMOVE_PANEL_FROM_CLUSTER` / `CLOSE_PANEL`: if no other panel of the same KB/skill remains in that cluster → `DELETE`.
  - Same KB or skill in *different* clusters → multiple junction rows, one per cluster (the user explicitly wants this for cross-context skills like "company voice").
- `src/features/canvas/use-cluster-attachments.ts` (new) — hydration hook: on canvas load, for each visible cluster, fetch `GET /api/clusters/[slug]` and reconcile attached KBs/skills with what's currently rendered (spawn missing panels, mark stale ones).

Edge case: a panel of KB X is in cluster A, the user closes the panel without dragging it out. The attachment row stays (same as how cluster_panels rows for entries persist when the entry panel is closed — the cluster still "contains" the entry). User must explicitly detach via a panel menu action.

UI:
- In the panel header for `knowledge-base` and `skill` types: a small "⋯" menu with `Detach from {cluster}` when the panel is in a cluster.

Verification: spawn cluster A with two KB panels, reload → both still attached. Spawn another cluster B with one of the same KBs → DB shows two junction rows for that KB (one per cluster).

---

## Phase 7 — Agent integration (MCP + in-canvas chat)

Goal: when the agent reads a cluster, it sees the attached KBs and skills as first-class context, not just entries.

### 7a — MCP server

Files (`packages/mcp-server/src/server.ts`):
- Extend `get_cluster(slug)` response: append a markdown section per attached KB (`## Knowledge: <name>` + description + a one-line index of entries) and per skill (`## Skill: <name>` + when-to-use + body). Truncate per the existing `CONTEXT_CHAR_BUDGET` (split the budget across entries / KBs / skills so the response stays bounded).
- New tool `read_cluster_knowledge_entry({ cluster_slug, kb_slug, entry_path })` — returns one entry's body.
- New tool `read_cluster_skill({ cluster_slug, skill_slug })` — returns the skill's full body (SKILL.md + supplementary files concatenated).
- Both new tools verify the KB/skill is actually attached to the named cluster — defense against an agent reaching outside its current cluster context.

Files (`packages/dopl-client/src/client.ts`):
- New methods: `getClusterKnowledgeEntry`, `getClusterSkill` calling the corresponding API routes.

Files (`src/app/api/clusters/[slug]/knowledge-bases/[kbId]/entries/[entryId]/route.ts` and `.../skills/[skillId]/file/route.ts`):
- New thin handlers wrapping the existing knowledge / skills services, but with an attachment check first (return 404 if not attached).

### 7b — In-canvas chat panel

Files (`src/features/chat/server/`):
- The chat handler already receives a `clusterId` when the chat panel is inside a cluster (used today to load the cluster brain). Extend the prompt assembly to also pull attached KBs (titles + descriptions, optionally the highest-relevance entries via embedding lookup) and skills (full body — skills are short by design).
- Skills attached to a cluster are appended to the system prompt as an "Available procedures" section. KB content is loaded on-demand via the same retrieval pipeline used for entries.

Verification:
- MCP: `mcp__dopl__get_cluster` against a cluster with attached KBs/skills returns them in the rendered markdown.
- Chat: open a chat panel inside a cluster that has the "company voice" skill attached, ask it to draft an email, the response visibly applies the skill.

---

## Phase 8 — Polish (defer if time-pressed)

- Empty states + loading skeletons in all four panels.
- Optimistic UI for attach/detach (apply immediately, rollback on error).
- Error toasts for failed sync (existing `toast` from `@/shared/ui/toast`).
- "Pin to cluster" affordance on a KB/skill panel — opens a cluster picker for explicit attachment without dragging.
- Onboarding tooltip on first cluster: "Drag a knowledge base or skill in to give your agents extra context."
- Telemetry: log `cluster_kb_attached` / `cluster_skill_attached` events so we can see usage.

---

## Cross-cutting concerns

- **Type safety.** Extend the Supabase generated types after Phase 1: `pnpm supabase gen types typescript --local > src/shared/supabase/types.ts`.
- **No `any`.** Every new method has explicit param + return types.
- **File size.** Watch `service.ts` and `repository.ts` in `clusters/` — they'll grow. Split into per-domain sub-modules (`knowledge-base-links.ts`, `skill-links.ts`) before either crosses 500 lines.
- **Migration ordering.** Junction tables depend on `knowledge_bases` and `skills`. Both already exist (per `20260501000000_knowledge_bases.sql` and `20260501090000_skills.sql`).
- **Backwards compatibility.** Extending `GET /api/clusters/[slug]` to add fields is non-breaking. Existing MCP clients keep working.

---

## Phase order & gating

Phases must land in order; each gated on the previous being typecheck-clean and end-to-end working:

1. DB → 2. Service → 3. API → 4. Panel data wiring → 5. Realtime → 6. Cluster attachment → 7. Agent integration → 8. Polish

Phases 4 and 5 can overlap once the data layer is in place. Phase 7 strictly waits on 6 — the agent reads from the junction table populated by attachment.

Done = a user can: ingest a KB on the dedicated route, drop it into a cluster panel on the canvas, ask their MCP agent about that cluster, and watch it cite the KB.
