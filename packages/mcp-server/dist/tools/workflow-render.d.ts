/**
 * Shared render helpers + graph types for the `dopl_workflow` tool. The
 * read and write op modules both lean on these; the registrar
 * (workflow.ts) keeps op routing.
 */
import type { WorkflowDetail } from "@dopl/client";
import { type ToolResponse } from "./respond";
export type StepNode = NonNullable<WorkflowDetail["graph"]>["nodes"][number];
export type GraphEdge = NonNullable<WorkflowDetail["graph"]>["edges"][number];
export declare function plural(n: number, noun: string): string;
export declare function renderReads(reads: StepNode["reads"]): string;
export declare function renderActions(actions: StepNode["actions"]): string;
/**
 * Clean "no such workflow" guidance for a backend 404 on a slug-addressed
 * op — mirrors the isNotFound mapping opDisconnect / dopl_cluster_admin use,
 * so authors get a recoverable message instead of a raw "HTTP 404: {json}".
 */
export declare function workflowNotFound(slug: string): ToolResponse;
