"use strict";
/**
 * `dopl_kb_admin` DESTRUCTIVE op handlers: delete_base, delete_folder,
 * delete_file. Every op is a soft-delete (restorable from trash). The
 * agent-write-denied (403) mapping keeps read-only bases from throwing raw.
 * Routed from the registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opDeleteBase = opDeleteBase;
exports.opDeleteFolder = opDeleteFolder;
exports.opDeleteFile = opDeleteFile;
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
async function opDeleteBase(client, ref) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    try {
        await client.deleteKbBase(base.id);
    }
    catch (e) {
        // F-10: a base flagged read-only to agents rejects agent deletes.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    return (0, respond_1.ok)(`Deleted **${base.name}** (slug: \`${base.slug}\`). Restore with \`dopl_kb(op='restore_base')\`.`);
}
async function opDeleteFolder(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let result;
    try {
        result = await client.deleteKbByPath(base.id, path);
    }
    catch (e) {
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    if (result.kind !== "folder") {
        return (0, respond_1.err)(`Path "${path}" resolved to a ${result.kind}, not a folder. ` +
            `Use \`dopl_kb_admin(op='delete_file')\` for entries.`);
    }
    return (0, respond_1.ok)(`Folder deleted at \`${path}\`.`);
}
async function opDeleteFile(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let result;
    try {
        result = await client.deleteKbByPath(base.id, path);
    }
    catch (e) {
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    if (result.kind !== "entry") {
        return (0, respond_1.err)(`Path "${path}" resolved to a ${result.kind}, not an entry. ` +
            `Use \`dopl_kb_admin(op='delete_folder')\` for folders.`);
    }
    return (0, respond_1.ok)(`Entry deleted at \`${path}\`. Restore via \`dopl_kb(op='list_trash')\` + \`dopl_kb(op='restore_file')\`.`);
}
