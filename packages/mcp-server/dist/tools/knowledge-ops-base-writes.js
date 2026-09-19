"use strict";
/**
 * 🔒 **`dopl_kb`'s BASE-LEVEL WRITES — create, update, publish, grant** (split
 * out 2026-09-18).
 *
 * ⚠ **THE SPLIT IS THE 500-LINE CAP, AND THE SEAM IS THE SUBJECT.** Everything
 * here writes a BASE (its row, its visibility, who it is lent to);
 * `knowledge-ops-write.ts` writes what is INSIDE one (folders, entries, and the
 * authoring rules those entries owe). The two halves shared nothing but
 * {@link writeOr}, which is why that went to `knowledge-shared.ts` rather than
 * being re-exported from either side.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreateBase = opCreateBase;
exports.opUpdateBase = opUpdateBase;
exports.opSetVisibility = opSetVisibility;
exports.opGrantBase = opGrantBase;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const channel_shared_1 = require("./channel-shared");
const confirm_token_1 = require("./confirm-token");
const container_destination_1 = require("./container-destination");
const grant_1 = require("./grant");
/*
 * ⚠ Write confirmations read back the STORED value, not the argument (a
 * canonicalised base name), spliced into our own narration. A name is a VALUE.
 * The fallback itself is `narration.ts › NO_NAME` (2026-09-17).
 */
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
async function opCreateBase(client, callerUserId, input, 
/** ⚠ OPTIONAL — absent means "not known": the create goes out unshared and
 *  the SERVER refuses it (`container-destination.ts`). */
directory) {
    // 🔒 **DESTINATION 2, IN ONE SERVER CALL** (Samuel, 2026-09-18; the model is
    // `container-destination.ts`'s header). A home channel holds only what is
    // SHARED into it. ⚠ **THE BASE STAYS `private` AND THE GRANT IS THE AUDIENCE**,
    // which is why this does not touch `visibility` as the template lane does.
    const shareToChannelId = await (0, container_destination_1.resolveChannelShareTarget)(client, directory);
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
        what: `a knowledge base named ${(0, narration_1.inlineOr)(input.name, narration_1.NO_NAME)}, readable by the whole home channel`,
        audience: `everyone in that home channel — the peer standing in it can list it and read everything you put in it`,
        payload: {
            name: input.name,
            description: input.description ?? null,
            visibility,
            // ⚠ ON THE DIGEST: a token is bound to what LANDS, grant included.
            shareToChannelId: shareToChannelId ?? null,
        },
    }, {
        publishes: visibility === "public",
        token: input.confirm_token,
        // 🔒 **THE PREVIEW RUNS THE SAME GATE AS THE CONFIRMED CALL** (task 11's
        // missing pin). Observed live: this op previewed a public create in a
        // shared home channel, handed back a token, and the echoed call was then
        // refused by the server's create gate — the preview promised an act the
        // gate forbids.
        //
        // ⚠ **THE SERVER ANSWERS, BECAUSE THE SERVER REFUSES.** Whether a create
        // may land depends on the audience ceiling and on whether the operator
        // has armed this room for their personal shelf — grant rows and arming
        // rows this process cannot see. So the precheck asks the create's OWN
        // gate chain (`assertCreateBaseAllowed` behind `?dryRun=1`) rather than
        // re-deciding here, which is the only version of "the same gate" that
        // stays true after the next gate is added.
        //
        // ⚠ **THE BODY IS THE ONE THE CONFIRM WILL SEND**, `acknowledgeShared`
        // included: the confirmed call carries it from the spent token, and
        // asking without it would refuse on the missing acknowledgement — the
        // very thing this preview exists to obtain.
        precheck: async () => {
            try {
                await client.dryRunKbBase({
                    name: input.name,
                    description: input.description,
                    visibility,
                    // ⚠ PART OF THE CONFIRMED BODY: without it a dry run previews an
                    // act the gate forbids (2026-09-18).
                    shareToChannelId,
                    acknowledgeShared: true,
                });
            }
            catch (e) {
                // The server's own sentence, which already names the room, the cause
                // and the remedy — and it is TRUE of a dry run word for word:
                // nothing was created, no slug taken.
                const ceiling = agentCreateForbidden(e);
                if (ceiling)
                    return (0, respond_1.err)(ceiling);
                // ⚠ ANYTHING ELSE RETHROWS RATHER THAN MINTING. "I could not check"
                // is not "it is allowed", and the caller loses nothing by retrying:
                // no row was written and no token was spent.
                throw e;
            }
            return null;
        },
    });
    if (verdict.kind === "halt")
        return verdict.response;
    let base;
    try {
        base = await client.createKbBase({
            name: input.name,
            description: input.description,
            visibility,
            // 🔒 DESTINATION 2, ATOMIC — the base rolls back if the grant fails.
            shareToChannelId,
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
        // `knowledge/server/service-base-gates.ts › resolveCreateDestination` —
        // and this is the one path where an agent MUST be able to act on it without
        // opening the repo, because the alternative it used to get was a SUCCESS
        // string over a row it could never see again.
        const ceiling = agentCreateForbidden(e);
        if (ceiling)
            return (0, respond_1.err)(ceiling);
        // 🔒 The destination fence (2026-09-18): the probe fails open, so this is
        const unshared = (0, container_destination_1.homeChannelRowNotShared)(e); // the SERVER refusing.
        if (unshared)
            return unshared;
        // 🔒 G16 — only ever a RACE here: the gate above already previewed and spent
        // a token, so reaching this means the room gained a member in between.
        const unacknowledged = (0, confirm_token_1.containerPublishUnacknowledged)(e, confirm_token_1.RECONFIRM_REMEDY);
        if (unacknowledged)
            return unacknowledged;
        throw e;
    }
    // ⚠ THE GRANT IS THE AUDIENCE (2026-09-18): a shared base is stored `private`.
    const visNote = shareToChannelId
        ? "Shared in this channel — everyone here can read it."
        : base.visibility === "private"
            ? "Private to you — only you and your agent can see it."
            : "Visible to the whole workspace.";
    return (0, respond_1.ok)(`Created knowledge base ${(0, narration_1.inlineOr)(base.name, narration_1.NO_NAME)} (slug: \`${base.slug}\`). ${visNote}`);
}
async function opUpdateBase(client, ref, name, description, slug) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const updated = await (0, knowledge_shared_1.writeOr)(() => client.updateKbBase(base.id, { name, description, slug }), knowledge_shared_1.updateBaseValidationError);
    if ((0, channel_shared_1.isErr)(updated))
        return updated;
    return (0, respond_1.ok)(`Updated ${(0, narration_1.inlineOr)(updated.name, narration_1.NO_NAME)} (slug: \`${updated.slug}\`).`);
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
    if ((0, channel_shared_1.isErr)(base))
        return base;
    // 🔒 G16 — PREVIEW, THEN PUBLISH. Resolved AFTER the base, deliberately: the
    // name the preview shows the operator has to be the base this call is about,
    // and a token minted over a base that does not resolve confirms nothing.
    const verdict = await (0, confirm_token_1.confirmGate)(client, {
        tool: "dopl_kb",
        op: "set_visibility",
        callerUserId,
        what: `the knowledge base ${(0, narration_1.inlineOr)(base.name, narration_1.NO_NAME)} (slug: \`${base.slug}\`), published workspace-wide`,
        audience: `everyone in that home channel — the peer standing in it can read everything in it, including what was written while it was private`,
        payload: { base: base.id, visibility: "public" },
    }, { publishes: true, token: confirmToken });
    if (verdict.kind === "halt")
        return verdict.response;
    // 🔒 G16 — the server's publish precondition. See the docblock above for why
    // this op answers with a REMEDY rather than a preview.
    const updated = await (0, knowledge_shared_1.writeOr)(() => client.updateKbBase(base.id, {
        visibility: "public",
        // 🔒 The token, SPENT, becomes the server's precondition — the same
        // mapping `create_base` makes, one op over.
        acknowledgeShared: verdict.acknowledgedShared || undefined,
    }), (e) => (0, confirm_token_1.containerPublishUnacknowledged)(e, `This call already previewed and confirmed, so the server is refusing on a fact this process cannot see — re-previewing would answer the same. Ask your operator to publish the base from the Dopl app, where the audience change is stated before they press.`));
    if ((0, channel_shared_1.isErr)(updated))
        return updated;
    return (0, respond_1.ok)(`Published knowledge base ${(0, narration_1.inlineOr)(updated.name, narration_1.NO_NAME)} (slug: \`${updated.slug}\`) — now visible workspace-wide.`);
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
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const notOwned = (0, grant_1.notOwnedRefusal)(base.createdBy, selfUserId, "knowledge base", base.name);
    if (notOwned)
        return notOwned;
    const scopeId = await (0, grant_1.resolveGrantScopeId)(directory, scope, to);
    if ((0, grant_1.isGrantRefusal)(scopeId))
        return scopeId;
    try {
        await client.grantResource({
            resourceType: "knowledge_base",
            resourceId: base.id,
            scopeType: scope,
            scopeId,
            level: chosen,
        });
    }
    catch (e) {
        // 🔒 The container-KIND refusal, said in this surface's own words rather
        // than as a bare 400 (Samuel's ruling 2026-09-17). Every other failure
        // rethrows — a catch that swallowed them would report a refusal for an
        // outage.
        const refused = (0, grant_1.channelScopeRefusal)(e);
        if (refused)
            return refused;
        throw e;
    }
    return (0, grant_1.grantedLine)("knowledge base", base.name, scope, scopeId, chosen);
}
