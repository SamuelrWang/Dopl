"use strict";
/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility
 * on bases, create/move folders, write/move entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreateBase = opCreateBase;
exports.opUpdateBase = opUpdateBase;
exports.opSetVisibility = opSetVisibility;
exports.opPin = opPin;
exports.opCreateFolder = opCreateFolder;
exports.opMoveFolder = opMoveFolder;
exports.opWriteFile = opWriteFile;
exports.opMoveFile = opMoveFile;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const confirm_token_1 = require("./confirm-token");
const shelf_1 = require("./shelf");
/**
 * ⚠ Write confirmations read back the STORED value, not the argument (a
 * canonicalised base name, a title derived from a path), spliced into our own
 * narration — and a path can carry a backtick, since `NAME_RE` bans control and
 * zero-width characters, NOT markdown. A name is a VALUE.
 */
const NO_NAME = "`(unnamed)`";
const NO_PATH = "`(unreadable path)`";
/**
 * A 403 `AGENT_WRITE_DISABLED` off `create_base` — ⚠ duck-typed on the CODE, the
 * shape `homeShelfForbidden` above established, so no new error class crosses
 * the package boundary. Returns the server's own sentence, which is the one
 * place this refusal is worded.
 */
function agentCreateForbidden(e) {
    if (typeof e !== "object" || e === null)
        return null;
    if (e.status !== 403)
        return null;
    if (e.code !== "AGENT_WRITE_DISABLED")
        return null;
    const msg = e.apiMessage;
    const detail = typeof msg === "string" && msg
        ? msg
        : "An agent cannot create a knowledge base here.";
    return `${detail} Nothing was created — no row, no slug taken, so retrying the same call will fail the same way.`;
}
/**
 * 🔒 CREATE, ON EITHER SHELF, WITH THE TWO GATES THE SPEC PUTS AROUND IT.
 *
 * 1. **THE SHELF CONTRADICTION IS REFUSED LOCALLY, BEFORE THE ROUND TRIP**
 *    (spec §7.2, the `channel-ops-write.ts` refuse-before-send idiom).
 *    `shelf: "personal"` sends `homeScoped: true` + `visibility: "private"`, so
 *    an explicit `visibility: "public"` beside it is two incompatible
 *    instructions — and the server's 403 ("the /home shelf holds private bases
 *    only") is correct but reads as a permission problem rather than as
 *    something the caller can fix by dropping one argument.
 *
 * 2. 🔒 **THE HOME-SHELF FENCE STAYS THE SERVER'S.**
 *    `src/features/knowledge/server/service-base-writes.ts › resolveHomeScope`
 *    wants a PERSON's credential, a PRIVATE row, and the caller's OWN default
 *    standard workspace, all three, and 403s otherwise. Nothing here relaxes it
 *    — `shelf.ts › homeShelfForbidden` only makes the refusal actionable.
 *
 * 3. ⚠ **THE CONFIRM GATE IS A TRIPWIRE** (see `confirm-token.ts`). It fires
 *    only for `visibility: "public"` inside a SHARED link container — a base
 *    published into the room a peer is standing in, which is the knowledge half
 *    of the audience-changing class. It does NOT fire in a standard workspace:
 *    `set_visibility` has published bases workspace-wide with no confirm since
 *    long before this wave, and gating one door and not the other would be
 *    theatre.
 */
async function opCreateBase(client, callerUserId, input) {
    const personal = input.shelf === "personal";
    if (personal && input.visibility !== undefined && input.visibility !== "private") {
        return (0, respond_1.err)(`Refused before sending: shelf="personal" and visibility="${input.visibility}" contradict each other, so nothing was created. Your personal shelf holds PRIVATE bases only — a public base on it would be readable by every member on a surface no member navigates to. Either drop \`visibility\` (personal implies private) or drop \`shelf\`.`);
    }
    const visibility = personal ? "private" : input.visibility;
    const verdict = await (0, confirm_token_1.confirmGate)(client, {
        tool: "dopl_kb",
        op: "create_base",
        callerUserId,
        what: `a knowledge base named ${(0, narration_1.inlineOr)(input.name, NO_NAME)}, readable by the whole home channel`,
        audience: `everyone in that home channel — the peer standing in it can list it and read everything you put in it`,
        payload: {
            name: input.name,
            description: input.description ?? null,
            visibility: visibility ?? null,
            shelf: input.shelf ?? null,
        },
    }, { publishes: visibility === "public", token: input.confirm_token });
    if (verdict.kind === "halt")
        return verdict.response;
    let base;
    try {
        base = await client.createKbBase({
            name: input.name,
            description: input.description,
            visibility,
            // 🔒 G16 — THE TOKEN, SPENT, BECOMES THE SERVER'S PRECONDITION. Only ever
            // `true`, and only from a token this call actually consumed. See
            // `confirm-token.ts › ConfirmVerdict`.
            acknowledgeShared: verdict.acknowledgedShared || undefined,
            // ⚠ Only ever `true` — an explicit `false` and an omission mean the same
            // thing to `resolveHomeScope` ("the default is false and silent").
            homeScoped: personal ? true : undefined,
        });
    }
    catch (e) {
        const home = (0, shelf_1.homeShelfForbidden)(e);
        if (home)
            return (0, respond_1.err)(home);
        // ⚠ THE AUDIENCE CEILING'S CREATE REFUSAL, RENDERED AS A REFUSAL rather
        // than rethrown as a transport-shaped error (F-323's authoring half). The
        // server's message already names the room, the cause and the remedy —
        // `knowledge/server/service-base-writes.ts › assertCreatorCanReadItBack` —
        // and this is the one path where an agent MUST be able to act on it without
        // opening the repo, because the alternative it used to get was a SUCCESS
        // string over a row it could never see again.
        const ceiling = agentCreateForbidden(e);
        if (ceiling)
            return (0, respond_1.err)(ceiling);
        // 🔒 G16 — only ever a RACE here: the gate above already previewed and spent
        // a token, so reaching this means the room gained a member in between.
        const unacknowledged = (0, confirm_token_1.containerPublishUnacknowledged)(e, confirm_token_1.RECONFIRM_REMEDY);
        if (unacknowledged)
            return unacknowledged;
        throw e;
    }
    const visNote = base.visibility === "private"
        ? "Private to you — only you and your agent can see it."
        : "Visible to the whole workspace.";
    const shelfNote = personal
        ? " It is on your personal shelf, so the workspace Knowledge page will not list it."
        : "";
    return (0, respond_1.ok)(`Created knowledge base ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${visNote}${shelfNote}`);
}
/**
 * ⚠ THE SHELF IS NOT PATCHABLE, AND THE REFUSAL SAYS SO RATHER THAN IGNORING
 * THE ARG — the twin of `agent-ops-write.ts › opUpdate`'s, word for word in
 * substance. `home_scoped` is set at create and never written again for bases
 * and templates alike (F-342; Samuel's ruling Q8, 2026-08-28 keeps it that way
 * for v1), and the server's update schema does not accept it — so a silently
 * dropped `shelf` here would return a 2xx over a move that never happened.
 *
 * ⚠ `shelf` RIDES `dopl_kb`'s SHARED OP SCHEMA, so it is spellable on every op;
 * this is the ONE other op where it would read as an instruction the server
 * carried out. The reads ignore it exactly as `dopl_agent(op="get")` does.
 */
async function opUpdateBase(client, ref, name, description, slug, shelf) {
    if (shelf !== undefined) {
        return (0, respond_1.err)(`op="update_base" does not take \`shelf\`, and nothing was changed. A base's shelf is fixed when it is created and there is no move: to put an existing base on your personal shelf, create a NEW one there with op="create_base", shelf="personal". ⚠ The copy and the original are STRANGERS — writing to one never touches the other.`);
    }
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
        // Read-only-to-agents base — the clean message, not a raw
        // AGENT_WRITE_DISABLED dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        // ⚠ Name the field + rule, never a raw "VALIDATION_FAILED".
        const mapped = (0, knowledge_shared_1.updateBaseValidationError)(e);
        if (mapped)
            return mapped;
        throw e;
    }
    return (0, respond_1.ok)(`Updated ${(0, narration_1.inlineOr)(updated.name, NO_NAME)} (slug: \`${updated.slug}\`).`);
}
/**
 * ⚠ **THE OTHER PUBLISHING DOOR, AND IT IS NOT PREVIEWED HERE — DELIBERATELY,
 * AND ONLY FOR NOW.** This file used to argue that gating `create_base` and not
 * `set_visibility` "would be theatre". Since G16 the SERVER gates both
 * (`src/features/knowledge/server/service-base-writes.ts › updateBase` →
 * `features/workspaces/server/shared-publish.ts`), so the asymmetry moved: an
 * agent publishing into a shared home channel is now REFUSED here rather than
 * silently allowed, and {@link containerPublishUnacknowledged} is what makes
 * that refusal legible.
 *
 * ⚠ **THE PREVIEW CANNOT BE ADDED FROM THIS FILE.** `confirmGate` needs the
 * caller's user id and the call's `confirm_token`, and this op's registrar arm
 * (`tools/knowledge.ts`) passes neither — that file is owned by another slice of
 * this wave, so the plumbing is a CROSS-SLICE REQUEST, not an edit made here.
 * Until it lands, a shared-container publish through this op is a refusal with a
 * remedy the operator can act on, which is strictly better than the silent
 * publish it replaces.
 *
 * ⚠ NOTHING CHANGES IN A STANDARD WORKSPACE — the server's predicate is
 * `kind='link'` ∧ ≥2 members, and publishing to colleagues costs no extra call.
 */
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
        // Read-only-to-agents base — the clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        // 🔒 G16 — the server's publish precondition. See the docblock above for
        // why this op answers with a REMEDY rather than a preview.
        const unacknowledged = (0, confirm_token_1.containerPublishUnacknowledged)(e, `This op has no preview step, so it cannot make that acknowledgement for you: ask your operator to publish the base from the Dopl app, where the audience change is stated before they press.`);
        if (unacknowledged)
            return unacknowledged;
        throw e;
    }
    return (0, respond_1.ok)(`Published knowledge base ${(0, narration_1.inlineOr)(updated.name, NO_NAME)} (slug: \`${updated.slug}\`) — now visible workspace-wide.`);
}
/**
 * PINNED STARTUP CONTEXT (T81) — put a base (or one entry of it) into what every
 * agent session launched in this workspace is handed at startup, or take it out.
 *
 * ⚠ ONE HANDLER, TWO OPS, AND THE BOOLEAN IS THE ONLY DIFFERENCE. `pin` and
 * `unpin` are separate ops rather than one op with a flag for the reason the
 * REST routes are two verbs: a request that states the END STATE is safe to
 * retry after an ambiguous failure, where a toggle silently un-does a write that
 * landed. On workspace-wide state that un-do changes what every session started
 * afterwards begins with.
 *
 * ⚠ `path` IS WHAT PICKS THE TARGET, and the two are different objects: with a
 * path this pins ONE ENTRY, without it the WHOLE BASE. The result says which,
 * because an agent that believes it pinned a base when it pinned one document
 * will not pin the rest.
 *
 * ⚠ THE ENTRY LOOKUP IS A READ THROUGH THE ORDINARY PATH RESOLVER, so an
 * unreadable base or a path that names a FOLDER refuses before anything is
 * written — the server's own gates (`service-pins.ts › pinEntry` chases the
 * entry up to its base) are what actually refuse; this only makes the refusal
 * legible.
 */
async function opPin(client, ref, path, pinned) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    const verb = pinned ? "Pinned" : "Unpinned";
    try {
        if (path === undefined || path === "") {
            await client.setKbBasePinned(base.id, pinned);
            return (0, respond_1.ok)(`${verb} knowledge base ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${pinned ? "Every entry in it is now included in the startup context of agent sessions launched in this workspace." : "Its entries are no longer included in the startup context of new agent sessions."}`);
        }
        const entry = await client.readKbFileByPath(base.id, path);
        await client.setKbEntryPinned(entry.id, pinned);
        return (0, respond_1.ok)(`${verb} ${(0, narration_1.inlineOr)(path, NO_PATH)} in ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (entry id: \`${entry.id}\`). ${pinned ? "This ONE entry is now included in the startup context of agent sessions launched in this workspace — the rest of the base is not." : "It is no longer included on its own; if its BASE is pinned it still arrives with the base."}`);
    }
    catch (e) {
        // Read-only-to-agents base — clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No entry at ${(0, narration_1.inlineOr)(path, NO_PATH)} in ${(0, narration_1.inlineOr)(base.name, NO_NAME)}, so nothing was ${pinned ? "pinned" : "unpinned"}. Paths must resolve to an ENTRY, not a folder — check dopl_kb(op="get_tree", base) for the exact path, or omit \`path\` to ${pinned ? "pin" : "unpin"} the whole base.`);
        }
        throw e;
    }
}
async function opCreateFolder(client, ref, path, description) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let folder;
    try {
        folder = await client.createKbFolderByPath(base.id, path, description);
    }
    catch (e) {
        // Read-only-to-agents base — clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    const descNote = description !== undefined ? " Description set." : "";
    return (0, respond_1.ok)(`Folder ready at ${(0, narration_1.inlineOr)(path, NO_PATH)} (id: \`${folder.id}\`).${descNote}`);
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
        // Read-only-to-agents base — clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    if (result.kind !== "folder") {
        return (0, respond_1.err)(`Path ${(0, narration_1.inlineOr)(from_path, NO_PATH)} resolved to a ${result.kind}, not a folder.`);
    }
    return (0, respond_1.ok)(`Folder moved: ${(0, narration_1.inlineOr)(from_path, NO_PATH)} → ${(0, narration_1.inlineOr)(to_path, NO_PATH)}.`);
}
async function opWriteFile(client, ref, path, body, title, expected_version, force, excerpt) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let entry;
    try {
        const res = await client.writeKbFileByPath(base.id, path, { body, title, excerpt }, force ? null : expected_version);
        entry = res.entry;
    }
    catch (e) {
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`${(0, narration_1.inlineOr)(path, NO_PATH)} changed since you last read it. Call dopl_kb(op="read_file", base, path) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`);
        }
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`An entry titled ${(0, narration_1.inlineOr)(title ?? path.split("/").filter(Boolean).pop(), NO_NAME)} already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`);
        }
        // Read-only-to-agents base — clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        // ⚠ Name the failing field + rule, never a raw "VALIDATION_FAILED".
        const mapped = (0, knowledge_shared_1.writeFileValidationError)(e, title);
        if (mapped)
            return mapped;
        throw e;
    }
    // ⚠ The addressable path's leaf is the entry's TITLE, not the input path's
    // leaf segment — print it, and surface the canonical form when a passed
    // `title` slugs differently from the input leaf.
    const parentSegments = path.split("/").slice(0, -1).filter(Boolean);
    const canonicalPath = [...parentSegments, entry.title].join("/");
    const note = canonicalPath !== path
        ? ` Address future reads/moves with path ${(0, narration_1.inlineOr)(canonicalPath, NO_PATH)}.`
        : "";
    return (0, respond_1.ok)(`Wrote ${(0, narration_1.inlineOr)(canonicalPath, NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}`);
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
        // Read-only-to-agents base — clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
    if (result.kind !== "entry") {
        return (0, respond_1.err)(`Path ${(0, narration_1.inlineOr)(from_path, NO_PATH)} resolved to a ${result.kind}, not an entry.`);
    }
    return (0, respond_1.ok)(`Entry moved: ${(0, narration_1.inlineOr)(from_path, NO_PATH)} → ${(0, narration_1.inlineOr)(to_path, NO_PATH)}.`);
}
