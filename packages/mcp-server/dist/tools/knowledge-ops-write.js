"use strict";
/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility/grant
 * on bases, create/move folders, write/move entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreateBase = opCreateBase;
exports.opUpdateBase = opUpdateBase;
exports.opSetVisibility = opSetVisibility;
exports.opCreateFolder = opCreateFolder;
exports.opMoveFolder = opMoveFolder;
exports.opWriteFile = opWriteFile;
exports.opMoveFile = opMoveFile;
exports.opGrantBase = opGrantBase;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const confirm_token_1 = require("./confirm-token");
const knowledge_sections_1 = require("./knowledge-sections");
const grant_1 = require("./grant");
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
 * shape every mapper in this file follows, so no new error class crosses the
 * package boundary. Returns the server's own sentence, which is the one
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
 * 🔒 CREATE, WITH THE ONE GATE THE SPEC PUTS AROUND IT.
 *
 * ⚠ **THE TWO SHELF RULES THIS DOCBLOCK OPENED WITH ARE GONE (2026-09-02, slice
 * B15, ruling B10)** — the local shelf/visibility contradiction and the server's
 * `resolveHomeScope`. The `home_scoped` column is dropped and a personal base is
 * an ordinary row in the caller's own `kind='personal'` container, so there is
 * no second shelf for a `public` base to contradict.
 *
 * ⚠ **THE CONFIRM GATE IS A TRIPWIRE** (see `confirm-token.ts`). It fires
 *    only for `visibility: "public"` inside a SHARED link container — a base
 *    published into the room a peer is standing in, which is the knowledge half
 *    of the audience-changing class. It does NOT fire in a standard workspace:
 *    `set_visibility` has published bases workspace-wide with no confirm since
 *    long before this wave, and gating one door and not the other would be
 *    theatre.
 */
async function opCreateBase(client, callerUserId, input) {
    // 🔒 **ALWAYS SENT, NEVER LEFT TO THE SERVER'S DEFAULT** (2026-09-02) — the same
    // rule and the same reason as `agent-ops-write.ts › opCreate`, which states it
    // in full: the server's default is credential-dependent, this process cannot
    // see which credential it holds, and an omitted value let a SHARED credential
    // resolve to `public`, trip G16 and answer a 400 whose remedy was "preview
    // again" — the thing the caller had just done. `"private"` is what this tool's
    // `visibility` description already promises as the default.
    const visibility = input.visibility ?? "private";
    const verdict = await (0, confirm_token_1.confirmGate)(client, {
        tool: "dopl_kb",
        op: "create_base",
        callerUserId,
        what: `a knowledge base named ${(0, narration_1.inlineOr)(input.name, NO_NAME)}, readable by the whole home channel`,
        audience: `everyone in that home channel — the peer standing in it can list it and read everything you put in it`,
        payload: {
            name: input.name,
            description: input.description ?? null,
            visibility,
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
        });
    }
    catch (e) {
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
    return (0, respond_1.ok)(`Created knowledge base ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${visNote}`);
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
 * ⚠ **THE PREVIEW IS HERE SINCE 2026-09-02 (F-441, integration of A3 × A11).**
 * It was a cross-slice request while `tools/knowledge.ts` belonged to another
 * slice: `confirmGate` needs the caller's user id and the call's
 * `confirm_token`, and that arm passed neither, so a shared-container publish
 * answered with a refusal-plus-remedy instead of a preview. Both are plumbed
 * now, and this op previews and confirms exactly as `create_base` does — one
 * mechanism for one act, which is the whole of G16.
 *
 * ⚠ **THE REFUSAL PATH BELOW STAYS AND IS NOT DEAD CODE.** `confirmGate` fires
 * on the SHAPE this process can see (a shared link container); the server's own
 * predicate is the authority and includes facts this process cannot check. A
 * 400 from it still has to be legible, and {@link containerPublishUnacknowledged}
 * is what makes it so. Removing either half leaves one door unguarded.
 *
 * ⚠ NOTHING CHANGES IN A STANDARD WORKSPACE — the server's predicate is
 * `kind='link'` ∧ ≥2 members, and publishing to colleagues costs no extra call.
 */
async function opSetVisibility(client, callerUserId, ref, visibility, confirmToken) {
    if (visibility !== "public") {
        return (0, respond_1.err)(`set_visibility only publishes (visibility="public") a base you created. Un-publishing is human-only — use the Dopl web UI.`);
    }
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    // 🔒 G16 — PREVIEW, THEN PUBLISH. Resolved AFTER the base, deliberately: the
    // name the preview shows the operator has to be the base this call is about,
    // and a token minted over a base that does not resolve confirms nothing.
    const verdict = await (0, confirm_token_1.confirmGate)(client, {
        tool: "dopl_kb",
        op: "set_visibility",
        callerUserId,
        what: `the knowledge base ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (slug: \`${base.slug}\`), published workspace-wide`,
        audience: `everyone in that home channel — the peer standing in it can read everything in it, including what was written while it was private`,
        payload: { base: base.id, visibility: "public" },
    }, { publishes: true, token: confirmToken });
    if (verdict.kind === "halt")
        return verdict.response;
    let updated;
    try {
        updated = await client.updateKbBase(base.id, {
            visibility: "public",
            // 🔒 The token, SPENT, becomes the server's precondition — the same
            // mapping `create_base` makes, one op over.
            acknowledgeShared: verdict.acknowledgedShared || undefined,
        });
    }
    catch (e) {
        // Read-only-to-agents base — the clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        // 🔒 G16 — the server's publish precondition. See the docblock above for
        // why this op answers with a REMEDY rather than a preview.
        const unacknowledged = (0, confirm_token_1.containerPublishUnacknowledged)(e, `This call already previewed and confirmed, so the server is refusing on a fact this process cannot see — re-previewing would answer the same. Ask your operator to publish the base from the Dopl app, where the audience change is stated before they press.`);
        if (unacknowledged)
            return unacknowledged;
        throw e;
    }
    return (0, respond_1.ok)(`Published knowledge base ${(0, narration_1.inlineOr)(updated.name, NO_NAME)} (slug: \`${updated.slug}\`) — now visible workspace-wide.`);
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
/**
 * ⚠ **`section` MAKES THIS A READ-MODIFY-WRITE, AND THE SERVER DOES ALL THREE.**
 * The splice happens against the row `expected_version` was just checked on, so
 * a sectioned write is exactly as safe as a whole-body one — where a caller
 * merging locally would be merging onto a body it fetched in an earlier request.
 *
 * ⚠ **THE RESULT ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which is the
 * addresses the next read can use, and it LEADS with `reason=UNSECTIONED` when a
 * long body carries no headings at all. **The write lands either way** (Samuel's
 * ruling): refusing would refuse the user's content over our formatting taste.
 */
async function opWriteFile(client, ref, path, body, title, expected_version, force, excerpt, section) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    let entry;
    let outline;
    let sectionCreated;
    try {
        const res = await client.writeKbFileByPath(base.id, path, { body, title, excerpt, section }, force ? null : expected_version);
        entry = res.entry;
        outline = res.outline;
        sectionCreated = res.sectionCreated;
    }
    catch (e) {
        // ⚠ THE ONE REFUSAL `section` ADDS, and it is a refusal rather than a
        // first-match because the write it would have made is unrecoverable.
        if ((0, respond_1.isApiError)(e, 409, "KNOWLEDGE_SECTION_AMBIGUOUS")) {
            return (0, respond_1.err)(`reason=SECTION_AMBIGUOUS · ${(0, respond_1.apiMessage)(e) ?? "that heading names more than one section."} · retry=none, they have the same name\n\nNOTHING was written. Rename one of them, or drop \`section\` and write the whole body.`);
        }
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
    // ⚠ THE NUDGE LEADS, because a `reason=` line read after the success sentence
    // is a line an agent has already decided it does not need.
    const unsectioned = entry.body.length > knowledge_sections_1.KB_SECTION_NUDGE_CHARS &&
        (outline?.sections.length ?? 0) === 0;
    const sectionNote = section === undefined
        ? ""
        : sectionCreated
            ? ` Section ${(0, narration_1.inlineOr)(section, "`(unreadable)`")} did not exist and was APPENDED at \`##\` level.`
            : ` Replaced section ${(0, narration_1.inlineOr)(section, "`(unreadable)`")}; the rest of the entry is untouched.`;
    return (0, respond_1.ok)([
        ...(unsectioned ? [(0, knowledge_sections_1.unsectionedNudge)(), ""] : []),
        `Wrote ${(0, narration_1.inlineOr)(canonicalPath, NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}${sectionNote}`,
        ...[(0, knowledge_sections_1.outlineFooter)(outline)].filter((l) => l !== null),
    ].join("\n"));
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
/**
 * `op="grant"` — lend ONE base to a channel, container or team. The op that
 * REPLACED `op="copy_base"` (Wave B slice B15, ruling B11).
 *
 * ⚠ **THE RESOLVE IS THE ORDINARY ONE.** `resolveBaseOr` answers what this
 * caller may see, `notOwnedRefusal` then narrows that to what they CREATED (R2),
 * and the server repeats both — this tier exists to spend no round trip on a
 * refusal it can already prove and to say WHY, where the server's uniform 404
 * deliberately cannot.
 */
async function opGrantBase(client, directory, selfUserId, ref, scope, to, level) {
    const chosen = (0, grant_1.levelForScope)(scope, level);
    if ((0, grant_1.isGrantRefusal)(chosen))
        return chosen;
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    const notOwned = (0, grant_1.notOwnedRefusal)(base.createdBy, selfUserId, "knowledge base", base.name);
    if (notOwned)
        return notOwned;
    const scopeId = await (0, grant_1.resolveGrantScopeId)(directory, scope, to);
    if ((0, grant_1.isGrantRefusal)(scopeId))
        return scopeId;
    await client.grantResource({
        resourceType: "knowledge_base",
        resourceId: base.id,
        scopeType: scope,
        scopeId,
        level: chosen,
    });
    return (0, grant_1.grantedLine)("knowledge base", base.name, scope, scopeId, chosen);
}
