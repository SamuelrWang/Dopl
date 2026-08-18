"use strict";
/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills and ontology objects match on their name/trigger metadata.
 * Every hit carries the stable handle for the follow-up read.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSearchTool = registerSearchTool;
const zod_1 = require("zod");
const narration_1 = require("./narration");
const ontology_clipped_1 = require("./ontology-clipped");
const partial_read_1 = require("./partial-read");
const respond_1 = require("./respond");
const EMPTY_ONTOLOGY = { clusters: [], objects: {} };
/** A result with nothing nameable left after neutralization. */
const NO_NAME = "`(unnamed)`";
/**
 * A knowledge-entry search snippet, as a VALUE. ⚠ Do not turn the backend's
 * `<b>` highlight tags into `**` — that adds our own markdown to text we do not
 * control, on an unframed bullet line. A snippet is an EXCERPT OF A BODY
 * spliced into narration; drop the tags and neutralize.
 */
function snippet(raw) {
    return (0, narration_1.inlineOr)(raw.replace(/<\/?b>/g, ""), "`(no snippet)`");
}
const SEARCH_DESCRIPTION = `Ranked search across THREE domains at once: knowledge entries, skills, and ontology objects. Returns grouped hits with the handle to read each: dopl_kb(op="read_file"), dopl_skill(op="get"), dopl_ontology(op="get"). Prefer this over per-domain listing when you don't already know where something lives.

WHAT IT DOES NOT COVER, because a miss here is not evidence of absence: the CHAT ARCHIVE, members, teams and channels are not searched at all (dopl_chats(op="list", query=...) is the archive's own filter). Only knowledge entries are matched on their BODIES; skills and ontology objects are matched on names and short trigger metadata only, so a term that appears solely inside a SKILL.md will not be found. Only ACTIVE skills are searched, and only what you can see. Every group is capped at \`limit\`; a group whose backing read FAILED still shows "No matches", but the failure is NAMED in a PARTIAL READ notice on the result, so a group with no such notice against it really was searched.

Params: query (required; all terms must appear, punctuation-folded), limit (max hits per group, default 8).`;
/**
 * "Showing N of M" for one group, or nothing when untruncated. ⚠ Both numbers
 * come from a list already in memory (the cap is applied HERE), so it is free —
 * the test a result-side scope line has to pass.
 */
function more(matched, shown, noun) {
    return matched > shown
        ? [`_Showing ${shown} of ${matched} matching ${noun}. Raise \`limit\` or narrow the query._`]
        : [];
}
/**
 * ⚠ "No matches" IS THE WEAKEST LINE IN THIS RESULT. Two of the three groups
 * match on NAMES AND TRIGGER METADATA ONLY, the chat archive is not searched at
 * all, and drafts are excluded from skills — so "the workspace does not contain
 * X" is wrong three ways, and the description does not reach an agent that
 * already called the tool.
 *
 * ⚠ A FAILED group renders like an empty one under `.catch(() => [])`. It still
 * shows "No matches" (one broken domain must not fail the search), but `notice`
 * NAMES it, and the footer says a group not named there really was searched.
 */
function scopeNote(limit, notice) {
    return `_${notice}Scope: max ${limit} per group. Only knowledge entries are matched on their BODIES; skills and ontology objects on names and trigger metadata only, so a term living inside a SKILL.md is not findable here. Drafts are excluded from Skills. The CHAT ARCHIVE is not searched at all (dopl_chats(op="list", query=...)). A group whose read failed still shows "No matches" and is named in a PARTIAL READ notice opening this line; no group here is proof of absence._`;
}
function registerSearchTool(register, client) {
    register("dopl_search", SEARCH_DESCRIPTION, {
        query: zod_1.z.string().min(1).describe("What to find."),
        // ⚠ coerce: MCP clients sometimes send numbers as strings, which strict
        // z.number() rejects with an opaque -32602.
        limit: zod_1.z.coerce.number().int().min(1).max(25).optional().describe("Max hits per group (default 8)."),
    }, async (args) => {
        const limit = args.limit ?? 8;
        // Tokenize + punctuation-fold query AND haystack so "duplicate name"
        // matches "duplicate-name", word order is free, and every term must
        // appear (AND). ⚠ A whitespace- or punctuation-only query yields zero
        // terms → matches NOTHING; a whole-query `.includes()` instead misses
        // near-verbatim multi-word queries and dumps everything for a lone space.
        // Governs skills/objects only — knowledge uses the backend hybrid search.
        const fold = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const terms = fold(args.query).split(" ").filter(Boolean);
        const matches = (...fields) => {
            if (terms.length === 0)
                return false;
            const hay = ` ${fields.map((f) => fold(f ?? "")).join(" ")} `;
            return terms.every((t) => hay.includes(t));
        };
        // ⚠ Fail-soft (one broken domain must not fail the search) but RECORD the
        // failure. Labels must match the group headings below.
        const reads = (0, partial_read_1.partialRead)();
        const [entryHits, skills, ontology] = await Promise.all([
            reads.soft("Knowledge entries", client.searchKb(args.query, { limit }), []),
            reads.soft("Skills", client.listSkills(), []),
            // ⚠ SUMMARY PROJECTION, NOT THE GRAPH. This group uses four fields
            // (`name`, `subtitle`, `id`, `childIds`), all in the cheap view; a bare
            // `getOntology()` ships every `attributes`, `methods`, `template` and
            // cluster `layout` — 634 KB vs 82 KB on a 366-object workspace, on a
            // tool agents call speculatively and often.
            reads.soft("Ontology objects", client.getOntology({ view: "summary" }), EMPTY_ONTOLOGY),
        ]);
        // ⚠ Caller's own argument, but a backtick still escapes this span and
        // puts the tail back into the heading.
        const lines = [`# Search: ${(0, narration_1.inlineOr)(args.query, "`(unreadable query)`")}`];
        lines.push("", "## Knowledge entries");
        if (entryHits.length === 0)
            lines.push("_No matches._");
        for (const h of entryHits.slice(0, limit)) {
            lines.push(`- ${(0, narration_1.inlineOr)(h.title, NO_NAME)} (entry id: \`${h.entryId}\`) — ${snippet(h.snippet)}`);
        }
        // ⚠ Without this line a capped group and an exhausted one render
        // identically. Free: `.slice(limit)` discards matches already counted.
        const skillMatches = skills.filter((s) => s.status === "active" && matches(s.name, s.description, s.whenToUse));
        const skillHits = skillMatches.slice(0, limit);
        lines.push("", "## Skills");
        if (skillHits.length === 0)
            lines.push("_No matches._");
        for (const s of skillHits) {
            const trigger = (0, narration_1.inlineOr)(s.whenToUse || s.description, "`(no trigger described)`");
            lines.push(`- ${(0, narration_1.inlineOr)(s.name, NO_NAME)} \`${s.slug}\` — ${trigger}`);
        }
        lines.push(...more(skillMatches.length, skillHits.length, "skills"));
        const objectMatches = Object.values(ontology.objects).filter((o) => matches(o.name, o.subtitle));
        const objectHits = objectMatches.slice(0, limit);
        lines.push("", "## Ontology objects");
        if (objectHits.length === 0)
            lines.push("_No matches._");
        const containerOf = (id) => {
            const name = Object.values(ontology.objects).find((c) => c.childIds.includes(id))?.name;
            // ⚠ Container name is another object's member-typed name — only the
            // "column" fallback is ours.
            return name ? (0, narration_1.inlineOr)(name, NO_NAME) : "column";
        };
        for (const o of objectHits) {
            const subtitle = o.subtitle ? ` — ${(0, narration_1.inlineOr)(o.subtitle, "")}` : "";
            lines.push(`- ${(0, narration_1.inlineOr)(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`);
        }
        lines.push(...more(objectMatches.length, objectHits.length, "ontology objects"));
        // ⚠ A CLIPPED read differs from a capped GROUP: `more()` reports what the
        // cap hid from a set we scanned, while a clip means the scanned set was
        // itself a prefix — so "No matches" would claim something about objects
        // this call never saw. Sits WITH the group it qualifies, not the footer.
        if (ontology.truncated) {
            lines.push((0, ontology_clipped_1.clippedNote)("the ontology group searched a prefix of the graph and a match outside it could not appear"));
        }
        // ⚠ GROUPS, not domains — the denominator must move with the reads above,
        // never independently of them.
        lines.push("", scopeNote(limit, reads.notice(3, "groups")));
        return (0, respond_1.ok)(lines.join("\n"));
    });
}
