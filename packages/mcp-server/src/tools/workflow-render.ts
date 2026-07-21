/**
 * Shared render helpers + graph types for the `dopl_workflow` tool. The
 * read and write op modules both lean on these; the registrar
 * (workflow.ts) keeps op routing.
 */

import type { WorkflowDetail } from "@dopl/client";
import { err, type ToolResponse } from "./respond";

export type StepNode = NonNullable<WorkflowDetail["graph"]>["nodes"][number];
export type GraphEdge = NonNullable<WorkflowDetail["graph"]>["edges"][number];

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function renderReads(reads: StepNode["reads"]): string {
  return reads
    .map((r) =>
      r.kind === "file"
        ? `${r.name} (file, kb_id: ${r.kbId}, entry_id: ${r.entryId})`
        : `${r.name} (knowledge base, kb_id: ${r.kbId})`
    )
    .join("; ");
}

export function renderActions(actions: StepNode["actions"]): string {
  return actions.map((a) => `${a.name} (skill, skill_id: ${a.skillId})`).join("; ");
}

/**
 * Clean "no such workflow" guidance for a backend 404 on a slug-addressed
 * op — mirrors the isNotFound mapping opDisconnect / dopl_cluster_admin use,
 * so authors get a recoverable message instead of a raw "HTTP 404: {json}".
 */
export function workflowNotFound(slug: string): ToolResponse {
  return err(
    `No workflow \`${slug}\` in this workspace. Run dopl_workflow(op="list") to see valid slugs/ids.`,
  );
}
