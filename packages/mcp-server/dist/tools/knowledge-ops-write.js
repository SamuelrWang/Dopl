"use strict";
/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility
 * on bases, create/move folders, write/move entries, and the restore
 * (recovery) ops. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreateBase = opCreateBase;
exports.opUpdateBase = opUpdateBase;
exports.opSetVisibility = opSetVisibility;
exports.opRestoreBase = opRestoreBase;
exports.opCreateFolder = opCreateFolder;
exports.opMoveFolder = opMoveFolder;
exports.opWriteFile = opWriteFile;
exports.opMoveFile = opMoveFile;
exports.opRestoreFolder = opRestoreFolder;
exports.opRestoreFile = opRestoreFile;
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
async function opCreateBase(client, name, description) {
    const base = await client.createKbBase({ name, description });
    const visNote = base.visibility === "private"
        ? "Private to you — only you and your agent can see it."
        : "Visible to the whole workspace.";
    return (0, respond_1.ok)(`Created knowledge base **${base.name}** (slug: \`${base.slug}\`). ${visNote}`);
}
async function opUpdateBase(client, ref, name, description, slug) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let updated;
    try {
        updated = await client.updateKbBase(base.id, {
            name,
            description,
            slug,
        });
    }
    catch (e) {
        // F-10b: read-only-to-agents base — surface the clean message the
        // delete ops use, not a raw AGENT_WRITE_DISABLED dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        // F-18: name the field + rule instead of surfacing a raw
        // "VALIDATION_FAILED: Request body failed validation".
        const mapped = (0, knowledge_shared_1.updateBaseValidationError)(e);
        if (mapped)
            return mapped;
        throw e;
    }
    return (0, respond_1.ok)(`Updated **${updated.name}** (slug: \`${updated.slug}\`).`);
}
async function opSetVisibility(client, ref, visibility) {
    if (visibility !== "public") {
        return (0, respond_1.err)(`set_visibility only publishes (visibility="public") a base you created. Un-publishing and team scope are human-only — use the Dopl web UI.`);
    }
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let updated;
    try {
        updated = await client.updateKbBase(base.id, { visibility: "public" });
    }
    catch (e) {
        // F-10b: read-only-to-agents base — surface the clean message the other
        // write ops use, not a raw AGENT_WRITE_DISABLED dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    return (0, respond_1.ok)(`Published knowledge base **${updated.name}** (slug: \`${updated.slug}\`) — now visible workspace-wide and referenceable in workflows.`);
}
async function opRestoreBase(client, ref) {
    // Audit fix #30: was 3 round-trips (listKbBases → listKbTrash →
    // restoreKbBase). Drop the listKbBases call — if the user
    // mistakenly tries to restore an already-active base it'll just
    // fall into the "not in trash" error below, which is clearer
    // anyway ("No deleted base matches" vs "Base is already active"
    // both correctly tell them not to retry).
    //
    // The restore endpoint takes a UUID, not a slug. Look up the
    // trashed base by slug or id via workspace-wide trash listing.
    const trash = await client.listKbTrash();
    const trashed = trash.bases.find((b) => b.slug === ref || b.id === ref);
    if (!trashed) {
        return (0, respond_1.err)(`No deleted base matches "${ref}". Use \`dopl_kb(op='list_trash')\` to see available restores; or the base may already be active.`);
    }
    let restored;
    try {
        restored = await client.restoreKbBase(trashed.id);
    }
    catch (e) {
        // F-10b: read-only-to-agents base — clean message, not a raw
        // AGENT_WRITE_DISABLED dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    return (0, respond_1.ok)(`Restored **${restored.name}** (slug: \`${restored.slug}\`).`);
}
async function opCreateFolder(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let folder;
    try {
        folder = await client.createKbFolderByPath(base.id, path);
    }
    catch (e) {
        // F-10b: read-only-to-agents base — clean message, not a raw
        // AGENT_WRITE_DISABLED dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    return (0, respond_1.ok)(`Folder ready at \`${path}\` (id: \`${folder.id}\`).`);
}
async function opMoveFolder(client, ref, from_path, to_path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let result;
    try {
        result = await client.moveKbByPath(base.id, from_path, to_path);
    }
    catch (e) {
        // F-10b: read-only-to-agents base — clean message, not a raw
        // AGENT_WRITE_DISABLED dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    if (result.kind !== "folder") {
        return (0, respond_1.err)(`Path "${from_path}" resolved to a ${result.kind}, not a folder.`);
    }
    return (0, respond_1.ok)(`Folder moved: \`${from_path}\` → \`${to_path}\`.`);
}
async function opWriteFile(client, ref, path, body, title, expected_version, force) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let entry;
    let webUrl;
    try {
        const res = await client.writeKbFileByPath(base.id, path, { body, title }, force ? null : expected_version);
        entry = res.entry;
        webUrl = res.webUrl;
    }
    catch (e) {
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`\`${path}\` changed since you last read it. Call dopl_kb(op="read_file", base, path) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`);
        }
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`An entry titled "${title ?? path.split("/").filter(Boolean).pop()}" already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`);
        }
        // F-10b: read-only-to-agents base — clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        // F-18: name the failing field + rule instead of surfacing a raw
        // "VALIDATION_FAILED: Request body failed validation".
        const mapped = (0, knowledge_shared_1.writeFileValidationError)(e, title);
        if (mapped)
            return mapped;
        throw e;
    }
    // The addressable path's leaf is the entry's title (not the input
    // path's leaf segment). Print it so callers can read the entry
    // back without guessing. When `title` was passed and the slug-of-
    // title differs from the input path's leaf, surface the canonical
    // form explicitly.
    const parentSegments = path.split("/").slice(0, -1).filter(Boolean);
    const canonicalPath = [...parentSegments, entry.title].join("/");
    const note = canonicalPath !== path
        ? ` Address future reads/moves with path \`${canonicalPath}\`.`
        : "";
    return (0, respond_1.ok)(`Wrote \`${canonicalPath}\` (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}\nView in Dopl: ${webUrl}`);
}
async function opMoveFile(client, ref, from_path, to_path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let result;
    try {
        result = await client.moveKbByPath(base.id, from_path, to_path);
    }
    catch (e) {
        // F-10b: read-only-to-agents base — clean message, not a raw
        // AGENT_WRITE_DISABLED dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    if (result.kind !== "entry") {
        return (0, respond_1.err)(`Path "${from_path}" resolved to a ${result.kind}, not an entry.`);
    }
    return (0, respond_1.ok)(`Entry moved: \`${from_path}\` → \`${to_path}\`.`);
}
async function opRestoreFolder(client, folder_id) {
    let folder;
    try {
        folder = await client.restoreKbFolder(folder_id);
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`Can't restore this folder — an ancestor folder is still in the trash. Restore the ancestor first (dopl_kb(op="list_trash") to find it); restoring a folder brings its contents back.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Restored folder **${folder.name}** (id: \`${folder.id}\`).`);
}
async function opRestoreFile(client, entry_id) {
    let entry;
    try {
        entry = await client.restoreKbEntry(entry_id);
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`Can't restore this entry — its parent folder is still in the trash. Restore the folder first (dopl_kb(op="list_trash") to find it); restoring a folder brings its contents back.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Restored entry **${entry.title}** (id: \`${entry.id}\`).`);
}
