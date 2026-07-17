import type { WorkflowStep } from "../types";

/**
 * Client-facing workflow shapes. The server's `WorkflowRow`/`WorkflowDetail`
 * live in a `server-only` module, so the browser layer defines the subset it
 * consumes here (camelCase, mapped from the API envelope in `client/api.ts`).
 */

/** Composed step graph — nodes topo-ordered, edges carry branch conditions. */
export interface WorkflowGraph {
  nodes: WorkflowStep[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  condition: string;
}

/** List-row summary (no graph; step + attachment counts for the tab strip). */
export interface WorkflowSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  stepCount: number;
  knowledgeBaseCount: number;
  skillCount: number;
}

/** Full detail for the selected workflow. */
export interface WorkflowDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  graph: WorkflowGraph | null;
}

/** Wire shape for a step read ref (POST/PATCH nodes). */
export interface ReadRefInput {
  kbId: string;
  entryId?: string;
}

/** Wire shape for a step action ref (POST/PATCH nodes). */
export interface ActionRefInput {
  skillId: string;
}

export interface NodeContentInput {
  title?: string;
  description?: string;
  reads?: ReadRefInput[];
  actions?: ActionRefInput[];
  userInput?: string;
  agentOutput?: string;
  nextInstructions?: string;
}
