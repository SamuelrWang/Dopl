import "server-only";

/**
 * Server-side workflow GRAPH authoring (used by the MCP agent path + the
 * web UI) — the public surface. Writes the `workflow_steps` +
 * `workflow_step_edges` rows the workflow is composed from, then
 * reconciles `workflow_knowledge_bases` / `workflow_skills` from the
 * steps' docked refs.
 *
 * This module is a barrel: the implementation lives in per-seam siblings
 * so each file has one clear purpose. Every existing importer keeps
 * working unchanged.
 *   - `authoring-refs.ts`   — wire types + kb/skill/entry ref resolution + validation
 *   - `authoring-shared.ts` — header-sentinel guard, cycle detection, attachment reconcile
 *   - `authoring-graph.ts`  — declarative `setGraph` (whole-graph diff by ref)
 *   - `authoring-nodes.ts`  — `addNode` / `updateNode` / `removeNode`
 *   - `authoring-edges.ts`  — `connect` / `disconnect`
 */

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
