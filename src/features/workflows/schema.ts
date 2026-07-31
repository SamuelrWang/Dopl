import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";

/**
 * The workflow feature's two short labels, shared by the four routes that
 * write them so create, rename, node-add, node-patch and whole-graph-replace
 * cannot disagree about what a label may contain.
 *
 * Both render into agent narration: `dopl_map` prints every workflow name at
 * session start, `dopl_workflow` op="get" prints the name as a header and then
 * one line per step title, and op="step" walks the graph title by title — the
 * surface an agent is meant to FOLLOW, which makes a forged line there worth
 * more to an attacker than most. Charset rule and rationale in
 * `@/shared/lib/safe-label`.
 *
 * `workflows_editor_update` and `workflow_steps_editor_update` are both
 * `public` UPDATE policies and `authenticated` holds UPDATE on both tables, so
 * any workspace editor can write these columns straight through PostgREST
 * without passing this schema. The matching DB CHECKs are the load-bearing
 * half; these are the half that produces a readable error.
 *
 * `description`, `userInput`, `agentOutput` and `nextInstructions` are NOT
 * bounded — they are the step's instructions, legitimately multi-line, and
 * rendered as bodies.
 */
export const WorkflowNameSchema = safeLabel("Workflow name", 120);

/**
 * A step title is legitimately EMPTY — the column is `NOT NULL DEFAULT ''`,
 * the graph editor creates untitled nodes, and prod holds such rows today — so
 * this is the empty-allowed variant rather than the required one.
 */
export const WorkflowStepTitleSchema = safeOptionalLabel("Step title", 200);
