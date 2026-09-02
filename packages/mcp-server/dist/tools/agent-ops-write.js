"use strict";
/**
 * `dopl_agent` WRITE op handlers: create, update. Routed from the registrar in
 * `agent.ts`.
 *
 * ── THE THREE THINGS EVERY LINE IN HERE RESPECTS ──────────────────────────
 *
 * 1. 🔒 **THE HOME-SHELF FENCE IS THE SERVER'S, AND IT REFUSES RATHER THAN
 *    DOWNGRADING.** `src/features/agent-templates/server/service-writes.ts ›
 *    resolveTemplateHomeScope` wants three things at once — a credential that
 *    stands for a PERSON, a PRIVATE row, and the caller's OWN default standard
 *    workspace — and 403s otherwise. Nothing here relaxes it; the only local
 *    work is REFUSING A CONTRADICTION BEFORE THE ROUND TRIP (spec §7.2), the
 *    `channel-ops-write.ts` refuse-before-send idiom.
 *
 * 2. ⚠ **A CONTAINER-LOCKED SESSION IS REFUSED BY B1, NOT BY THE SHELF FENCE,
 *    AND THE TWO MUST NOT BE CONFUSED.** That confusion IS F-336. A container
 *    session is NOT a shared credential — it is one human's session, it owns
 *    private rows exactly as its operator does — and what stops it writing the
 *    operator's personal shelf is the credential's workspace lock answering 403
 *    first. Nothing in this file lets it reach that shelf, and nothing should.
 *
 * 3. ⚠ **THE CONFIRM GATE IS A TRIPWIRE, AND SINCE G16 IT FEEDS A FENCE.** See
 *    `confirm-token.ts`'s header for the tripwire half — nothing here stops an
 *    agent previewing and echoing the token back without showing a human. What
 *    is new is that a SPENT token now sets `acknowledgeShared: true` on the
 *    write body, and `src/features/workspaces/server/shared-publish.ts` 400s
 *    the write WITHOUT it: an agent that skips the preview no longer skips the
 *    refusal, because the refusal belongs to the server that owns the rows.
 *    It fires only for a row landing at `visibility: "workspace"` inside a SHARED
 *    link container — publishing the operator's agent identity into the room a
 *    peer is standing in, which is precisely the argument
 *    `lib/template-draft.ts › containerCopyDraft` was reversed over on
 *    2026-08-27.
 *    ⚠ IT READS THE EXPLICIT `visibility` ONLY. An OMITTED visibility takes the
 *    server's default, which is `private` for every credential that stands for a
 *    person and `workspace` for one that does not — and a credential that does
 *    not is `isSharedCredential`, which B1 keeps out of containers entirely. So
 *    the omitted case cannot publish into a shared room; said here because the
 *    reasoning is not local to this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreate = opCreate;
exports.opUpdate = opUpdate;
const narration_js_1 = require("./narration.js");
const respond_js_1 = require("./respond.js");
const confirm_token_js_1 = require("./confirm-token.js");
const shelf_js_1 = require("./shelf.js");
const agent_shared_js_1 = require("./agent-shared.js");
/**
 * ⚠ THE CONTRADICTION, REFUSED LOCALLY AND BY NAME. `shelf:"personal"` sends
 * `visibility: "private"`, so an explicit non-private visibility beside it is
 * two incompatible instructions — and the server would answer a 403 whose
 * `reason` ("the home shelf holds private agents only") is correct but reads as
 * a permission problem rather than as a contradiction the caller can fix.
 */
function shelfVisibilityContradiction(input) {
    if (input.shelf !== "personal")
        return null;
    if (input.visibility === undefined || input.visibility === "private")
        return null;
    return (0, respond_js_1.err)(`Refused before sending: shelf="personal" and visibility="${input.visibility}" contradict each other, so nothing was created. Your personal shelf holds PRIVATE agents only — a template there has exactly one consumer, which is the whole reason it can be called yours. Either drop \`visibility\` (personal implies private) or drop \`shelf\` and share it on the workspace shelf.`);
}
/** Map the write errors that have an actionable sentence; rethrow anything
 *  else. ⚠ ONE mapper for both verbs so the two cannot answer differently. */
function mapWriteError(e) {
    const home = (0, shelf_js_1.homeShelfForbidden)(e);
    if (home)
        return (0, respond_js_1.err)(home);
    // 🔒 G16 — only ever a RACE on these two verbs: `confirmGate` already
    // previewed and spent a token, so reaching this means the room gained a
    // member in between.
    const unacknowledged = (0, confirm_token_js_1.containerPublishUnacknowledged)(e, confirm_token_js_1.RECONFIRM_REMEDY);
    if (unacknowledged)
        return unacknowledged;
    return ((0, agent_shared_js_1.sharedCredentialPrivateDenied)(e) ??
        (0, agent_shared_js_1.knowledgeBaseNotAttachable)(e) ??
        (0, agent_shared_js_1.templateWriteDenied)(e));
}
async function opCreate(client, callerUserId, input) {
    const contradiction = shelfVisibilityContradiction(input);
    if (contradiction)
        return contradiction;
    const personal = input.shelf === "personal";
    // ⚠ `shelf:"personal"` must SEND `visibility: "private"` explicitly, or the
    // server's condition 2 refuses on a default the agent never chose.
    const visibility = personal
        ? "private"
        : input.visibility;
    const verdict = await (0, confirm_token_js_1.confirmGate)(client, {
        tool: "dopl_agent",
        op: "create",
        callerUserId,
        what: `an agent template named ${(0, narration_js_1.inlineOr)(input.name, agent_shared_js_1.NO_NAME)}, shared with the whole home channel`,
        audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
        payload: {
            name: input.name,
            description: input.description ?? null,
            instructions: input.instructions ?? null,
            model: input.model ?? null,
            visibility: visibility ?? null,
            shelf: input.shelf ?? null,
            knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
            fields: (input.fields ?? []).map((f) => [f.key, f.value]),
        },
    }, { publishes: visibility === "workspace", token: input.confirm_token });
    if (verdict.kind === "halt")
        return verdict.response;
    const body = {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        model: input.model,
        fields: input.fields,
        visibility,
        knowledgeBaseIds: input.knowledge_bases,
        // 🔒 G16 — THE TOKEN, SPENT, BECOMES THE SERVER'S PRECONDITION. Only ever
        // `true`, and only from a token this call actually consumed: the server
        // ignores the flag outside its predicate, and sending it on a proceed that
        // showed nobody anything would re-create the client-side confirm this
        // replaces. See `confirm-token.ts › ConfirmVerdict`.
        acknowledgeShared: verdict.acknowledgedShared || undefined,
        // ⚠ Only ever `true` — an explicit `false` and an omission mean the same
        // thing to `resolveTemplateHomeScope` ("the default is false and silent"),
        // and sending `false` would suggest to a reader that it is examined.
        homeScoped: personal ? true : undefined,
    };
    let template;
    try {
        template = await client.createAgentTemplate(body);
    }
    catch (e) {
        const mapped = mapWriteError(e);
        if (mapped)
            return mapped;
        throw e;
    }
    const where = personal
        ? "on your personal shelf"
        : "on this workspace's shelf";
    const audience = template.visibility === "private"
        ? "Private to you — only you and your own agents can see it."
        : template.visibility === "team"
            ? "Shared with the teams you linked."
            : "Shared with everyone in this workspace — every member can list it and launch it.";
    return (0, respond_js_1.ok)([
        `Created agent template ${(0, narration_js_1.inlineOr)(template.name, agent_shared_js_1.NO_NAME)} ${where} (id: \`${template.id}\`). ${audience}`,
        `Launch it into a channel with dopl_channel(op="launch_agent", channel=…, template="${template.id}") — which ASKS the operator's machine and does not start anything by itself.`,
    ].join("\n"));
}
/**
 * ⚠ THE SHELF IS NOT PATCHABLE, AND THE REFUSAL SAYS SO RATHER THAN IGNORING
 * THE ARG. `home_scoped` is set at create and never written again for bases and
 * templates alike (F-342; Samuel's ruling Q8, 2026-08-28 keeps it that way for
 * v1), and the server's update schema does not accept it — so a silently
 * dropped `shelf` here would return a 2xx over a move that never happened.
 */
async function opUpdate(client, callerUserId, ref, input) {
    if (input.shelf !== undefined) {
        return (0, respond_js_1.err)(`op="update" does not take \`shelf\`, and nothing was changed. A template's shelf is fixed when it is created and there is no move: to put an existing agent on your personal shelf, create a NEW one there with op="create", shelf="personal". ⚠ The copy and the original are STRANGERS — editing one never touches the other.`);
    }
    const patch = {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        model: input.model,
        fields: input.fields,
        visibility: input.visibility,
        knowledgeBaseIds: input.knowledge_bases,
    };
    if (Object.values(patch).every((v) => v === undefined)) {
        return (0, respond_js_1.err)(`op="update" changed nothing because no field was passed. Pass at least one of: name, description, instructions, model, fields, visibility, knowledge_bases.`);
    }
    const template = await (0, agent_shared_js_1.resolveTemplateOr)(client, ref);
    if ((0, agent_shared_js_1.isErr)(template))
        return template;
    const verdict = await (0, confirm_token_js_1.confirmGate)(client, {
        tool: "dopl_agent",
        op: "update",
        callerUserId,
        what: `sharing the agent template ${(0, narration_js_1.inlineOr)(template.name, agent_shared_js_1.NO_NAME)} (id: \`${template.id}\`) with the whole home channel`,
        audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
        payload: {
            template: template.id,
            name: patch.name ?? null,
            description: patch.description ?? null,
            instructions: patch.instructions ?? null,
            model: patch.model ?? null,
            visibility: patch.visibility ?? null,
            knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
            fields: (input.fields ?? []).map((f) => [f.key, f.value]),
        },
    }, { publishes: patch.visibility === "workspace", token: input.confirm_token });
    if (verdict.kind === "halt")
        return verdict.response;
    let updated;
    try {
        // 🔒 G16 — the spent token, as the server's precondition. ⚠ SET AFTER the
        // "changed nothing" check above, which counts only fields that move a
        // column: an acknowledgement is an assertion ABOUT a change, never one.
        updated = await client.updateAgentTemplate(template.id, {
            ...patch,
            acknowledgeShared: verdict.acknowledgedShared || undefined,
        });
    }
    catch (e) {
        const mapped = mapWriteError(e);
        if (mapped)
            return mapped;
        throw e;
    }
    const note = patch.visibility !== undefined
        ? ` Sharing is now: ${updated.visibility}.`
        : "";
    return (0, respond_js_1.ok)(`Updated agent template ${(0, narration_js_1.inlineOr)(updated.name, agent_shared_js_1.NO_NAME)} (id: \`${updated.id}\`).${note}`);
}
