"use strict";
/**
 * Knowledge-base methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-knowledge.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listKbBasesPayload = listKbBasesPayload;
exports.listKbBases = listKbBases;
exports.getKbBase = getKbBase;
exports.getKbTree = getKbTree;
exports.createKbBase = createKbBase;
exports.dryRunKbBase = dryRunKbBase;
exports.updateKbBase = updateKbBase;
exports.deleteKbBase = deleteKbBase;
exports.setKbBasePinned = setKbBasePinned;
exports.setKbEntryPinned = setKbEntryPinned;
exports.getKbStartupContext = getKbStartupContext;
exports.readKbFileByPath = readKbFileByPath;
exports.readKbFilePart = readKbFilePart;
exports.writeKbFileByPath = writeKbFileByPath;
exports.listKbDirByPath = listKbDirByPath;
exports.createKbFolderByPath = createKbFolderByPath;
exports.deleteKbByPath = deleteKbByPath;
exports.moveKbByPath = moveKbByPath;
exports.searchKb = searchKb;
const errors_js_1 = require("./errors.js");
const enc = encodeURIComponent;
// ─── Bases ──────────────────────────────────────────────────────────
/**
 * The bases this caller may READ, optionally narrowed to one shelf.
 *
 * ⚠ `shelf` ABSENT = BOTH shelves — the pre-existing contract every caller
 * rides, and the reason this stayed a no-arg call for so long. The narrowing is
 * a `WHERE` server-side, not a post-filter, so a shelf the caller did not ask
 * for never reaches the wire.
 */
async function listKbBasesPayload(t, opts = {}) {
    const qs = opts.shelf ? `?shelf=${enc(opts.shelf)}` : "";
    return t.request(`/api/knowledge/bases${qs}`, { toolName: "kb_list_bases" });
}
/**
 * The rows alone. ⚠ DELEGATES to {@link listKbBasesPayload} rather than issuing
 * its own request — one HTTP call either way, and one place that knows the URL.
 * Kept as its own method because most callers want the array and nothing else;
 * widening its return would have been a breaking change for all of them to buy
 * a key one caller reads.
 */
async function listKbBases(t, opts = {}) {
    return (await listKbBasesPayload(t, opts)).bases;
}
async function getKbBase(t, baseId) {
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}`, { toolName: "kb_get_base" });
    return data.base;
}
async function getKbTree(t, baseId, opts) {
    const params = new URLSearchParams();
    if (opts?.entryLimit !== undefined)
        params.set("entryLimit", String(opts.entryLimit));
    if (opts?.entryCursor !== undefined)
        params.set("entryCursor", opts.entryCursor);
    const qs = params.toString();
    return t.request(`/api/knowledge/bases/${enc(baseId)}/tree${qs ? `?${qs}` : ""}`, { toolName: "kb_get_tree" });
}
async function createKbBase(t, input) {
    const data = await t.request("/api/knowledge/bases", { method: "POST", body: input, toolName: "kb_create_base" });
    return data.base;
}
/**
 * 🔒 **THE CREATE'S GATES, RUN WITHOUT THE CREATE** — `POST
 * /api/knowledge/bases?dryRun=1`. Resolves when the same body would be
 * ACCEPTED; throws the create's own error when it would be refused. Nothing is
 * written either way, and there is no row to return.
 *
 * ⚠ **A SECOND METHOD OVER ONE ENDPOINT, LIKE `listKbBases` /
 * `listKbBasesPayload`** — not a second endpoint, and not a flag on
 * {@link createKbBase}. A flag would make that method answer `KnowledgeBase |
 * null`, and a caller reading the null as "created, row unavailable" is the
 * mistake this whole slice exists to stop.
 *
 * ⚠ **SEND THE BODY YOU WOULD SEND**, `acknowledgeShared` included: the answer
 * is only about the body it was asked with.
 */
async function dryRunKbBase(t, input) {
    await t.request("/api/knowledge/bases?dryRun=1", {
        method: "POST",
        body: input,
        toolName: "kb_create_base",
    });
}
async function updateKbBase(t, baseId, patch) {
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}`, { method: "PATCH", body: patch, toolName: "kb_update_base" });
    return data.base;
}
async function deleteKbBase(t, baseId) {
    await t.requestNoContent(`/api/knowledge/bases/${enc(baseId)}`, "DELETE", "kb_delete_base");
}
// ─── Pins + startup context (T81) ───────────────────────────────────
/**
 * Pin or unpin a whole base — whether its entries are handed to every agent
 * session launched in this workspace.
 *
 * ⚠ TWO IDEMPOTENT VERBS BEHIND ONE BOOLEAN, NEVER A TOGGLE. `pinned` picks the
 * HTTP verb (`PUT` / `DELETE`); the request states the END STATE, so a retry
 * after a timeout that actually landed re-asserts it instead of flipping it
 * back. On workspace-wide state a silent un-do would change what every session
 * launched afterwards starts with.
 *
 * ⚠ A WORKSPACE FACT, NOT A FAVOURITE — the star methods write the caller's own
 * row and this writes the base. Hence a `member` floor server-side where a star
 * takes the viewer default.
 */
async function setKbBasePinned(t, baseId, pinned) {
    await t.requestNoContent(`/api/knowledge/bases/${enc(baseId)}/pin`, pinned ? "PUT" : "DELETE", "kb_pin_base");
}
/** The single-entry half of {@link setKbBasePinned} — one document joins the
 *  startup context without its whole base. Same two-verb contract. */
async function setKbEntryPinned(t, entryId, pinned) {
    await t.requestNoContent(`/api/knowledge/entries/${enc(entryId)}/pin`, pinned ? "PUT" : "DELETE", "kb_pin_entry");
}
/**
 * The pinned reading list a session starts with — every entry of a pinned base
 * plus every individually pinned entry, capped.
 *
 * ⚠ READ `truncated` AND `omitted`. A payload that renders as the whole of what
 * is pinned when it is not is the bug this shape exists to prevent
 * (INVARIANTS §9); `omitted` carries addresses to fetch the rest with
 * `readKbFileByPath`.
 */
async function getKbStartupContext(t) {
    return t.request("/api/knowledge/startup-context", {
        toolName: "kb_startup_context",
    });
}
// ─── Path-based file/folder ops ─────────────────────────────────────
async function readKbFileByPath(t, baseId, path) {
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}/files?path=${enc(path)}`, { toolName: "kb_read_file" });
    return data.entry;
}
/**
 * A PART of an entry: one `section=`, or the outline alone.
 *
 * ⚠ **A SEPARATE METHOD RATHER THAN AN OPTION ON {@link readKbFileByPath}**,
 * because the two answer different shapes and the whole-document read is on
 * every existing caller's path. ⚠ **THE NARROWING IS A QUERY PARAMETER, NOT A
 * POST-FILTER**: the body that did not match never crosses the wire.
 */
async function readKbFilePart(t, baseId, path, opts = {}) {
    const params = new URLSearchParams({ path });
    if (opts.section !== undefined)
        params.set("section", opts.section);
    if (opts.outline)
        params.set("outline", "1");
    return t.request(`/api/knowledge/bases/${enc(baseId)}/files?${params.toString()}`, { toolName: "kb_read_file" });
}
async function writeKbFileByPath(t, baseId, path, input = {}, expectedVersion) {
    // Optimistic concurrency, tri-state on `expectedVersion`:
    //   - string    → atomic compare-and-swap (412 on mismatch).
    //   - undefined → strict: existing entry refuses 412 — caller must read_file
    //                 first and pass the Version it saw. ⚠ Do NOT re-add the old
    //                 read-at-write auto-guard: it only proved nothing changed in
    //                 the microseconds before the PUT, and silently clobbered
    //                 writes landing after the caller's real read. 404 → create,
    //                 no precondition.
    //   - null      → force: blind overwrite, no precondition.
    let version;
    if (expectedVersion === null) {
        version = undefined;
    }
    else if (expectedVersion === undefined) {
        let exists = false;
        try {
            await readKbFileByPath(t, baseId, path);
            exists = true;
        }
        catch (e) {
            if (!(e instanceof errors_js_1.DoplApiError) || e.status !== 404)
                throw e;
        }
        if (exists) {
            throw new errors_js_1.DoplApiError(412, JSON.stringify({
                error: {
                    code: "EXPECTED_VERSION_REQUIRED",
                    message: "This entry already exists. read_file it first and pass its Version as expected_version (or force to overwrite).",
                },
            }));
        }
    }
    else {
        version = expectedVersion;
    }
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}/files`, {
        method: "PUT",
        body: { path, ...input },
        toolName: "kb_write_file",
        customHeaders: version ? { "X-Updated-At": version } : undefined,
    });
    return data;
}
async function listKbDirByPath(t, baseId, path = "") {
    const qs = path ? `?path=${enc(path)}` : "";
    return t.request(`/api/knowledge/bases/${enc(baseId)}/folders-by-path${qs}`, { toolName: "kb_list_dir" });
}
async function createKbFolderByPath(t, baseId, path, description) {
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}/folders-by-path`, {
        method: "POST",
        // ⚠ Omit `description` entirely when not provided so a plain mkdir -p
        // never clears an existing folder's summary (route: `undefined` =
        // leave as-is, `null` = clear).
        body: description === undefined ? { path } : { path, description },
        toolName: "kb_create_folder",
    });
    return data.folder;
}
async function deleteKbByPath(t, baseId, path) {
    return t.request(`/api/knowledge/bases/${enc(baseId)}/folders-by-path?path=${enc(path)}`, { method: "DELETE", toolName: "kb_delete_by_path" });
}
async function moveKbByPath(t, baseId, fromPath, toPath) {
    return t.request(`/api/knowledge/bases/${enc(baseId)}/move-by-path`, {
        method: "POST",
        body: { fromPath, toPath },
        toolName: "kb_move_by_path",
    });
}
// ─── Search ─────────────────────────────────────────────────────────
async function searchKb(t, query, opts = {}) {
    const qs = new URLSearchParams({ q: query });
    if (opts.baseSlug)
        qs.set("base", opts.baseSlug);
    if (opts.limit !== undefined)
        qs.set("limit", String(opts.limit));
    const data = await t.request(`/api/knowledge/search?${qs.toString()}`, { toolName: "kb_search" });
    return data.hits;
}
