"use strict";
/**
 * `dopl_map` — the compact workspace manifest. One call answers "what
 * exists here and where should I look": knowledge bases, skills and
 * ontology clusters, names + one-liners only. The routing entry point —
 * call before drilling into any domain tool.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMapTool = registerMapTool;
const narration_1 = require("./narration");
const ontology_clipped_1 = require("./ontology-clipped");
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
 * (`dopl_kb`, `dopl_skill`, `dopl_ontology`) are where the full prose lives,
 * rendered as content.
 */
const NO_NAME = "`(unnamed)`";
/**
 * THE SCOPE LINE, AND WHY IT IS NOT A NICETY.
 *
 * This description used to open "every knowledge base, skill, workflow cluster,
 * and ontology cluster". It is not every one of them and never was:
 * `listSkills` is visibility-filtered server-side and this file then drops
 * everything that is not `status === "active"` (below); `listKbBases` drops
 * bases the caller cannot read. Two agents on two machines compared their
 * `dopl_map` results, found "10 knowledge bases, 6 skills" against "4 KBs, 1
 * skill", believed the word "every", and jointly escalated a server-side
 * `dopl_map` bug to the operator. There was no bug — one caller was the owner
 * and the other a member, and five of six skills were owner-private. The tool
 * told them the counts were totals. They were a view.
 *
 * So the description states its own scope, and {@link SCOPE_NOTE} restates it
 * on the RESULT, where an agent that never read the description still meets it.
 * Both name the authoritative alternative rather than leaving "then what does
 * answer this?" as an exercise.
 */
const MAP_DESCRIPTION = `Curated routing manifest of the active workspace: the ACTIVE, caller-visible knowledge bases, skills and ontology clusters, with one-line descriptions and stable handles. It is a VIEW, not an inventory, so the counts here are not workspace totals: draft skills and anything scoped to a team you have no grant on are absent, and a domain that fails to load is NAMED in a PARTIAL READ notice on the result rather than passing as an empty section. For the authoritative inventory across every status and visibility use dopl_members(op="access_matrix"), which for an admin or owner enumerates every knowledge base and skill. Cheap; call at task start to decide where to look, then drill in with dopl_kb / dopl_skill / dopl_ontology. No parameters.`;
/**
 * Domains fanned out below — the denominator the PARTIAL READ notice reports
 * against. Three since the workflow retirement (2026-08-07): the Clusters and
 * Workflows reads went with the section they fed, so the denominator had to
 * come down with them or the notice would report "1 of 5" out of three.
 */
const DOMAIN_COUNT = 3;
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
const SCOPE_NOTE = `Scope: ACTIVE items visible to you. Draft skills and team-scoped items you have no grant on are not listed, so these counts are not workspace totals; a domain that could not be read is named in a PARTIAL READ notice opening this line, so with no such notice every section above was read. Authoritative inventory across every status and visibility: dopl_members(op="access_matrix").`;
/**
 * THE ONE DESTINATION THIS MANIFEST CANNOT LIST, named anyway.
 *
 * A fresh external session, told "ask Sam's agent what he did recently", spent
 * its first ten tool calls in this map, then in `dopl_members` three times, then
 * in the chat archive and the knowledge bases — and found the CHANNELS feature
 * only because a KB entry happened to mention a past exchange. Nothing in the
 * discovery surface named the contact path. This map lists knowledge bases,
 * skills, workflows and ontology; `dopl_channel` is DEFERRED in some clients, so
 * its own description is invisible until ToolSearch loads it and the tool NAME
 * is the only pre-discovery signal there is. A name does not say "this is how
 * you reach a person".
 *
 * IT IS STATIC, AND DELIBERATELY NOT A COUNT. Channels are a different service
 * (`client.listChannels`) from the domains fanned out below, so a count
 * would buy one more round trip on the call the instructions say to make FIRST,
 * add a fourth domain to the partial-read denominator, and splice another
 * member-typed name into the agent's opening picture of the workspace. The
 * routing sentence is the whole fix; the count is not part of it.
 *
 * IT SITS BELOW THE SCOPE NOTE, for the same reason. That note ends "every
 * section above was read", which is a claim about the domains this tool
 * actually queried — so a pointer to a domain it never queries must not be able
 * to sit underneath it and inherit that claim.
 *
 * It routes and nothing more: what a channel call costs, and who may make one,
 * are stated by `dopl_channel` itself, which stays the single source on that.
 */
const CHANNELS_ROUTING = `**Reaching a member or their agent: dopl_channel.** Channels are this workspace's live member-to-member and agent-to-agent messaging, and this manifest does not query them, so nothing above is a count of them. If dopl_channel is not in your tool list, load it with ToolSearch, then call dopl_channel(op="list") for the channels and DMs this account can post into.`;
function registerMapTool(register, client) {
    register("dopl_map", MAP_DESCRIPTION, {}, async () => {
        // Still fail-soft — one broken domain must not fail the manifest — but the
        // failure is now recorded instead of swallowed. The labels match the
        // section headings below so "Skills" in the notice names the section the
        // reader can see is empty.
        const reads = (0, partial_read_1.partialRead)();
        const [bases, skills, ontology] = await Promise.all([
            reads.soft("Knowledge bases", client.listKbBases(), []),
            reads.soft("Skills", client.listSkills(), []),
            // THE SUMMARY PROJECTION, NOT THE GRAPH (P0-3). This read used to be
            // `client.getOntology()` — four whole-table pulls shipping every JSONB
            // column the ontology has (`attributes`, capped at 100 entries of up to
            // 4000 chars each; `methods`; `template`; plus each cluster's `layout`)
            // — and the render below then used exactly two things from it: cluster
            // names and column names. None of that JSONB ever reached the output; it
            // only crossed the wire, on the ONE call the server instructions mandate
            // before every agent's first substantive reply. On a 366-object
            // workspace the difference measured 634 KB against 82 KB.
            //
            // `view: "summary"` asks the same endpoint for the same graph shape
            // without those columns and without the relationships table, so the
            // property this file cares about — every string rendered here is a
            // one-liner LABEL — is now also true of what we fetch.
            reads.soft("Ontology", client.getOntology({ view: "summary" }), EMPTY_ONTOLOGY),
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
        // The ontology read now carries a row ceiling (it had none, which is half
        // of what made it a launch blocker). A ceiling that renders identically to
        // an exhausted list is the failure this file already fixed once for
        // `op="resolve"`, so a clipped read says so where the section it clipped
        // is, not in a footer a skimmer drops.
        //
        // The WORDING moved to `ontology-clipped.ts` when three more summary-backed
        // reads inherited this line, and one clause of it was wrong: it sent a
        // clipped reader to `dopl_ontology(op="resolve")` and `op="get"`, both of
        // which read the workspace under the SAME ceiling. It reaches past the two
        // levels this manifest renders; it does not reach past the clip, and a
        // remedy that does not work is worse than none.
        if (ontology.truncated) {
            lines.push((0, ontology_clipped_1.clippedNote)("the clusters above are a prefix and not the set"));
        }
        // One footer line, not two: the partial-read notice prefixes the scope
        // note it belongs to. On the healthy path `notice()` is "" and this line
        // is byte-for-byte the scope note alone.
        lines.push("", `_${reads.notice(DOMAIN_COUNT, "domains")}${SCOPE_NOTE}_`);
        lines.push("", CHANNELS_ROUTING);
        return (0, respond_1.ok)(lines.join("\n"));
    });
}
