# Canvas Clusters → Workflows Pivot — Implementation Handoff

> **⛔ RETIRED 2026-08-07. THE WORKFLOW ENTITY THIS HANDOFF INTRODUCED IS HIDDEN FROM USERS AND FROM AGENTS.**
>
> Canvas, Workflows and Configuration were retired from every user-facing and agent-facing surface on 2026-08-07 — unrouted, off the sidebar, out of the tour and the seeds, and `dopl_workflow` / `dopl_workflow_admin` / `dopl_cluster` / `dopl_cluster_admin` no longer register (they are absent from `tools/list`). **Hide, don't delete:** `src/features/{workflows,clusters}` and the `/api/workflows/**` routes still exist and still compile; nothing reaches them.
>
> See [RETIREMENT-UNWIRING-PLAN.md](RETIREMENT-UNWIRING-PLAN.md) for what was unwired and [ENGINEERING.md](ENGINEERING.md) §7 "Canvas, Workflows & Configuration — RETIRED FROM EVERY SURFACE" for the statement of record. **This file is kept for history only** — the review it invites was completed long ago, and nothing below is a live contract.

> Audience: a reviewer (human or stronger model) checking this work.
> Scope: a two-session change that removed the spatial "cluster" grouping from
> the canvas and introduced a real **Workflow** entity, plus the follow-up
> cleanup that made clusters pure containers and dropped the legacy schema.
> Nothing here is committed yet — it's all in the working tree for review.

---

## 1. Goal (what the user asked for)

The canvas previously had **spatial clusters**: you dragged node panels near each
other and a dashed outline grouped them into a "workflow." The user wanted:

1. **Remove that spatial grouping entirely.** Connections between nodes should be
   explicit **connection lines (edges)** with **arrows** showing direction — drawn
   by dragging from connector **sites** that appear on a panel's edge on hover.
   ("Right now it doesn't even connect" → make connecting actually work.)
2. **A three-level model:** **Cluster → contains Workflows → each Workflow = a
   header panel + its edge-connected nodes.** A cluster is now a *non-spatial
   container* that groups multiple workflows (no outline).
3. **Full rename** of the concept across **DB, MCP, API, client** — KB/skill
   attachments + agent exposure move from cluster level to **workflow level**.

Confirmed decisions (via Q&A): cluster grouping is non-spatial; cluster has only a
name (no full header panel — the per-workflow header is the card); connector sites
appear only on **node + workflow-header** panels; attachments + dopl exposure live
at **workflow** level; do the full rename including a prod DB migration.

---

## 2. Final data model

```
clusters (KEPT, now a pure container)        workflows (NEW)                      canvas_panels / canvas_edges
─────────────────────────────────────        ───────────────                      ────────────────────────────
id, workspace_id, name, slug, description     id, workspace_id,                    panel_type 'workflow' → header  (panel_data {workflowId,name,description})
                                       1───*  cluster_id (nullable FK,             panel_type 'node'     → step    (panel_data: reads[], actions[], ...)
                                              ON DELETE SET NULL),                 canvas_edges: from_panel_id → to_panel_id (directed)
                                              user_id, name, slug, description
                                                │
                                                ├──*  workflow_knowledge_bases
                                                └──*  workflow_skills
```

- **Workflow membership = edge reachability from the header panel** (undirected
  BFS over `canvas_edges`). No `panelIds` array anywhere.
- A workflow header panel is self-contained: its name/description live in
  `panel_data` (synced via `canvas_panels`) and mirror to the `workflows` row via
  `/api/workflows/[id]` PATCH so agents see the latest over MCP.
- Clusters no longer hold KB/skill attachments and have no node graph of their own.

---

## 3. What changed, by area

### Connectors (Phase 1)
- `src/features/canvas/edges/anchors.ts` (new) — site geometry: 3 sites per side ×
  4 sides; `facingAnchors`/`edgePath` for committed-edge curves.
- `edges/node-ports-layer.tsx` — 12 hover-revealed sites per node, **1** bottom
  site on the workflow header; bidirectional; all sites reveal during a drag.
- `edges/use-edge-drag.ts` — drag any site → drop any site → directed `EDGE_ADD`;
  ghost line + arrowhead.
- `edges/edge-layer.tsx` — committed edges render facing-side curves + arrowheads.
- Edge persistence (`canvas_edges` table, `/api/canvas/edges`, db-sync, load) was
  **already wired and applied** — the "doesn't connect" bug was the unusable port
  UX, not missing persistence.

### Spatial-cluster removal (Phase 2)
- Deleted `canvas/clusters/cluster-geometry|outline|layer|layout.ts(x)`.
- Stripped cluster drag, auto-membership, and outline rendering from `canvas.tsx`,
  `use-canvas-panel-drag.ts`, `canvas-parts/index.tsx`. Menu "New cluster" → "New
  workflow".

### Workflow entity, client (Phase 3)
- `types.ts`: `ClusterInfoPanelData {clusterId}` → `WorkflowPanelData
  {workflowId,name,description}` (panel_type `cluster-info` → `workflow`). Removed
  `Cluster` type, `state.clusters`, `nextClusterId`, all cluster actions; added
  `CREATE_WORKFLOW` / `UPDATE_WORKFLOW_INFO`.
- `panels/workflow/workflow-panel.tsx` (new, replaces cluster-info panel).
- `create-workflow.ts` (new, replaces create-cluster). Client generates the
  workflow uuid so the header panel and the DB row share an id.
- `canvas-panel.tsx`, `panel-dto.ts`, `reducer.ts`, `load-server-state.ts`,
  `server/defaults.ts`, `canvas-store/context.tsx`, `provider.tsx`,
  `use-canvas-db-sync.ts` updated. db-sync deletes the `workflows` row when a
  header panel is removed.
- Removed `use-clusters-realtime`, `use-cluster-attachment-sync`,
  `cluster-attachment-banner` (+ its KB/skill-panel usages). Chat is canvas-scoped
  now (removed cluster scoping in `chat-panel.tsx`, `cluster-context.ts`,
  `api/chat/route.ts`; deleted `attach-panel-to-cluster.ts`).

### Workflow backend + dock=attach (Phase 3 + follow-up Item 2)
- `src/features/workflows/server/{service,graph,attachments}.ts` (new).
  `composeWorkflow` = header → undirected edge-reachable `node` panels → topo-sort
  (Kahn, spatial fallback on cycle).
- `/api/workflows` (GET list, POST create), `/api/workflows/[id]` (GET/PATCH/DELETE),
  `/api/workflows/[id]/knowledge-bases` + `/skills` (POST attach / DELETE detach).
- `use-workflow-attachment-sync.ts` (new) — desired attachments = union of node
  `reads`/`actions` refs across a workflow's reachable nodes; diff vs last, POST/DELETE
  the delta; serialized per (workflowId, side, refId); seeded silently on mount.

### Clusters as containers (follow-up Item 1)
- `features/clusters/server/service.ts` rewritten: `listClusters`/`getCluster`
  return the cluster's **workflows** (count/names/summaries) instead of KB/skill
  attachments. Deleted `clusters/server/attachments.ts`, `workflow.ts`,
  `canvas-side-effects.ts` and the `/api/clusters/[slug]/knowledge-bases|skills`
  route trees.
- MCP `dopl_cluster` (cluster.ts) is now a container tool (list/get show workflows;
  create/update; admin delete). Dropped its `read_knowledge_entry`/`read_skill` ops.

### MCP (Phase 5 + Item 1)
- `dopl_workflow` (list/get/create/update) + `dopl_workflow_admin` (delete) in
  `packages/mcp-server/src/tools/workflow.ts`. `get` renders ordered steps +
  knowledge/skills.
- `@dopl/client`: added `WorkflowRow`/`WorkflowDetail` + 5 workflow methods;
  reshaped `ClusterRow` (workflow_count/names) + `ClusterDetail` (workflows[]);
  removed the cluster KB/skill read methods. **dopl-client must be rebuilt**
  (`npm run build --workspace=@dopl/client`) for mcp-server to see the changes.
- `server.ts` registers the tool + updated `SERVER_INSTRUCTIONS`.

### Database (Phase 4 + Item 3) — APPLIED TO PROD
- `supabase/migrations/20260610200000_workflows.sql` — created `workflows` (+
  nullable `cluster_id`), `workflow_knowledge_bases`, `workflow_skills` (RLS,
  realtime, workspace-assert + soft-delete-cascade triggers mirroring clusters).
  Backfilled **1 workflow per existing cluster (9)**, moved attachments (**2 KB,
  1 skill**), converted the **2** `cluster-info` panels → `workflow` panels.
- `supabase/migrations/20260610210000_drop_legacy_cluster_remnants.sql` — dropped
  `cluster_knowledge_bases`/`cluster_skills`, `canvas_state.clusters` +
  `next_cluster_id`, `'cluster-info'` from the `canvas_panels` panel_type CHECK,
  and the orphaned assert functions; repointed the soft-delete cascade fns at the
  workflow junctions.
- `src/shared/supabase/types.ts` regenerated.

---

## 4. Verification already done

- `tsc --noEmit` is **0 errors** on all three targets: `src/`, `packages/dopl-client`,
  `packages/mcp-server`.
- ESLint: the only errors are the pre-existing **F-006** react-compiler debt class
  ("Cannot access refs during render" / "setState synchronously within an effect")
  which match patterns already shipping in `use-canvas-db-sync.ts` and the old
  cluster-info panel; **no new error classes** were introduced.
- Migrations verified against prod data: 9 workflows, 2 KB + 1 skill attachments
  moved, 0 `cluster-info` panels remaining, 0 legacy junction tables/columns left.
- **Not run:** the app itself (no dev server, per the owner's standing preference);
  `dopl_workflow` over live MCP (the connected MCP server is the *deployed* build —
  it won't have the new tool until master deploys). The owner verifies the UI + MCP.

---

## 5. Risk areas to scrutinize (where a reviewer should focus)

1. **Workflow header deletion is unconfirmed via ✕ / Delete key.** `isPanelDeletable`
   returns true for `workflow`, so the panel's ✕ and keyboard-delete remove it (and
   db-sync then deletes the `workflows` row → detaches its KBs/skills). Only the
   in-panel trash button shows a confirm dialog. Consider gating ✕/keyboard delete
   behind a confirm, or making the header non-deletable except via the trash button.

2. **UNDO_DELETE doesn't restore a deleted workflow row.** Deleting a header panel
   deletes the `workflows` row; `UNDO_DELETE` re-adds the panel but not the row, so
   the restored header's `workflowId` dangles (PATCH/dopl would 404). Session-only,
   low impact, but worth a decision.

3. **Double DELETE of the workflow row.** The trash button (`handleDelete`) DELETEs
   `/api/workflows/[id]` *and* dispatches `CLOSE_PANEL`, which makes db-sync DELETE
   the same row again. Idempotent (`.delete().eq()` returns ok on 0 rows), so it's a
   redundant call, not a correctness bug — confirm that's acceptable.

4. **Attachment-sync rollback race** (`use-workflow-attachment-sync.ts`). On a failed
   attach/detach, the `.then()` rollback mutates `lastRef.current`, which may already
   be a newer baseline if the effect re-ran. This mirrors the prior cluster-sync
   behavior (same race shipped before). Low frequency (failures only).

5. **7 migrated workflows have no canvas header panel.** The backfill created a
   workflow per cluster (9), but only the 2 clusters that had a `cluster-info` panel
   got a `workflow` header. The other 7 are listable via `dopl_workflow(list)` but
   aren't visible/editable on the canvas. Cosmetic; the owner can delete them via
   `dopl_workflow_admin`. Verify this matches intent.

6. **Committed edges re-derive facing-side anchors** rather than attaching at the
   exact dragged site (`edge-layer.tsx` uses `facingAnchors`). The visible edge may
   "snap" to a side midpoint on commit. Cosmetic; the 12 sites are interaction
   handles, not persisted anchors.

7. **create → edit/attach race.** `createWorkflow` dispatches the panel then fires
   `POST /api/workflows` fire-and-forget. A PATCH/attach issued before the row exists
   would 404 (`resolveWorkflowId`). Caught + retried on next change; unlikely in
   practice (user wires nodes after creating).

8. **Private-chat cluster scope-picker left as-is.** `cluster-scope-picker.tsx` /
   `scope_filters.clusterIds` (a RAG filter scoping a private chat to clusters) was
   NOT reworked — clusters no longer directly hold KB/skill content, so its semantics
   shifted, though it's not schema-broken. Out of scope for this pivot; flag if the
   reviewer wants it addressed.

9. **`composeWorkflow` uses undirected reachability.** Any node edge-connected to a
   header (regardless of arrow direction) is a member. Confirm that's the intended
   membership rule (vs. directed-from-header-only).

---

## 6. How to verify end-to-end

- **Canvas (owner, in browser):** right-click → "New workflow" spawns a header card;
  hover a node edge → 3 sites appear; drag site→site → arrowed edge; the header shows
  one bottom site; dragging nodes together no longer draws an outline; rename/describe
  the header persists (reload); delete via trash detaches its KBs/skills.
- **DB:** `select * from workflows`; `select * from workflow_knowledge_bases`; confirm
  a KB docked into a node connected to a header creates a `workflow_knowledge_bases`
  row, and undocking removes it.
- **MCP (after deploy):** `dopl_workflow(op:'list')`; `dopl_workflow(op:'get', slug)`
  returns ordered steps + attachments; `dopl_cluster(op:'get', slug)` lists the
  container's workflows.
- **Build gate:** `npx tsc --noEmit` (src) + `-p packages/dopl-client/tsconfig.json`
  + `-p packages/mcp-server/tsconfig.json`; rebuild dopl-client before checking
  mcp-server.

---

## 7. Not committed
All of the above is uncommitted in the working tree. Two migrations are **already
applied to the prod database** (additive create + backfill, then the legacy drop);
the SQL files are in `supabase/migrations/`. The owner commits to `master` (Vercel
deploys from there) after review.
