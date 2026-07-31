/**
 * Shared render helpers + graph types for the `dopl_workflow` tool. The
 * read and write op modules both lean on these; the registrar
 * (workflow.ts) keeps op routing.
 */

import type { WorkflowDetail } from "@dopl/client";
import { inlineOr } from "./narration";
import { err, type ToolResponse } from "./respond";

/**
 * A workflow's `name` / `description`, and every step's `title`, are typed by
 * a workspace member and bounded by length alone (max 120 / 2000 / 200,
 * app/api/workflows). The STEP INSTRUCTIONS — `description`, `userInput`,
 * `agentOutput`, `nextInstructions` — are the workflow's whole point: prose
 * written for the agent to follow. Those stay intact; names and titles, which
 * were spliced into `# `, `### ` and bullet heads, become values.
 */
export const NO_NAME = "`(unnamed)`";
export const NO_TITLE = "`(untitled)`";

export type StepNode = NonNullable<WorkflowDetail["graph"]>["nodes"][number];
export type GraphEdge = NonNullable<WorkflowDetail["graph"]>["edges"][number];

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function renderReads(reads: StepNode["reads"]): string {
  return reads
    .map((r) =>
      r.kind === "file"
        ? `${inlineOr(r.name, NO_NAME)} (file, kb_id: ${r.kbId}, entry_id: ${r.entryId})`
        : `${inlineOr(r.name, NO_NAME)} (knowledge base, kb_id: ${r.kbId})`
    )
    .join("; ");
}

export function renderActions(actions: StepNode["actions"]): string {
  return actions
    .map((a) => `${inlineOr(a.name, NO_NAME)} (skill, skill_id: ${a.skillId})`)
    .join("; ");
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
