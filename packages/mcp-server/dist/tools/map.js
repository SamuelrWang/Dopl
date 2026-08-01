"use strict";
/**
 * `dopl_map` — the compact workspace manifest. One call answers "what
 * exists here and where should I look": knowledge bases, skills,
 * clusters/workflows, and ontology clusters, names + one-liners only.
 * The routing entry point — call before drilling into any domain tool.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMapTool = registerMapTool;
const narration_1 = require("./narration");
const partial_read_1 = require("./partial-read");
const respond_1 = require("./respond");
const EMPTY_ONTOLOGY = { clusters: [], objects: {} };
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
/**
 * THE SCOPE LINE, AND WHY IT IS NOT A NICETY.
 *
 * This description used to open "every knowledge base, skill, workflow cluster,
 * and ontology cluster". It is not every one of them and never was:
 * `listSkills` is visibility-filtered server-side and this file then drops
 * everything that is not `status === "active"` (below); `listWorkflows` drops
 * teams-mode workflows the caller has no grant on; `listKbBases` drops bases
 * the caller cannot read. Two agents on two machines compared their `dopl_map`
 * results, found "10 knowledge bases, 6 skills" against "4 KBs, 1 skill",
 * believed the word "every", and jointly escalated a server-side `dopl_map`
 * bug to the operator. There was no bug — one caller was the owner and the
 * other a member, and five of six skills were owner-private. The tool told
 * them the counts were totals. They were a view.
 *
 * So the description states its own scope, and {@link SCOPE_NOTE} restates it
 * on the RESULT, where an agent that never read the description still meets it.
 * Both name the authoritative alternative rather than leaving "then what does
 * answer this?" as an exercise.
 */
const MAP_DESCRIPTION = `Curated routing manifest of the active workspace: the ACTIVE, caller-visible knowledge bases, skills, workflows and ontology clusters, with one-line descriptions and stable handles. It is a VIEW, not an inventory, so the counts here are not workspace totals: draft skills, trashed items, and anything scoped to a team you have no grant on are absent, and a domain that fails to load is NAMED in a PARTIAL READ notice on the result rather than passing as an empty section. For the authoritative inventory across every status and visibility use dopl_members(op="access_matrix"), which for an admin or owner enumerates every knowledge base, workflow and skill. Cheap; call at task start to decide where to look, then drill in with dopl_kb / dopl_skill / dopl_workflow / dopl_ontology. No parameters.`;
/** Domains fanned out below — the denominator the PARTIAL READ notice reports against. */
const DOMAIN_COUNT = 5;
/**
 * The same fact on the result. Costs nothing: every clause is a property of the
 * query we already ran, so no second round trip is needed to state it. It names
 * the FILTER rather than a hidden count for exactly that reason — "how many did
 * you not show me" is a second query, "drafts are not shown" is free.
 *
 * The failure clause used to end "renders as an empty section rather than as an
 * error", which was true and is now the opposite of what we want it to say: an
 * unreadable domain is named in the PARTIAL READ prefix this line carries, so
 * the ABSENCE of that prefix is itself the reader's evidence that every section
 * below was actually read. Leaving the old wording would have kept telling
 * agents they cannot tell — which is the entire thing being fixed.
 */
const SCOPE_NOTE = `Scope: ACTIVE items visible to you. Draft skills, trashed items, and team-scoped items you have no grant on are not listed, so these counts are not workspace totals; a domain that could not be read is named in a PARTIAL READ notice opening this line, so with no such notice every section above was read. Authoritative inventory across every status and visibility: dopl_members(op="access_matrix").`;
function registerMapTool(register, client) {
    register("dopl_map", MAP_DESCRIPTION, {}, async () => {
        // Still fail-soft — one broken domain must not fail the manifest — but the
        // failure is now recorded instead of swallowed. The labels match the
        // section headings below so "Skills" in the notice names the section the
        // reader can see is empty.
        const reads = (0, partial_read_1.partialRead)();
        const [bases, skills, clusters, workflows, ontology] = await Promise.all([
            reads.soft("Knowledge bases", client.listKbBases(), []),
            reads.soft("Skills", client.listSkills(), []),
            reads.soft("Clusters", client.listClusters().then((r) => r.clusters), []),
            reads.soft("Workflows", client.listWorkflows().then((r) => r.workflows), []),
            reads.soft("Ontology", client.getOntology(), EMPTY_ONTOLOGY),
        ]);
        const lines = ["# Workspace map"];
        lines.push("", `## Knowledge bases (${bases.length}) — dopl_kb`);
        for (const b of bases) {
            const desc = b.description ? ` — ${(0, narration_1.inlineOr)(b.description, "")}` : "";
            lines.push(`- ${(0, narration_1.inlineOr)(b.name, NO_NAME)} \`${b.slug}\`${desc}`);
        }
        if (bases.length === 0)
            lines.push("_None._");
        const activeSkills = skills.filter((s) => s.status === "active");
        lines.push("", `## Skills (${activeSkills.length}) — dopl_skill`);
        for (const s of activeSkills) {
            const trigger = (0, narration_1.inlineOr)(s.whenToUse || s.description, "`(no trigger described)`");
            lines.push(`- ${(0, narration_1.inlineOr)(s.name, NO_NAME)} \`${s.slug}\` — ${trigger}`);
        }
        if (activeSkills.length === 0)
            lines.push("_None._");
        lines.push("", `## Workflows (${workflows.length}) — dopl_workflow`);
        for (const w of workflows) {
            const cluster = clusters.find((c) => c.id === w.cluster_id);
            const home = cluster ? ` · cluster: ${(0, narration_1.inlineOr)(cluster.name, NO_NAME)}` : "";
            const desc = w.description ? ` — ${(0, narration_1.inlineOr)(w.description, "")}` : "";
            lines.push(`- ${(0, narration_1.inlineOr)(w.name, NO_NAME)} \`${w.slug}\`${home}${desc}`);
        }
        if (workflows.length === 0)
            lines.push("_None._");
        lines.push("", `## Ontology (${ontology.clusters.length} clusters) — dopl_ontology`);
        for (const c of ontology.clusters) {
            const columns = c.columnIds
                .map((id) => ontology.objects[id]?.name)
                .filter((n) => Boolean(n))
                .map((n) => (0, narration_1.inlineOr)(n, NO_NAME))
                .join(", ");
            const purpose = c.purpose ? ` — ${(0, narration_1.inlineOr)(c.purpose, "")}` : "";
            lines.push(`- ${(0, narration_1.inlineOr)(c.name, NO_NAME)} \`${c.slug}\`${purpose}${columns ? ` (columns: ${columns})` : ""}`);
        }
        if (ontology.clusters.length === 0)
            lines.push("_None._");
        // One footer line, not two: the partial-read notice prefixes the scope
        // note it belongs to. On the healthy path `notice()` is "" and this line
        // is byte-for-byte the scope note alone.
        lines.push("", `_${reads.notice(DOMAIN_COUNT, "domains")}${SCOPE_NOTE}_`);
        return (0, respond_1.ok)(lines.join("\n"));
    });
}
