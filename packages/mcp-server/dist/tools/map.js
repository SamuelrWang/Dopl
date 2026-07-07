"use strict";
/**
 * `dopl_map` — the compact workspace manifest. One call answers "what
 * exists here and where should I look": knowledge bases, skills,
 * clusters/workflows, and ontology clusters, names + one-liners only.
 * The routing entry point — call before drilling into any domain tool.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMapTool = registerMapTool;
const respond_1 = require("./respond");
const EMPTY_ONTOLOGY = { clusters: [], objects: {} };
const MAP_DESCRIPTION = `Compact manifest of the active workspace — every knowledge base, skill, workflow cluster, and ontology cluster with one-line descriptions and stable handles. Cheap; call at task start to decide where to look, then drill in with dopl_kb / dopl_skill / dopl_workflow / dopl_ontology. No parameters.`;
function registerMapTool(register, client) {
    register("dopl_map", MAP_DESCRIPTION, {}, async () => {
        const [bases, skills, clusters, workflows, ontology] = await Promise.all([
            client.listKbBases().catch(() => []),
            client.listSkills().catch(() => []),
            client.listClusters().then((r) => r.clusters).catch(() => []),
            client.listWorkflows().then((r) => r.workflows).catch(() => []),
            client.getOntology().catch(() => EMPTY_ONTOLOGY),
        ]);
        const lines = ["# Workspace map"];
        lines.push("", `## Knowledge bases (${bases.length}) — dopl_kb`);
        for (const b of bases) {
            lines.push(`- **${b.name}** \`${b.slug}\`${b.description ? ` — ${b.description}` : ""}`);
        }
        if (bases.length === 0)
            lines.push("_None._");
        const activeSkills = skills.filter((s) => s.status === "active");
        lines.push("", `## Skills (${activeSkills.length}) — dopl_skill`);
        for (const s of activeSkills) {
            lines.push(`- **${s.name}** \`${s.slug}\` — ${s.whenToUse || s.description}`);
        }
        if (activeSkills.length === 0)
            lines.push("_None._");
        lines.push("", `## Workflows (${workflows.length}) — dopl_workflow`);
        for (const w of workflows) {
            const cluster = clusters.find((c) => c.id === w.cluster_id);
            const home = cluster ? ` · cluster: ${cluster.name}` : "";
            lines.push(`- **${w.name}** \`${w.slug}\`${home}${w.description ? ` — ${w.description}` : ""}`);
        }
        if (workflows.length === 0)
            lines.push("_None._");
        lines.push("", `## Ontology (${ontology.clusters.length} clusters) — dopl_ontology`);
        for (const c of ontology.clusters) {
            const columns = c.columnIds
                .map((id) => ontology.objects[id]?.name)
                .filter(Boolean)
                .join(", ");
            lines.push(`- **${c.name}** \`${c.slug}\`${c.purpose ? ` — ${c.purpose}` : ""}${columns ? ` (columns: ${columns})` : ""}`);
        }
        if (ontology.clusters.length === 0)
            lines.push("_None._");
        return (0, respond_1.ok)(lines.join("\n"));
    });
}
