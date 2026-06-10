# Canvas → Workflow Builder — implementation plan

> STATUS (2026-06-10): Implemented through Phase 4 (chrome conversion,
> cluster-info panels + spacious outlines, node blocks with dock zones,
> edges, dock=attach sync, MCP workflow exposure). The `canvas_edges`
> migration (supabase/migrations/20260610020000_canvas_edges.sql) is
> written but PENDING prod apply. Implementation details that superseded
> this doc live in the approved plan + ENGINEERING.md §1 app-shell note.

Decided 2026-06-10 with Sam. Clusters become visual **workflows** (name stays
"cluster"). V1 = authoring + MCP-readable (no in-app execution). Docking a
KB/skill into a node keeps the cluster's attachment lists in sync (the
workflow IS what the cluster exposes to agents). Read fields accept whole-KB
panels AND file-level references. Existing clusters upgrade in place.

## Target UX

- Canvas page adopts the new design language: AppShell chrome (rail + sidebar
  + dark frame), the canvas surface as the white panel (light colorway, new
  fonts). No file tree.
- Right-click / double-click popup is overhauled; primary item **New cluster**.
- New cluster spawns a **cluster-info panel** (editable name + description)
  surrounded by the dashed cluster outline with generous padding (outline
  noticeably larger than its contents).
- **Node blocks** — a new panel type with:
  - title + description
  - **Read** — dock zone; drag in a knowledge-base panel or a file dragged out
    of a KB panel's tree → renders as a docked chip
  - **Action** — dock zone for skill panels (sidebar keeps the name "Skills")
  - **User input** — plain textarea
  - **Agent output** — plain textarea
  - **Next node instructions** — plain textarea
  - all fields optional
- **Connectors** — ports on node edges; drag port→port to draw an edge;
  edges render as curves under the panels; click to delete. The connected
  graph inside a cluster is the workflow.

## Data model

- `clusters` + `description text` column (new migration; 300-char cap via the
  shared `DESCRIPTION_MAX` convention).
- **Node** = `canvas_panels` row, `panel_type: 'node'`, `panel_data`:
  ```ts
  interface NodePanelData extends BasePanelData {
    type: "node";
    title: string;
    description: string;
    reads: NodeRef[];    // {kind:"kb",kbId,name} | {kind:"file",kbId,entryId,name}
    actions: NodeRef[];  // {kind:"skill",skillId,name}
    userInput: string;
    agentOutput: string;
    nextInstructions: string;
  }
  ```
- **Cluster-info panel** = `panel_type: 'cluster-info'`, `panel_data:
  { clusterId }`; replaces the floating header tab. Member of the cluster's
  `panelIds` so the outline hull includes it.
- **Edges** = new `canvas_edges` table
  (`id, workspace_id, from_panel_id, to_panel_id, created_by, created_at`,
  FK to canvas_panels ON DELETE CASCADE, realtime publication, RLS matching
  canvas_panels). Edges are workspace-shared workflow definition — NOT
  per-user `canvas_state`.

## Phases (each is a shippable PR-sized chunk)

### Phase 0 — Canvas chrome conversion
- `[canvasSlug]/layout.tsx` mounts AppShell (same pattern as `(app)/layout`).
- Canvas stops portaling to `document.body`: render in-flow inside an
  AppPanel (`scroll=false`), absolute-positioned fill. Fixed overlays
  (input bar, minimap, zoom controls, selection toolbar, context menu) go
  `absolute` within the panel container.
- Light colorway via the panel's lightScope (the `html.light .canvas-surface`
  tokens already exist from the earlier tokenization sweep).
- Gut the legacy chrome: delete old `Sidebar`, `WorkspaceSwitcher` dropdown,
  `FlushGrid` canvas branch in layout-shell (legacy shell then serves only
  non-workspace pages). Pending-invitation acceptance moves to the
  /workspaces page + invite links (already exist).

### Phase 1 — Cluster-info + spacious outlines (workflow look)
- Migration: `clusters.description`.
- `cluster-info` panel type: rendering (name/description editable, saves via
  /api/clusters PATCH), creation in CLUSTER_CREATE, lazy synthesis for
  existing clusters (upgrade in place), removal of the old header tab.
- `cluster-geometry`: padding bump (outline breathes ~80–120px beyond hull).
- Context-menu overhaul: light styling, items = New cluster / New node /
  existing panel spawns; also open on double-click.

### Phase 2 — Node blocks
- `NodePanelData` type + reducer actions (`NODE_FIELD_SET`,
  `NODE_REF_DOCK`, `NODE_REF_UNDOCK`) + persistence through the existing
  canvas_panels PATCH path (panel_data).
- Node panel component (new design styling): title/desc, Read + Action dock
  zones, the three textareas, ports.
- Docking: drag an existing KB/skill panel over a zone → highlight → drop
  converts the panel into a chip ref (panel removed from canvas). Drag a file
  row out of a KB panel's tree → file chip. Undock (chip ×) restores nothing
  (refs are cheap; user can respawn panels from the sidebar/menu).

### Phase 3 — Edges
- `canvas_edges` migration + `/api/canvas/edges` routes (list/create/delete,
  withWorkspaceAuth) + repository/service + realtime.
- Store: edges state + actions; SVG edge layer with port-drag interaction.

### Phase 4 — Dock = attach + MCP exposure
- Service-side: docking a KB/file ref attaches the KB to the cluster
  (cluster_knowledge_bases); docking a skill attaches it (cluster_skills);
  undocking detaches when no other node in the cluster references it.
- `dopl_cluster` MCP tool: cluster get/list responses gain a `workflow`
  section — ordered nodes (title, description, reads with file paths,
  actions, userInput, agentOutput, nextInstructions) + edges — composed
  server-side from canvas_panels + canvas_edges.

### Risks / invariants
- canvas.tsx (~720 lines), reducer (~800), use-panel-ingestion (~820) are the
  heavy edit zones — keep §2 file-size rule in mind; extraction opportunities
  (use-viewport / use-interactions hooks) noted in ENGINEERING.md §2 table.
- Panel visibility: nodes default to workspace-visible (workflows are
  collaborative); follows the existing panel-creation path.
- No behavior changes to chat panels / artifact panels in this pass.
