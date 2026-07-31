"use strict";
/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * list_trash, search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opListBases = opListBases;
exports.opGetTree = opGetTree;
exports.opListDir = opListDir;
exports.opReadFile = opReadFile;
exports.opListTrash = opListTrash;
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
 *     `read_file` renders it below a `---` rule, as itself.
 */
const NO_NAME = "`(unnamed)`";
async function opListBases(client) {
    const bases = await client.listKbBases();
    if (bases.length === 0)
        return (0, respond_1.ok)("No knowledge bases yet. Create one with `dopl_kb(op='create_base')`.");
    const lines = ["## Knowledge bases\n"];
    for (const b of bases) {
        // Surface the immutable id alongside the slug (the slug changes on
        // rename; the id is a stable handle) plus the access signal.
        const vis = b.visibility === "private" ? "private" : "public";
        const desc = b.description ? `\n  ${(0, narration_1.inlineOr)(b.description, "")}` : "";
        lines.push(`- ${(0, narration_1.inlineOr)(b.name, NO_NAME)} (slug: \`${b.slug}\` · id: \`${b.id}\` · ${vis})${desc}`);
    }
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
async function opReadFile(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    const entry = await client.readKbFileByPath(base.id, path);
    const lines = [
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
async function opListTrash(client, ref) {
    let baseId;
    if (ref) {
        const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
        if ((0, knowledge_shared_1.isErr)(base))
            return base;
        baseId = base.id;
    }
    const trash = await client.listKbTrash(baseId);
    const total = trash.bases.length + trash.folders.length + trash.entries.length;
    if (total === 0)
        return (0, respond_1.ok)("Trash is empty.");
    const lines = [`## Trash (${total} item${total === 1 ? "" : "s"})\n`];
    if (trash.bases.length > 0) {
        lines.push("### Bases");
        for (const b of trash.bases)
            lines.push(`- ${(0, narration_1.inlineOr)(b.name, NO_NAME)} (slug: \`${b.slug}\`) — deleted ${b.deletedAt}`);
        lines.push("");
    }
    if (trash.folders.length > 0) {
        lines.push("### Folders");
        for (const f of trash.folders)
            lines.push(`- ${(0, narration_1.inlineOr)(f.name, NO_NAME)} (id: \`${f.id}\`) — deleted ${f.deletedAt}`);
        lines.push("");
    }
    if (trash.entries.length > 0) {
        lines.push("### Entries");
        for (const e of trash.entries)
            lines.push(`- ${(0, narration_1.inlineOr)(e.title, NO_NAME)} (id: \`${e.id}\`) — deleted ${e.deletedAt}`);
    }
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
        return (0, respond_1.ok)(`No matches for ${shownQuery}.`);
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
    return (0, respond_1.ok)(lines.join("\n"));
}
