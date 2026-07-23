"use strict";
/**
 * Knowledge-base methods for `DoplClient` (Item 4). Each function takes
 * the shared `DoplTransport` as its first arg and hits the matching
 * Next.js API route. The `DoplClient` class wraps these into instance
 * methods for caller ergonomics.
 *
 * Path-based methods (`writeFileByPath`, `readFileByPath`,
 * `createFolderByPath`, `listDirByPath`, `moveByPath`, `deleteByPath`)
 * use the path-based REST endpoints added in Phase 4.C.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listKbBases = listKbBases;
exports.getKbBase = getKbBase;
exports.getKbTree = getKbTree;
exports.createKbBase = createKbBase;
exports.updateKbBase = updateKbBase;
exports.deleteKbBase = deleteKbBase;
exports.restoreKbBase = restoreKbBase;
exports.readKbFileByPath = readKbFileByPath;
exports.writeKbFileByPath = writeKbFileByPath;
exports.listKbDirByPath = listKbDirByPath;
exports.createKbFolderByPath = createKbFolderByPath;
exports.deleteKbByPath = deleteKbByPath;
exports.moveKbByPath = moveKbByPath;
exports.listKbTrash = listKbTrash;
exports.restoreKbFolder = restoreKbFolder;
exports.restoreKbEntry = restoreKbEntry;
exports.searchKb = searchKb;
const errors_js_1 = require("./errors.js");
const enc = encodeURIComponent;
// ─── Bases ──────────────────────────────────────────────────────────
async function listKbBases(t) {
    const data = await t.request("/api/knowledge/bases", { toolName: "kb_list_bases" });
    return data.bases;
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
async function updateKbBase(t, baseId, patch) {
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}`, { method: "PATCH", body: patch, toolName: "kb_update_base" });
    return data.base;
}
async function deleteKbBase(t, baseId) {
    await t.requestNoContent(`/api/knowledge/bases/${enc(baseId)}`, "DELETE", "kb_delete_base");
}
async function restoreKbBase(t, baseId) {
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}/restore`, { method: "POST", toolName: "kb_restore_base" });
    return data.base;
}
// ─── Path-based file/folder ops ─────────────────────────────────────
async function readKbFileByPath(t, baseId, path) {
    const data = await t.request(`/api/knowledge/bases/${enc(baseId)}/files?path=${enc(path)}`, { toolName: "kb_read_file" });
    return data.entry;
}
async function writeKbFileByPath(t, baseId, path, input = {}, expectedVersion) {
    // Optimistic concurrency, tri-state on `expectedVersion`:
    //   - string    → atomic compare-and-swap against it (412 on mismatch).
    //   - undefined  → strict default: if the entry already exists, refuse
    //                  (412) — the caller must read_file first and pass the
    //                  Version it actually saw. The old read-at-write
    //                  "auto-guard" only proved nothing changed in the
    //                  microseconds before the PUT; it silently clobbered
    //                  anything written after the caller's real read. A
    //                  missing entry (404) means create — no precondition.
    //   - null       → force: blind overwrite, no precondition.
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
        // Omit `description` entirely when not provided so a plain mkdir -p
        // never clears an existing folder's summary (the route treats
        // `undefined` as "leave as-is", `null` as "clear").
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
// ─── Trash ──────────────────────────────────────────────────────────
async function listKbTrash(t, baseId) {
    const qs = baseId ? `?baseId=${enc(baseId)}` : "";
    return t.request(`/api/knowledge/trash${qs}`, { toolName: "kb_list_trash" });
}
async function restoreKbFolder(t, folderId) {
    const data = await t.request(`/api/knowledge/folders/${enc(folderId)}/restore`, {
        method: "POST",
        toolName: "kb_restore_folder",
    });
    return data.folder;
}
async function restoreKbEntry(t, entryId) {
    const data = await t.request(`/api/knowledge/entries/${enc(entryId)}/restore`, { method: "POST", toolName: "kb_restore_file" });
    return data.entry;
}
// ─── Search (Item 5.D) ──────────────────────────────────────────────
async function searchKb(t, query, opts = {}) {
    const qs = new URLSearchParams({ q: query });
    if (opts.baseSlug)
        qs.set("base", opts.baseSlug);
    if (opts.limit !== undefined)
        qs.set("limit", String(opts.limit));
    const data = await t.request(`/api/knowledge/search?${qs.toString()}`, { toolName: "kb_search" });
    return data.hits;
}
