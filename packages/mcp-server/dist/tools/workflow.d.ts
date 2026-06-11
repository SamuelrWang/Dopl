/**
 * `dopl_workflow` + `dopl_workflow_admin` — read/non-destructive writes and
 * the separately permission-gated destructive workflow operations.
 *
 * A workflow is a header panel plus the node graph wired to it by connectors
 * on the canvas. It owns the knowledge bases + skills its nodes reference and
 * is the unit agents follow step-by-step. Clusters group workflows.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerWorkflowTools(register: RegisterTool, client: DoplClient): void;
