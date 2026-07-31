/**
 * `dopl_map` — the compact workspace manifest. One call answers "what
 * exists here and where should I look": knowledge bases, skills,
 * clusters/workflows, and ontology clusters, names + one-liners only.
 * The routing entry point — call before drilling into any domain tool.
 */

import type { DoplClient, OntologySnapshot } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, type RegisterTool, type ToolResponse } from "./respond";

const EMPTY_ONTOLOGY: OntologySnapshot = { clusters: [], objects: {} };

/**
 * EVERY string this tool renders is a one-liner LABEL, and every one of them is
 * typed by a workspace member: a knowledge base's name and description, a
 * skill's name and `when_to_use`, a workflow's name and description, an
 * ontology cluster's name and purpose, a column's name. None carries a charset
 * rule anywhere in the product (only KB folder names and entry titles do, via
 * `NAME_RE`) — so newlines, backticks and `##` are all legal in all of them.
 *
 * That matters more here than almost anywhere else: the server instructions
 * tell the agent to call `dopl_map` FIRST, before its first substantive reply,
 * and this result is a flat list of bullets. A description with a newline in it
 * did not just wrap — it started a line of its own in the agent's opening
 * picture of the workspace.
 *
 * A manifest is names and one-liners by definition, so every field here is a
 * value and every field goes through the neutralizer. The tools it routes to
 * (`dopl_kb`, `dopl_skill`, `dopl_workflow`) are where the full prose lives,
 * rendered as content.
 */
const NO_NAME = "`(unnamed)`";

const MAP_DESCRIPTION = `Compact manifest of the active workspace — every knowledge base, skill, workflow cluster, and ontology cluster with one-line descriptions and stable handles. Cheap; call at task start to decide where to look, then drill in with dopl_kb / dopl_skill / dopl_workflow / dopl_ontology. No parameters.`;

export function registerMapTool(register: RegisterTool, client: DoplClient): void {
  register("dopl_map", MAP_DESCRIPTION, {}, async (): Promise<ToolResponse> => {
    const [bases, skills, clusters, workflows, ontology] = await Promise.all([
      client.listKbBases().catch(() => []),
      client.listSkills().catch(() => []),
      client.listClusters().then((r) => r.clusters).catch(() => []),
      client.listWorkflows().then((r) => r.workflows).catch(() => []),
      client.getOntology().catch(() => EMPTY_ONTOLOGY),
    ]);

    const lines: string[] = ["# Workspace map"];

    lines.push("", `## Knowledge bases (${bases.length}) — dopl_kb`);
    for (const b of bases) {
      const desc = b.description ? ` — ${inlineOr(b.description, "")}` : "";
      lines.push(`- ${inlineOr(b.name, NO_NAME)} \`${b.slug}\`${desc}`);
    }
    if (bases.length === 0) lines.push("_None._");

    const activeSkills = skills.filter((s) => s.status === "active");
    lines.push("", `## Skills (${activeSkills.length}) — dopl_skill`);
    for (const s of activeSkills) {
      const trigger = inlineOr(s.whenToUse || s.description, "`(no trigger described)`");
      lines.push(`- ${inlineOr(s.name, NO_NAME)} \`${s.slug}\` — ${trigger}`);
    }
    if (activeSkills.length === 0) lines.push("_None._");

    lines.push("", `## Workflows (${workflows.length}) — dopl_workflow`);
    for (const w of workflows) {
      const cluster = clusters.find((c) => c.id === w.cluster_id);
      const home = cluster ? ` · cluster: ${inlineOr(cluster.name, NO_NAME)}` : "";
      const desc = w.description ? ` — ${inlineOr(w.description, "")}` : "";
      lines.push(`- ${inlineOr(w.name, NO_NAME)} \`${w.slug}\`${home}${desc}`);
    }
    if (workflows.length === 0) lines.push("_None._");

    lines.push("", `## Ontology (${ontology.clusters.length} clusters) — dopl_ontology`);
    for (const c of ontology.clusters) {
      const columns = c.columnIds
        .map((id) => ontology.objects[id]?.name)
        .filter((n): n is string => Boolean(n))
        .map((n) => inlineOr(n, NO_NAME))
        .join(", ");
      const purpose = c.purpose ? ` — ${inlineOr(c.purpose, "")}` : "";
      lines.push(
        `- ${inlineOr(c.name, NO_NAME)} \`${c.slug}\`${purpose}${columns ? ` (columns: ${columns})` : ""}`
      );
    }
    if (ontology.clusters.length === 0) lines.push("_None._");

    return ok(lines.join("\n"));
  });
}
