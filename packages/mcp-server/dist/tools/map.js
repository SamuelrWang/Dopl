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
const tool_errors_1 = require("./tool-errors");
const tool_style_1 = require("./tool-style");
/** ⚠ The same row `dopl_search` teaches — one fan-out failure, one code. */
const PARTIAL_READ_ERROR = tool_errors_1.SEARCH_ERRORS[0];
const EMPTY_ONTOLOGY = { clusters: [], objects: {} };
/**
 * ⚠ EVERY string this tool renders is a member-typed one-liner LABEL (KB name +
 * description, skill name + `when_to_use`, cluster name + purpose, column name)
 * and NONE carries a charset rule — only KB folder names and entry titles do,
 * via `NAME_RE`. Newlines, backticks and `##` are all legal.
 *
 * Worse here than almost anywhere: the server instructions make `dopl_map` the
 * FIRST call before an agent's first substantive reply, and this result is a
 * flat bullet list — a description with a newline starts a line of its own in
 * the agent's opening picture of the workspace. So every field goes through the
 * neutralizer; `dopl_kb` / `dopl_skill` / `dopl_ontology` render full prose.
 */
const NO_NAME = "`(unnamed)`";
/**
 * ⚠ THE DESCRIPTION MUST STATE ITS OWN SCOPE. This is a VIEW, never an
 * inventory: `listSkills` is visibility-filtered server-side and this file then
 * drops non-`active`; `listKbBases` drops unreadable bases. Two agents once
 * compared "10 KBs, 6 skills" against "4 KBs, 1 skill", believed the word
 * "every", and escalated a nonexistent server bug — one was owner, one member.
 * {@link SCOPE_NOTE} restates it on the RESULT for an agent that never read the
 * description, and both name the authoritative alternative.
 */
const MAP_DESCRIPTION = (0, tool_style_1.composeDescription)({
    headline: "Routing manifest of this workspace: ACTIVE, caller-visible knowledge bases, skills and ontology clusters, one line each, with handles.",
    policy: "Read-only. No parameters.",
    routing: [
        'Use dopl_members(op="access_matrix") for the inventory across status and visibility.',
        "Use dopl_kb / dopl_skill / dopl_ontology to drill in.",
    ],
    body: [
        "A VIEW, not an inventory: these counts are not workspace totals, and an unread domain is NAMED with reason=partial_read. Call at task start.",
    ],
    errors: [PARTIAL_READ_ERROR],
    examples: [{}],
    cap: tool_style_1.READ_DESCRIPTION_MAX_CHARS,
});
/**
 * ⚠ Denominator the PARTIAL READ notice reports against. Must equal the count
 * of reads fanned out below — never a constant maintained beside them.
 */
const DOMAIN_COUNT = 3;
/**
 * Same fact on the result. ⚠ Names the FILTER, never a hidden count — "how many
 * did you not show me" is a second query, "drafts are not shown" is free. ⚠ Says
 * the absence of a PARTIAL READ prefix proves every section was read; do not
 * revert to "an unreadable domain renders as an empty section".
 */
const SCOPE_NOTE = `Scope: ACTIVE items visible to you. Draft skills and team-scoped items you have no grant on are not listed, so these counts are not workspace totals; a domain that could not be read is named with reason=partial_read opening this line, so with no such notice every section above was read. Authoritative inventory across every status and visibility: dopl_members(op="access_matrix").`;
/**
 * The one destination this manifest cannot list, named anyway. `dopl_channel`
 * is DEFERRED in some clients, so its description is invisible until ToolSearch
 * loads it and the NAME is the only pre-discovery signal — a name does not say
 * "this is how you reach a person".
 *
 * ⚠ STATIC, deliberately NOT a count: channels are a different service
 * (`client.listChannels`), so a count buys a round trip on the call the
 * instructions mandate FIRST, adds a fourth domain to the partial-read
 * denominator, and splices another member-typed name into the opening picture.
 *
 * ⚠ Must sit BELOW the scope note — that note ends "every section above was
 * read", a claim about domains this tool queried, and a pointer to one it never
 * queries must not inherit it. Routes and nothing more; cost and permissions
 * are `dopl_channel`'s to state.
 */
const CHANNELS_ROUTING = `**Reaching a member or their agent: dopl_channel.** Channels are this workspace's live member-to-member and agent-to-agent messaging, and this manifest does not query them, so nothing above is a count of them. If dopl_channel is not in your tool list, load it with ToolSearch, then call dopl_channel(op="list") for the channels and DMs this account can post into.`;
function registerMapTool(register, client) {
    register("dopl_map", MAP_DESCRIPTION, {}, async () => {
        // ⚠ Fail-soft — one broken domain must not fail the manifest — but record
        // the failure, never swallow it. Labels must match the section headings
        // below so the notice names the section the reader sees empty.
        const reads = (0, partial_read_1.partialRead)();
        const [bases, skills, ontology] = await Promise.all([
            reads.soft("Knowledge bases", client.listKbBases(), []),
            reads.soft("Skills", client.listSkills(), []),
            // ⚠ SUMMARY PROJECTION, NOT THE GRAPH. A bare `getOntology()` ships every
            // JSONB column (`attributes` up to 100×4000 chars, `methods`, `template`,
            // each cluster's `layout`) plus relationships, and the render uses exactly
            // two things: cluster names and column names. Measured 634 KB vs 82 KB on
            // a 366-object workspace — on the ONE call mandated before every agent's
            // first substantive reply.
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
        // ⚠ A ceiling that renders identically to an exhausted list is the bug, so
        // a clipped read says so BESIDE the section it clipped, not in a footer.
        // Wording lives in `ontology-clipped.ts` — ⚠ do not send a clipped reader
        // to `dopl_ontology(op="resolve"|"get")`: both read under the SAME ceiling.
        if (ontology.truncated) {
            lines.push((0, ontology_clipped_1.clippedNote)("the clusters above are a prefix and not the set"));
        }
        // One footer line, not two — the partial-read notice PREFIXES the scope
        // note. On the healthy path `notice()` is "" and this is the note alone.
        lines.push("", `_${reads.notice(DOMAIN_COUNT, "domains")}${SCOPE_NOTE}_`);
        lines.push("", CHANNELS_ROUTING);
        return (0, respond_1.ok)(lines.join("\n"));
    });
}
