"use strict";
/**
 * `dopl_kb` op="history" and op="restore" — one ENTRY's changelog, one revision read, and the
 * write-back (DMP-002, 2026-09-23). The app's Changelog panel reads the same route.
 *
 * ⚠ `history` WITH `revision` IS THE PREVIEW: it prints the snapshot a restore would write and
 * the current Version to pass, so the old/new summary is in hand BEFORE the write.
 * ⚠ `restore` REQUIRES `expected_version` and checks it twice — here, before the call, and in
 * the route (`X-Updated-At`, atomic) — so a restore over a newer edit is refused, never a clobber.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opHistory = opHistory;
exports.opRestore = opRestore;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const channel_shared_1 = require("./channel-shared");
const untrusted_fence_1 = require("./untrusted-fence");
const revision_render_1 = require("./revision-render");
const tool_errors_1 = require("./tool-errors");
/** A revision read walks at most this many server pages (200 rows each) before it gives up. */
const FIND_PAGES_MAX = 10;
const FIND_PAGE_SIZE = 200;
/** The entry at base+path, with its size — the outline read, so no body crosses the wire. */
async function locate(client, baseRef, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, baseRef);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    try {
        const read = await client.readKbFilePart(base.id, path, { outline: true });
        return { entry: read.entry, chars: read.outline?.totalChars ?? read.entry.body.length };
    }
    catch (e) {
        const missing = (0, knowledge_shared_1.entryNotFound)(e, path, baseRef);
        if (missing)
            return missing;
        throw e;
    }
}
async function findRevision(client, entryId, revisionId) {
    let cursor;
    for (let i = 0; i < FIND_PAGES_MAX; i++) {
        const page = await client.listKbEntryRevisions(entryId, { cursor, limit: FIND_PAGE_SIZE });
        const hit = page.revisions.find((r) => r.id === revisionId);
        if (hit)
            return hit;
        if (!page.nextCursor)
            return null;
        cursor = page.nextCursor;
    }
    return null;
}
const HISTORY_OP = 'op="history"';
async function opHistory(client, baseRef, path, callerUserId, opts) {
    const found = await locate(client, baseRef, path);
    if ((0, channel_shared_1.isErr)(found))
        return found;
    const { entry, chars } = found;
    const current = `Current: Version \`${entry.updatedAt}\` · entry id \`${entry.id}\` · ${chars} chars.`;
    if (opts.revision !== undefined) {
        const rev = await findRevision(client, entry.id, opts.revision);
        if (!rev) {
            return (0, respond_1.err)((0, tool_errors_1.refusal)((0, revision_render_1.revisionNotFound)(HISTORY_OP), `${(0, narration_1.inlineOr)(opts.revision, "`(empty)`")} is not in this entry's last ${FIND_PAGES_MAX * FIND_PAGE_SIZE} revisions.`));
        }
        const body = rev.payload.body ?? "";
        const title = rev.payload.title ? (0, narration_1.inlineOr)(rev.payload.title, narration_1.NO_NAME) : "`(title unchanged)`";
        return (0, respond_1.ok)([
            `# Revision \`${rev.id}\` of ${(0, narration_1.inlineOr)(entry.title, narration_1.NO_NAME)}`,
            (0, revision_render_1.revisionRow)(rev, callerUserId),
            current,
            `Restoring writes THIS snapshot (title ${title}, ${body.length} chars) over the current entry (${chars} chars) as a NEW revision; nothing is deleted. To do it: op="restore" revision="${rev.id}" expected_version="${entry.updatedAt}".`,
            "",
            "---",
            "",
            ...((0, revision_render_1.foreignRevision)(rev, callerUserId)
                ? (0, untrusted_fence_1.fenceBody)(body, "knowledge revision by another member")
                : [body]),
        ].join("\n"));
    }
    const page = await client.listKbEntryRevisions(entry.id, {
        cursor: opts.cursor,
        limit: opts.limit ?? revision_render_1.HISTORY_PAGE_DEFAULT,
    });
    const lines = [
        `# History: ${(0, narration_1.inlineOr)(entry.title, narration_1.NO_NAME)} (path ${(0, narration_1.inlineOr)(path, narration_1.NO_PATH)})`,
        current,
        "",
    ];
    if (page.revisions.length === 0)
        lines.push("_No revisions recorded._");
    for (const rev of page.revisions) {
        const size = typeof rev.payload.body === "string" ? ` · ${rev.payload.body.length} chars` : "";
        lines.push((0, revision_render_1.revisionRow)(rev, callerUserId, size));
    }
    lines.push("", (0, revision_render_1.pageTail)(page.nextCursor, "entry_cursor"), `Preview one with op="history" revision="<id>"; restore with op="restore" revision="<id>" expected_version="${entry.updatedAt}".`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opRestore(client, baseRef, path, revisionId, expectedVersion) {
    const found = await locate(client, baseRef, path);
    if ((0, channel_shared_1.isErr)(found))
        return found;
    const { entry, chars } = found;
    if (entry.updatedAt !== expectedVersion) {
        return (0, revision_render_1.staleBeforeRestore)('op="history"', entry.updatedAt, expectedVersion);
    }
    let restored;
    try {
        restored = await client.restoreKbEntryRevision(entry.id, revisionId, expectedVersion);
    }
    catch (e) {
        const mapped = (0, revision_render_1.restoreRefusal)(e, 'op="history"', HISTORY_OP) ?? (0, knowledge_shared_1.agentWriteDenied)(e);
        if (mapped)
            return mapped;
        throw e;
    }
    return (0, respond_1.ok)([
        `Restored ${(0, narration_1.inlineOr)(restored.title, narration_1.NO_NAME)} to revision \`${revisionId}\` — written as a NEW revision; the one you restored from, and the state you replaced, are both still in op="history".`,
        `Version \`${expectedVersion}\` → \`${restored.updatedAt}\` · ${chars} → ${restored.body.length} chars · entry id \`${restored.id}\`.`,
    ].join("\n"));
}
