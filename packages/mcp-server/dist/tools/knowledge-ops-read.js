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
 * ⚠ WHAT IS AND ISN'T NEUTRALIZED IN A KNOWLEDGE READ. A published base is
 * workspace-visible, so every name, description, title and excerpt can be
 * another member's:
 *   - NAMES / TITLES / DESCRIPTIONS / EXCERPTS are values spliced into lines we
 *     wrote, so they go through the neutralizer. Only folder names and entry
 *     titles carry a charset rule (`NAME_RE`, features/knowledge/schema.ts);
 *     base names, descriptions and excerpts are LENGTH-bounded only, so a
 *     newline in any of them starts a line.
 *   - THE ENTRY BODY is untouched — it is the document the user wrote for the
 *     agent to act on, and stripping its markdown breaks the product. Rendered
 *     below a `---` rule, under {@link UNTRUSTED_ENTRY_BODY_HEADER} when it is
 *     ANOTHER MEMBER'S. ⚠ The gap was never rendering it as itself; it was
 *     rendering it with nothing saying whose it was.
 */
const NO_NAME = "`(unnamed)`";
/**
 * ⚠ WHOSE VIEW THIS IS, stated on the RESULT, not only in the description.
 * `listBases` is filtered twice server-side (`canSeeBase` drops another
 * member's private bases; `filterTeamVisibleBases` drops teams-mode bases with
 * no grant and FAILS CLOSED to an empty list), and an untraced filter makes a
 * four-row heading read as a workspace census.
 *
 * ⚠ Names the FILTERS, never a hidden count — counting what you were not shown
 * is a second query on every list call.
 */
const BASES_SCOPE_NOTE = `_Bases you can READ. Another member's private bases, and any you have no grant on, are not listed, so this is not the workspace's base count. A row marked \`personal\` is on your own personal shelf and does not appear on the workspace Knowledge page; an UNMARKED row is on the workspace shelf, or on a server too old to say. Full inventory across every visibility: dopl_members(op="access_matrix")._`;
/**
 * ⚠ `shelf` ABSENT LISTS BOTH SHELVES, and that is the RIGHT answer rather than
 * an oversight (F-342 rules the unfiltered MCP read right and says it "must stay
 * right"): an operator's agent asking "what knowledge is here" should see the
 * operator's whole workspace. The narrowing is a server-side `WHERE`, so a shelf
 * the caller did not ask for never reaches the wire.
 */
async function opListBases(client, shelf) {
    const payload = await client.listKbBasesPayload({ shelf });
    const bases = payload.bases;
    // 🔒 ⚠ SIBLING KEY, `?? []` INLINE (INVARIANTS §8). `home_scoped` is
    // deliberately not projected onto the row — no client may re-derive the shelf
    // FENCE — so the label rides beside the list. An ABSENT key (older server,
    // degraded read) means NO ROW IS LABELLED, which is exactly what this surface
    // showed before the key existed. The unsafe direction would be calling a
    // workspace base personal, and nothing here can produce that.
    const personal = new Set(payload.homeScopedBaseIds ?? []);
    const where = shelf === "home"
        ? " on your personal shelf"
        : shelf === "workspace"
            ? " on the workspace shelf"
            : "";
    if (bases.length === 0)
        return (0, respond_1.ok)(`No knowledge bases visible to you${where}. ${BASES_SCOPE_NOTE}\n\nCreate one with \`dopl_kb(op='create_base')\`.`);
    const lines = [`## Knowledge bases${where}\n`];
    for (const b of bases) {
        // ⚠ Immutable id beside the slug — the slug changes on rename.
        const vis = b.visibility === "private" ? "private" : "public";
        const desc = b.description ? `\n  ${(0, narration_1.inlineOr)(b.description, "")}` : "";
        // ⚠ The label appears only when the flag SAYS SO. An unlabelled row is
        // "workspace shelf, or unknown" — never asserted as one of the two.
        const shelfLabel = personal.has(b.id) ? " · personal" : "";
        lines.push(`- ${(0, narration_1.inlineOr)(b.name, NO_NAME)} (slug: \`${b.slug}\` · id: \`${b.id}\` · ${vis}${shelfLabel})${desc}`);
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
    // Entries are paged at the API (folders always ship in full), so the wire
    // payload matches what gets rendered.
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
        // ⚠ The paging notice fires only when there IS a next page, so the complete
        // case must state its own scope rather than leave it implied.
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
 * ⚠ Defers to the shared neutralizer — a hand-rolled flatten-and-truncate
 * misses U+0085 (NEL is not in JavaScript's `\s` class) and touches neither
 * backticks nor `**`. Separator renders only when something survives.
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
// ⚠ Only the FRAMING reads this — readability is the server's decision and
// it already ran.
callerUserId = null) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    const entry = await client.readKbFileByPath(base.id, path);
    const lines = [
        // ⚠ FRAMING FIRST, and only for a document this caller did not write — a
        // header after the body is read after the injected instruction.
        ...((0, narration_1.isForeignAuthored)(entry, callerUserId)
            ? [knowledge_shared_1.UNTRUSTED_ENTRY_BODY_HEADER, ""]
            : []),
        // ⚠ BODY below the `---` is the document itself — deliberately untouched.
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
    // ⚠ `base` accepts a slug OR a UUID, but the search endpoint narrows by SLUG
    // only — resolve first; a UUID forwarded to `baseSlug` 404s with
    // KNOWLEDGE_BASE_NOT_FOUND.
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
        // ⚠ Do not turn highlight tags into `**` — that is our own markdown wrapped
        // around an excerpt of a member-authored body on an unframed line.
        const cleanSnippet = (0, narration_1.inlineOr)(h.snippet.replace(/<\/?b>/g, ""), "`(no snippet)`");
        lines.push(`- ${(0, narration_1.inlineOr)(h.title, NO_NAME)} _(rank ${h.rank.toFixed(2)})_ — entry id: \`${h.entryId}\`\n  ${cleanSnippet}`);
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
