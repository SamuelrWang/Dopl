/**
 * `dopl_workflow` + `dopl_workflow_admin` — read/non-destructive writes and
 * the separately permission-gated destructive workflow operations.
 *
 * A workflow is a graph of steps (workflow_steps) connected by branch-
 * conditioned edges (workflow_step_edges). It owns the knowledge bases +
 * skills its steps reference and is the unit agents follow step-by-step.
 * Entry steps are those with no incoming edge. Clusters group workflows.
 *
 * This file is the thin registrar: it owns the two tool schemas + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `workflow-render.ts`     — graph types + render helpers (plural/reads/actions/not-found)
 *   - `workflow-ops-read.ts`   — list/get/step/list_trash
 *   - `workflow-ops-write.ts`  — create/update/set_graph + node/edge ops + set_cluster + restore
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerWorkflowTools(register: RegisterTool, client: DoplClient): void;
