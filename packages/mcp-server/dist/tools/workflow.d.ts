/**
 * `dopl_workflow` + `dopl_workflow_admin` — read/non-destructive writes and
 * the separately permission-gated destructive workflow operations.
 *
 * A workflow is a graph of steps (workflow_steps) connected by branch-
 * conditioned edges (workflow_step_edges). It owns the knowledge bases +
 * skills its steps reference and is the unit agents follow step-by-step.
 * Entry steps are those with no incoming edge. Clusters group workflows.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerWorkflowTools(register: RegisterTool, client: DoplClient): void;
