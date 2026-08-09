"use strict";
/**
 * `dopl_kb_admin` DESTRUCTIVE op handlers: delete_base, delete_folder,
 * delete_file. Deletion is permanent — there is no trash to restore from. The
 * agent-write-denied (403) mapping keeps read-only bases from throwing raw.
 * Routed from the registrar in knowledge.ts.
 *
 * UNREACHABLE since §2b: `server.ts` refuses every op on this tool before
 * dispatch (`delete-policy.ts`). Kept so the capability returns by removing the
 * gate rather than by rewriting handlers — which is also why their narration
 * has to stay honest about what a delete would actually do.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opDeleteBase = opDeleteBase;
exports.opDeleteFolder = opDeleteFolder;
exports.opDeleteFile = opDeleteFile;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
/** Same rule as the write ops: a stored name or a path is a value. */
const NO_NAME = "`(unnamed)`";
const NO_PATH = "`(unreadable path)`";
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
    return (0, respond_1.ok)(`Deleted ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (slug: \`${base.slug}\`) and everything in it. Permanent — there is nothing to restore it from.`);
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
        return (0, respond_1.err)(`Path ${(0, narration_1.inlineOr)(path, NO_PATH)} resolved to a ${result.kind}, not a folder. ` +
            `Use \`dopl_kb_admin(op='delete_file')\` for entries.`);
    }
    return (0, respond_1.ok)(`Folder deleted at ${(0, narration_1.inlineOr)(path, NO_PATH)}.`);
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
        return (0, respond_1.err)(`Path ${(0, narration_1.inlineOr)(path, NO_PATH)} resolved to a ${result.kind}, not an entry. ` +
            `Use \`dopl_kb_admin(op='delete_folder')\` for folders.`);
    }
    return (0, respond_1.ok)(`Entry deleted at ${(0, narration_1.inlineOr)(path, NO_PATH)}. Permanent — there is nothing to restore it from.`);
}
