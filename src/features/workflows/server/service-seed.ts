import "server-only";
import type { Role } from "@/features/workspaces/types";
import type { GraphSpec, NodeInput, EdgeInput } from "./authoring-refs";
import { setGraph } from "./authoring-graph";
import { createWorkflow, type WorkflowScope } from "./service";
import { buildWorkflowSeed } from "./seed";

/**
 * Cross-reference maps the orchestrator threads in: the seeded knowledge
 * base id (reads attach at the entry level under it), stable entry key →
 * entry uuid, and skill slug → skill uuid. Steps whose refs don't resolve
 * simply carry fewer reads/actions — the graph still builds.
 */
export interface WorkflowSeedRefs {
  kbBaseId: string;
  entryIdByKey: Record<string, string>;
  skillIdBySlug: Record<string, string>;
}

export interface SeedWorkflowResult {
  workflowId: string | null;
  stepCount: number;
}

/**
 * Seeds the "Workspace upkeep" workflow: creates the row, then builds its
 * whole step graph declaratively via the ordinary `setGraph` authoring
 * path (which resolves + validates every ref). The workflow is left
 * cluster-less — workflow clusters live in the `clusters` table, distinct
 * from the seeded ontology cluster, so there's nothing valid to attach.
 */
export async function seedWorkspace(
  workspaceId: string,
  userId: string,
  refs: WorkflowSeedRefs
): Promise<SeedWorkflowResult> {
  const scope: WorkflowScope = {
    workspaceId,
    userId,
    role: "owner" as Role,
    source: "user",
  };
  const seed = buildWorkflowSeed();

  const workflow = await createWorkflow(
    { name: seed.name, description: seed.description },
    scope
  );

  const nodes: NodeInput[] = seed.steps.map((step) => {
    const reads = step.readEntryKeys
      .map((key) => refs.entryIdByKey[key])
      .filter(Boolean)
      .map((entryId) => ({ kbId: refs.kbBaseId, entryId }));
    const actions = step.actionSkillSlugs
      .map((slug) => refs.skillIdBySlug[slug])
      .filter(Boolean)
      .map((skillId) => ({ skillId }));
    return {
      ref: step.ref,
      title: step.title,
      description: step.description,
      reads,
      actions,
      nextInstructions: step.nextInstructions,
    };
  });

  const edges: EdgeInput[] = seed.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    condition: edge.condition,
  }));

  const spec: GraphSpec = { nodes, edges };
  await setGraph(workflow.id, spec, scope);

  return { workflowId: workflow.id, stepCount: nodes.length };
}
