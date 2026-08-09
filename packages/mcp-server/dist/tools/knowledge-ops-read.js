"use strict";
/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opListBases = opListBases;
exports.opGetTree = opGetTree;
exports.opListDir = opListDir;
exports.opReadFile = opReadFile;
exports.opSearch = opSearch;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
/**
 * WHAT IS AND ISN'T NEUTRALIZED IN A KNOWLEDGE READ.
 *
 * A published base is workspace-visible, so every name, description, title and
 * excerpt below can have been typed by another member. The two halves get
 * different treatment on purpose:
 *
 *   - NAMES, TITLES, DESCRIPTIONS, EXCERPTS are spliced into lines we wrote —
 *     a `## ` heading, a `- **…**` row, a `📁 name/` tree row. They are values,
 *     and they go through the neutralizer. Only folder names and entry titles
 *     carry a charset rule today (`NAME_RE`, features/knowledge/schema.ts); base
 *     names, base descriptions, folder descriptions and entry excerpts are
 *     bounded by LENGTH ONLY, so a newline in any of them started a line.
 *
 *   - THE ENTRY BODY is not touched. It is the document the user wrote for the
 *     agent to read and act on; stripping its markdown would break the product.
 *     `read_file` renders it below a `---` rule, as itself — but, since 2026-08-08,
 *     under {@link UNTRUSTED_ENTRY_BODY_HEADER} when the document is ANOTHER
 *     MEMBER'S. Rendering it as itself was never the gap; rendering it as itself
 *     with nothing saying whose it was is. See that constant for the shared- vs.
 *     solo-workspace distinction F-101 recorded on only one of the two surfaces.
 */
const NO_NAME = "`(unnamed)`";
/**
 * WHOSE VIEW THIS IS, stated on the result rather than only in the description.
 *
 * `listBases` is filtered twice server-side before a row reaches us
 * (`canSeeBase` drops another member's private bases; `filterTeamVisibleBases`
 * drops teams-mode bases with no grant, and FAILS CLOSED to an empty list).
 * Neither left a trace in
 * the output, so "## Knowledge bases" over four rows read as the workspace
 * having four — the same inference that had two agents escalate a nonexistent
 * `dopl_map` bug after comparing "10 KBs" with "4 KBs".
 *
 * Names the FILTERS, not a hidden count: counting what you were not shown is a
 * second query on every list call.
 */
const BASES_SCOPE_NOTE = `_Bases you can READ. Another member's private bases and bases scoped to a team you have no grant on are not listed, so this is not the workspace's base count. Full inventory across every visibility: dopl_members(op="access_matrix")._`;
async function opListBases(client) {
    const bases = await client.listKbBases();
    if (bases.length === 0)
        return (0, respond_1.ok)(`No knowledge bases visible to you. ${BASES_SCOPE_NOTE}\n\nCreate one with \`dopl_kb(op='create_base')\`.`);
    const lines = ["## Knowledge bases\n"];
    for (const b of bases) {
        // Surface the immutable id alongside the slug (the slug changes on
        // rename; the id is a stable handle) plus the access signal.
        const vis = b.visibility === "private" ? "private" : "public";
        const desc = b.description ? `\n  ${(0, narration_1.inlineOr)(b.description, "")}` : "";
        lines.push(`- ${(0, narration_1.inlineOr)(b.name, NO_NAME)} (slug: \`${b.slug}\` · id: \`${b.id}\` · ${vis})${desc}`);
    }
    lines.push("", BASES_SCOPE_NOTE);
    return (0, respond_1.ok)(lines.join("\n"));
}
const TREE_ENTRY_CAP = 400;
const TREE_ENTRY_MAX = 1000;
async function opGetTree(client, ref, entryLimit, entryCursor) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    // Entries are paged at the API (folders always ship in full), so the
    // wire payload matches what gets rendered instead of always shipping
    // the whole base.
    const limit = Math.min(Math.max(1, Math.floor(entryLimit ?? TREE_ENTRY_CAP)), TREE_ENTRY_MAX);
    const tree = await client.getKbTree(base.id, {
        entryLimit: limit,
        entryCursor,
    });
    const entryTotal = tree.entryTotal ?? tree.entries.length;
    const vis = tree.base.visibility === "private" ? "private" : "public";
    const lines = [
        `## ${(0, narration_1.inlineOr)(tree.base.name, NO_NAME)} \`${tree.base.slug}\``,
        `id: \`${tree.base.id}\` · ${vis} · agent-write ${tree.base.agentWriteEnabled ? "on" : "off"}`,
        ...(tree.base.description ? [(0, narration_1.inlineOr)(tree.base.description, "")] : []),
        `Folders: ${tree.folders.length} · Entries: ${entryTotal}${tree.entries.length < entryTotal ? ` (showing ${tree.entries.length})` : ""}`,
        "",
    ];
    // Build a tree view by walking parent_id / folder_id.
    const childFolders = new Map();
    for (const f of tree.folders) {
        const arr = childFolders.get(f.parentId) ?? [];
        arr.push(f);
        childFolders.set(f.parentId, arr);
    }
    for (const arr of childFolders.values())
        arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const childEntries = new Map();
    for (const e of tree.entries) {
        const arr = childEntries.get(e.folderId) ?? [];
        arr.push(e);
        childEntries.set(e.folderId, arr);
    }
    for (const arr of childEntries.values())
        arr.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    function dump(parentId, prefix) {
        for (const f of childFolders.get(parentId) ?? []) {
            lines.push(`${prefix}📁 ${(0, narration_1.inlineOr)(f.name, NO_NAME)}/${descSuffix(f.description)}`);
            dump(f.id, prefix + "  ");
        }
        for (const e of childEntries.get(parentId) ?? []) {
            lines.push(`${prefix}📄 ${(0, narration_1.inlineOr)(e.title, NO_NAME)}${descSuffix(e.excerpt)}`);
        }
    }
    dump(null, "");
    if (tree.nextEntryCursor) {
        lines.push("", `_Showing ${tree.entries.length} of ${entryTotal} entries. Pass entry_cursor="${tree.nextEntryCursor}" for the next page, or narrow with op="list_dir" / op="search"._`);
    }
    else {
        // The paging notice above only fires when there IS a next page, so the
        // complete case said nothing at all about its own scope. Both halves
        // genuinely ship in full here; say so rather than leaving it implied.
        lines.push("", `_Folders complete; entries complete for this base._`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * ` — description` suffix for tree / directory rows. Folder `description` and
 * entry `excerpt` are the user-curated, agent-facing summaries (≤300 chars) —
 * surfacing them here lets agents pick the right file from a listing instead of
 * read_file-ing everything.
 *
 * This used to hand-roll its own flatten-and-truncate: `\s*\n+\s*` → space,
 * then a 120-char clip. That closed the obvious newline but not the rest —
 * U+0085 (NEL) is not in JavaScript's `\s` class and survives it, and nothing
 * touched backticks or `**`. It now defers to the shared neutralizer, which is
 * the point of having one: the row is bounded, flattened, and rendered as a
 * value, by the same rule as every other label in this tool set. Only renders
 * the separator when something survives.
 */
function descSuffix(text) {
    if (!text)
        return "";
    const rendered = (0, narration_1.inlineOr)(text, "");
    return rendered ? ` — ${rendered}` : "";
}
async function opListDir(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    const listing = await client.listKbDirByPath(base.id, path ?? "");
    const lines = [];
    const where = listing.folder ? (0, narration_1.inlineOr)(listing.folder.name, NO_NAME) : "(root)";
    lines.push(`## ${(0, narration_1.inlineOr)(base.name, NO_NAME)} → ${where}`);
    if (listing.folder?.description)
        lines.push((0, narration_1.inlineOr)(listing.folder.description, ""));
    if (listing.folders.length === 0 && listing.entries.length === 0) {
        lines.push("Empty.");
    }
    else {
        for (const f of listing.folders)
            lines.push(`📁 ${(0, narration_1.inlineOr)(f.name, NO_NAME)}/${descSuffix(f.description)}`);
        for (const e of listing.entries)
            lines.push(`📄 ${(0, narration_1.inlineOr)(e.title, NO_NAME)}${descSuffix(e.excerpt)}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opReadFile(client, ref, path, 
// The caller's own user id (`CallerIdentity.userId`), or null when auth could
// not resolve one. Only the FRAMING reads it — nothing about which entries are
// readable is decided here, that is the server's job and it already ran.
callerUserId = null) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    const entry = await client.readKbFileByPath(base.id, path);
    const lines = [
        // FRAMING FIRST, and only for a document this caller did not write. A header
        // after the body is read after the injected instruction has been read.
        ...((0, narration_1.isForeignAuthored)(entry, callerUserId)
            ? [knowledge_shared_1.UNTRUSTED_ENTRY_BODY_HEADER, ""]
            : []),
        // The title is a heading; the BODY below the `---` is the document itself
        // and is deliberately untouched.
        `# ${(0, narration_1.inlineOr)(entry.title, NO_NAME)}`,
        `Path: \`${path}\` · entry id: \`${entry.id}\` · type: ${entry.entryType}`,
        `Version: \`${entry.updatedAt}\` (pass as expected_version to write_file) · last edited by ${entry.lastEditedSource} · created ${entry.createdAt}`,
        "",
        "---",
        "",
        entry.body,
    ];
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opSearch(client, query, base, limit) {
    // F-16: `base` accepts a slug OR a UUID, like every other op. Resolve it
    // the same way the other ops do (the search endpoint only narrows by
    // slug, so pass the resolved base's slug through) instead of forwarding a
    // UUID straight to `baseSlug`, which would 404 with KNOWLEDGE_BASE_NOT_FOUND.
    let baseSlug;
    if (base) {
        const resolved = await (0, knowledge_shared_1.resolveBaseOr)(client, base);
        if ((0, knowledge_shared_1.isErr)(resolved))
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
        // The highlight tags used to become `**` — our own markdown, wrapped around
        // an excerpt of a member-authored body and dropped onto an indented line
        // with no framing. Drop the tags and render the excerpt as a value instead;
        // the words are what make a hit pickable, the bold was a nicety.
        const cleanSnippet = (0, narration_1.inlineOr)(h.snippet.replace(/<\/?b>/g, ""), "`(no snippet)`");
        lines.push(`- ${(0, narration_1.inlineOr)(h.title, NO_NAME)} _(rank ${h.rank.toFixed(2)})_ — entry id: \`${h.entryId}\`\n  ${cleanSnippet}`);
    }
    lines.push("", SEARCH_SCOPE_NOTE);
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * WHY A SHORT RESULT LIST IS NOT AN ANSWER.
 *
 * The heading counts the hits that survived, and nothing said what they
 * survived. Three separate reductions apply and none is visible: the ranking
 * RPC caps its CANDIDATE set per leg before fusing them, drops chunks past a
 * semantic-distance cutoff, and then `search.ts` removes hits in bases this
 * caller cannot read AFTER ranking — so `limit` is an upper bound the result
 * routinely falls short of for reasons that have nothing to do with how much
 * matched. An agent reading "2 matches" as "there are two" is reading a
 * recall-capped, visibility-filtered sample as a census.
 *
 * States the shape, not a number: the true match count is not something this
 * layer can obtain without another query.
 */
const SEARCH_SCOPE_NOTE = `_A ranked SAMPLE of the bases you can read, not an exhaustive scan: candidates are capped before ranking, distant matches are dropped, and hits in bases you cannot read are removed after ranking. Fewer hits than \`limit\` does not mean there are no others, and zero hits is not proof of absence — try op="get_tree" or different wording._`;
