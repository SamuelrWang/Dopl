"use strict";
/**
 * `dopl_kb(op="search")` — the base-scoped entry search, split out of
 * `knowledge-ops-read.ts` for the 500-line cap (2026-09-18).
 *
 * ⚠ **THE SEAM IS THE SUBJECT.** Everything left behind renders a STRUCTURE the
 * caller already knows the address of (a base list, a tree, a directory, one
 * document); this answers "where does X live" and is the only read op whose
 * result is a RANKING. That difference is why its scope note has to disclose
 * three invisible reductions the others do not have.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opSearch = opSearch;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const channel_shared_1 = require("./channel-shared");
/**
 * 🔒 **A HIT'S ADDRESS, NOT JUST ITS ID** (Wave 4, 2026-09-18). A search result
 * that carries only `entryId` hands the agent a handle no read op takes as a
 * PATH, so the agent that found the right entry still had to hunt for where it
 * lived — the exact shape "hand, don't hunt" refuses.
 *
 * ⚠ §8 STALE-CACHE, SPELLED INLINE: `baseSlug` and `path` are keys an older
 * server does not send, so each is rendered only when present and the entry id
 * — which has always been there — stays on the row as the durable handle.
 */
function hitAddress(h) {
    const address = h.path && h.baseSlug
        ? `base \`${h.baseSlug}\`, path ${(0, narration_1.inlineOr)(h.path, narration_1.NO_PATH)}`
        : h.path
            ? `path ${(0, narration_1.inlineOr)(h.path, narration_1.NO_PATH)}`
            : null;
    return address
        ? `${address} · entry id: \`${h.entryId}\``
        : `entry id: \`${h.entryId}\``;
}
async function opSearch(client, query, base, limit) {
    // ⚠ `base` accepts a slug OR a UUID, but the search endpoint narrows by SLUG
    // only — resolve first; a UUID forwarded to `baseSlug` 404s with
    // KNOWLEDGE_BASE_NOT_FOUND.
    let baseSlug;
    if (base) {
        const resolved = await (0, knowledge_shared_1.resolveBaseOr)(client, base);
        if ((0, channel_shared_1.isErr)(resolved))
            return resolved;
        baseSlug = resolved.slug;
    }
    const hits = await client.searchKb(query, { baseSlug, limit });
    const shownQuery = (0, narration_1.inlineOr)(query, "`(unreadable query)`");
    if (hits.length === 0) {
        return (0, respond_1.ok)(`No matches for ${shownQuery}. ${SEARCH_SCOPE_NOTE}`);
    }
    const lines = [`## ${hits.length} match${hits.length === 1 ? "" : "es"} for ${shownQuery}\n`];
    for (const h of hits) {
        // ⚠ Do not turn highlight tags into `**` — that is our own markdown wrapped
        // around an excerpt of a member-authored body on an unframed line.
        const cleanSnippet = (0, narration_1.inlineOr)(h.snippet.replace(/<\/?b>/g, ""), "`(no snippet)`");
        lines.push(`- ${(0, narration_1.inlineOr)(h.title, narration_1.NO_NAME)} _(rank ${h.rank.toFixed(2)})_ — ${hitAddress(h)}\n  ${cleanSnippet}`);
    }
    lines.push("", SEARCH_SCOPE_NOTE);
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * ⚠ A SHORT RESULT LIST IS NOT AN ANSWER. Three invisible reductions apply: the
 * ranking RPC caps its CANDIDATE set per leg before fusing, drops chunks past a
 * semantic-distance cutoff, and `search.ts` removes hits in unreadable bases
 * AFTER ranking. So `limit` is an upper bound the result routinely falls short
 * of for reasons unrelated to how much matched, and "2 matches" read as "there
 * are two" is a recall-capped, visibility-filtered sample read as a census.
 *
 * ⚠ States the SHAPE, not a number — the true count needs another query.
 */
const SEARCH_SCOPE_NOTE = `_A ranked SAMPLE of the bases you can read, not an exhaustive scan: candidates are capped before ranking, distant matches are dropped, and hits in bases you cannot read are removed after ranking. Fewer hits than \`limit\` does not mean there are no others, and zero hits is not proof of absence — try op="get_tree" or different wording._`;
