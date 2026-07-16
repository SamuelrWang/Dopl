import "server-only";

/**
 * Server-side workflow GRAPH authoring (used by the MCP agent path) — the
 * public surface. Writes the header + node `canvas_panels` rows and
 * `canvas_edges` that the canvas renders, then reconciles
 * `workflow_knowledge_bases` / `workflow_skills` from the nodes' docked
 * refs. The canvas realtime subscription reflects these onto an open
 * canvas live.
 *
 * This module is a barrel: the implementation lives in per-seam siblings
 * so each file has one clear purpose. Every existing importer keeps
 * working unchanged.
 *   - `authoring-header.ts` — header panel spawn/sync/resolve (the shared entry point)
 *   - `authoring-refs.ts`   — wire types + kb/skill/entry ref resolution + validation
 *   - `authoring-shared.ts` — ownership, node/edge primitives, cycle detection, attachment reconcile
 *   - `authoring-graph.ts`  — declarative `setGraph` (whole-graph diff)
 *   - `authoring-nodes.ts`  — `addNode` / `updateNode` / `removeNode`
 *   - `authoring-edges.ts`  — `connect` / `disconnect`
 */

export { spawnHeaderPanel, syncHeaderPanel } from "./authoring-header";

export type {
  ReadRefInput,
  ActionRefInput,
  NodeInput,
  EdgeInput,
  GraphSpec,
} from "./authoring-refs";

export { reconcileAttachments } from "./authoring-shared";

export { setGraph } from "./authoring-graph";

export { addNode, updateNode, removeNode } from "./authoring-nodes";

export { connect, disconnect } from "./authoring-edges";
