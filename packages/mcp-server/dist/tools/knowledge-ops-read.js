"use strict";
/**
 * `dopl_kb` listing reads: list_bases, get_tree, list_dir. outline/read_file live in `knowledge-ops-read-doc.ts`;
 * search lives in `knowledge-ops-search.ts`, and its result discloses it is a recall-capped sample, not a census.
 * Member-written names are values (`inlineOr`); summaries and headings render verbatim only inside a fence.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opReadFile = exports.opOutline = void 0;
exports.opListBases = opListBases;
exports.opGetTree = opGetTree;
exports.opListDir = opListDir;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const channel_shared_1 = require("./channel-shared");
const untrusted_fence_1 = require("./untrusted-fence");
const audience_label_1 = require("./audience-label");
const container_destination_1 = require("./container-destination");
const knowledge_entity_titles_1 = require("./knowledge-entity-titles");
/** Stale-cache fallback (INVARIANTS §8): absent personal ids = empty. `channelGrants` gets none — absent ≠ `{}`. */
const EMPTY_BASE_IDS = Object.freeze([]);
/** Stale-cache fallback (INVARIANTS §8) for `entryHeadings`: absent renders rows without heading lists. */
const EMPTY_HEADINGS = Object.freeze({});
/** States on the result that the list is server-filtered; names the filters, never a hidden count. */
const BASES_SCOPE_NOTE = `_Bases you can READ here. Another member's private bases, and any you have no grant on, are not listed, so this is not the workspace's base count. Full inventory across every visibility: dopl_members(op="access_matrix")._`;
/** The server returns this container's bases plus the caller's personal ones; rows are grouped by container first
 *  (twin: `agent-ops-read.ts › opList`). */
async function opListBases(client, 
/** Optional: absent = not known, so no `channelId` is sent and the grant split is skipped. */
directory) {
    // In a home channel "shared" is a grant row, not the visibility column, so the channel is named to get grants back.
    const container = await (0, container_destination_1.resolveHomeChannelContainer)(client, directory);
    const channelId = container
        ? ((await (0, container_destination_1.resolveHomeChannelId)(client, container)) ?? undefined)
        : undefined;
    const payload = await client.listKbBasesPayload({ channelId });
    const bases = payload.bases;
    if (bases.length === 0)
        return (0, respond_1.ok)(`No knowledge bases visible to you here. ${BASES_SCOPE_NOTE}\n\nCreate one with \`dopl_kb(op='create_base')\`.`);
    const personalIds = new Set(payload.homeScopedBaseIds ?? EMPTY_BASE_IDS);
    // Split on the answer, not the question: `undefined` = not answered (skip the split); `{}` = answered, none granted.
    const grants = payload.channelGrants;
    const personal = bases.filter((b) => personalIds.has(b.id));
    const here = bases.filter((b) => !personalIds.has(b.id));
    // Container first, then the grant. Headings are shared with the identity lane (`DESTINATION_HEADINGS`). The audience
    // label comes from the group (`audience-label.ts`), never the visibility column — a shared base is stored `private`;
    // a `null` label (standard workspace only) falls back to the column.
    const groups = grants === undefined
        ? [[null, here, null]]
        : [
            [
                container_destination_1.DESTINATION_HEADINGS.shared,
                here.filter((b) => grants[b.id] !== undefined),
                audience_label_1.AUDIENCE_LABELS.channel,
            ],
            [
                container_destination_1.DESTINATION_HEADINGS.legacy,
                here.filter((b) => grants[b.id] === undefined),
                audience_label_1.AUDIENCE_LABELS.nobody,
            ],
        ];
    const lines = ["## Knowledge bases\n"];
    for (const [heading, rows, audience] of [
        ...groups,
        [container_destination_1.DESTINATION_HEADINGS.personal, personal, audience_label_1.AUDIENCE_LABELS.you],
    ]) {
        if (rows.length === 0)
            continue;
        if (heading !== null)
            lines.push(`### ${heading}`);
        for (const b of rows) {
            const seenBy = audience ??
                (b.visibility === "private"
                    ? audience_label_1.AUDIENCE_LABELS.you
                    : audience_label_1.AUDIENCE_LABELS.workspace);
            const desc = b.description ? `\n  ${(0, narration_1.inlineOr)(b.description, "")}` : "";
            // Immutable id beside the slug — the slug changes on rename.
            lines.push(`- ${(0, narration_1.inlineOr)(b.name, narration_1.NO_NAME)} (slug: \`${b.slug}\` · id: \`${b.id}\` · seen by ${seenBy})${desc}`);
        }
        lines.push("");
    }
    lines.push(BASES_SCOPE_NOTE);
    return (0, respond_1.ok)(lines.join("\n"));
}
const TREE_ENTRY_CAP = 400;
const TREE_ENTRY_MAX = 1000;
async function opGetTree(client, ref, entryLimit, entryCursor) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const limit = Math.min(Math.max(1, Math.floor(entryLimit ?? TREE_ENTRY_CAP)), TREE_ENTRY_MAX);
    // Always ask for headings; the app's tree pane skips them because they cost the body column (`service-folders.ts`).
    const tree = await client.getKbTree(base.id, {
        entryLimit: limit,
        entryCursor,
        headings: true,
    });
    const entryTotal = tree.entryTotal ?? tree.entries.length;
    const vis = tree.base.visibility === "private" ? "private" : "public";
    const headings = tree.entryHeadings ?? EMPTY_HEADINGS;
    const lines = [
        `## ${(0, narration_1.inlineOr)(tree.base.name, narration_1.NO_NAME)} \`${tree.base.slug}\``,
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
    // Rows render author-written metadata verbatim, so they go in one fence; this server's narration stays outside it.
    const rows = [];
    const escaped = [];
    function dump(parentId, prefix) {
        for (const f of childFolders.get(parentId) ?? []) {
            if ((0, knowledge_entity_titles_1.looksEntityEscaped)(f.name))
                escaped.push(f.name);
            rows.push(`${prefix}📁 ${(0, narration_1.inlineOr)(f.name, narration_1.NO_NAME)}/${descSuffix(f.description)}`);
            dump(f.id, prefix + "  ");
        }
        for (const e of childEntries.get(parentId) ?? []) {
            if ((0, knowledge_entity_titles_1.looksEntityEscaped)(e.title))
                escaped.push(e.title);
            rows.push(`${prefix}📄 ${(0, narration_1.inlineOr)(e.title, narration_1.NO_NAME)}${descSuffix(e.excerpt)}${headingSuffix(headings[e.id])}`);
        }
    }
    dump(null, "");
    lines.push(...(0, untrusted_fence_1.fenceLines)(rows, "knowledge tree, member-written names and summaries"));
    // One line for the whole tree, outside the fence; `escapedTitleLine` neutralizes the title it quotes.
    if (escaped.length > 0)
        lines.push("", (0, knowledge_entity_titles_1.escapedTitleLine)(escaped[0], escaped.length));
    if (tree.nextEntryCursor) {
        lines.push("", `_Showing ${tree.entries.length} of ${entryTotal} entries. Pass entry_cursor="${tree.nextEntryCursor}" for the next page, or narrow with op="list_dir" / op="search"._`);
    }
    else {
        // The complete case states its own scope rather than leaving it implied.
        lines.push("", `_Folders complete; entries complete for this base._`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
/** The field's own schema cap (`DESCRIPTION_MAX`), not `narration.ts › INLINE_TEXT_MAX`, which guards uncurated
 *  values and must not be raised. */
const EXCERPT_MAX = 300;
/** ` — summary` suffix for tree/dir rows: clipped by `flattenFenced`, then rendered verbatim — so the caller must
 *  fence the rows, and a caller that does not fence must not use this. */
function descSuffix(text) {
    if (!text)
        return "";
    const rendered = (0, narration_1.flattenFenced)(text, EXCERPT_MAX);
    return rendered ? ` — ${rendered}` : "";
}
/** A row's heading list, not an outline; capped because a listing renders hundreds of rows. */
const ROW_HEADINGS_MAX = 150;
/** Heading names on a listing row so the `outline` call can be skipped; author-written, so fenced like the excerpt. */
function headingSuffix(names) {
    if (!names || names.length === 0)
        return "";
    const parts = [];
    let used = 0;
    for (const raw of names) {
        const one = (0, narration_1.flattenFenced)(raw, 60);
        if (!one)
            continue;
        if (used + one.length + 3 > ROW_HEADINGS_MAX) {
            parts.push(`+${names.length - parts.length} more`);
            break;
        }
        used += one.length + 3;
        parts.push(one);
    }
    return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}
async function opListDir(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const listing = await client.listKbDirByPath(base.id, path ?? "");
    const lines = [];
    const where = listing.folder ? (0, narration_1.inlineOr)(listing.folder.name, narration_1.NO_NAME) : "(root)";
    lines.push(`## ${(0, narration_1.inlineOr)(base.name, narration_1.NO_NAME)} → ${where}`);
    if (listing.folder?.description)
        lines.push((0, narration_1.inlineOr)(listing.folder.description, ""));
    if (listing.folders.length === 0 && listing.entries.length === 0) {
        lines.push("Empty.");
    }
    else {
        // Same fence as `opGetTree`: `descSuffix` renders author-written markdown verbatim.
        const rows = [];
        for (const f of listing.folders)
            rows.push(`📁 ${(0, narration_1.inlineOr)(f.name, narration_1.NO_NAME)}/${descSuffix(f.description)}`);
        for (const e of listing.entries)
            rows.push(`📄 ${(0, narration_1.inlineOr)(e.title, narration_1.NO_NAME)}${descSuffix(e.excerpt)}`);
        lines.push(...(0, untrusted_fence_1.fenceLines)(rows, "knowledge listing, member-written names and summaries"));
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
// Re-exported: `knowledge.ts` and the suites address the document reads through this module.
var knowledge_ops_read_doc_1 = require("./knowledge-ops-read-doc");
Object.defineProperty(exports, "opOutline", { enumerable: true, get: function () { return knowledge_ops_read_doc_1.opOutline; } });
Object.defineProperty(exports, "opReadFile", { enumerable: true, get: function () { return knowledge_ops_read_doc_1.opReadFile; } });
