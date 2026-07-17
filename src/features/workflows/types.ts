/**
 * Workflow domain types (camelCase). A workflow is a graph of steps
 * (`workflow_steps`) connected by branch-conditioned edges
 * (`workflow_step_edges`). These replace the canvas-derived
 * `WorkflowNode` / `WorkflowGraph` shapes that BFS-composed the graph from
 * canvas panels + edges. Steps reference knowledge (reads) and skills
 * (actions); edges carry an agent-readable branch condition.
 */

/** A knowledge reference on a step: a whole KB, or a single entry (file). */
export interface WorkflowStepRead {
  kind: "kb" | "file";
  kbId: string;
  entryId?: string;
  name: string;
}

/** A skill reference on a step. */
export interface WorkflowStepAction {
  kind: "skill";
  skillId: string;
  name: string;
}

/** One step in a workflow. `ref` is the stable authoring key. */
export interface WorkflowStep {
  /** Step uuid — the identity edges/authoring ops address. */
  id: string;
  /** Stable agent-chosen handle (UNIQUE per workflow); set_graph diffs by it. */
  ref: string;
  title: string;
  description: string;
  reads: WorkflowStepRead[];
  actions: WorkflowStepAction[];
  userInput: string;
  agentOutput: string;
  nextInstructions: string;
}

/** A directed connector between two steps, carrying a branch condition. */
export interface WorkflowEdge {
  id: string;
  fromStepId: string;
  toStepId: string;
  /** Agent-readable branch guard; '' = unconditional. */
  condition: string;
}
