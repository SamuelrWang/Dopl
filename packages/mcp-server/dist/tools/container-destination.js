"use strict";
/**
 * 🔒 **THE TWO DESTINATIONS, AS THIS SURFACE HAS TO SEE THEM** (Samuel's ruling
 * 2026-09-18). One module, because `dopl_agent` and `dopl_kb` ask the same
 * question — *did this call land in a home channel?* — and two copies of a
 * tenancy probe is how the shelf fence ended up divergent (findings §6 #3).
 *
 *   1. **HOME** — `container="home"`, or no container at all. The caller's own
 *      `kind='personal'` container; a `private` row there is destination 1 and
 *      is listed on every home channel's Personal section.
 *   2. **A HOME CHANNEL** — `container=<its slug|id>`. The row lands in that
 *      channel's `kind='link'` container AND is shared into the channel. For a
 *      template that is `visibility: "workspace"`; for a base it is
 *      `shareToChannelId`.
 *
 * ⚠ **THIS IS A CONVENIENCE, NEVER THE FENCE.** The fence is the server's
 * (`src/features/workspaces/server/home-channel-destination.ts`), which is why
 * every function here FAILS OPEN: an unreadable directory, an unknown kind or a
 * channel this caller cannot see all resolve to "not a home channel", the call
 * goes out as the agent wrote it, and the server refuses it by name. The
 * opposite reading — guessing "home channel" and rewriting the request — would
 * be this process deciding a sharing fact from a read it could not complete.
 *
 * ⚠ **ONE DIRECTORY READ, AND IT IS CACHED.** `containerKindIndex()` is served
 * from `workspace-directory.ts`'s own cache, so the kind costs nothing after the
 * first call. {@link resolveHomeChannelId} is the loopback, and it runs ONLY for
 * a call that has already resolved to a home channel — the same "cold path only"
 * rule `confirm-token.ts › resolveConfirmTarget` states for its own.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESTINATION_HEADINGS = exports.HOME_CHANNEL_ROW_NOT_SHARED_CODE = void 0;
exports.homeChannelRowNotShared = homeChannelRowNotShared;
exports.resolveHomeChannelContainer = resolveHomeChannelContainer;
exports.resolveHomeChannelId = resolveHomeChannelId;
exports.resolveChannelShareTarget = resolveChannelShareTarget;
const client_1 = require("@dopl/client");
const respond_js_1 = require("./respond.js");
/**
 * The server's 400 for "a home channel holds only what is shared into it". ⚠ ONE
 * SPELLING, shared by both write surfaces — the same rule
 * `agent-shared.ts › PRIVATE_VISIBILITY_DENIED_CODE` states for its own: two
 * copies of a wire code is two mappers that stop agreeing about the remedy.
 */
exports.HOME_CHANNEL_ROW_NOT_SHARED_CODE = "HOME_CHANNEL_ROW_NOT_SHARED";
/**
 * 🔒 **THE TWO DESTINATIONS, AS LIST HEADINGS — ONE TABLE, BOTH SURFACES.**
 * `dopl_agent(op="list")` and `dopl_kb(op="list_bases")` describe the same two
 * places, and two hand-typed heading sets is how an agent ends up holding a
 * sharing model the operator does not have.
 *
 * ⚠ **"Shared in this channel", NEVER "Public"** — inside a container that
 * audience is "the other people in this relationship", not "everyone in your
 * company". It is the app's own wording
 * (`src/features/agent-templates/lib/visibility.ts › SECTIONS_CONTAINER`).
 */
exports.DESTINATION_HEADINGS = {
    shared: "Shared in this channel",
    personal: "Home (personal) — yours, visible in every home channel",
    /**
     * 🚫 **THE DESTINATION THAT NO LONGER EXISTS.** Six agent templates and eight
     * knowledge bases were measured in this state on 2026-09-18 and **nothing
     * migrates them** (F-735): they are RENDERED, because a row this surface drops
     * is a row an agent cannot even ask about, and they are LABELLED, because an
     * agent reading them under an ordinary heading keeps treating them as live.
     */
    legacy: "Legacy — not visible anywhere in the app",
};
/**
 * The fence, surfaced as a refusal rather than rethrown as a transport-shaped
 * error. Null so the caller rethrows anything else.
 *
 * ⚠ **THE SERVER'S OWN SENTENCE**, which already names the two destinations and
 * the remedy for the resource it refused — this layer would have to guess which
 * of the two it is.
 */
function homeChannelRowNotShared(e) {
    if (!(0, respond_js_1.isApiError)(e, 400, exports.HOME_CHANNEL_ROW_NOT_SHARED_CODE))
        return null;
    return (0, respond_js_1.err)(`${(0, respond_js_1.apiMessage)(e) ?? "A home channel holds only what is shared into it."} Pass container="home" to keep it in your home space instead.`);
}
/**
 * Did this call land in a home channel, and which container is it?
 *
 * ⚠ **THE ALS OVERRIDE FIRST.** `registrar.ts` runs the handler inside
 * `workspaceContext.run(resolvedId, …)` for a per-call `container=`, and the
 * transport's stored id is the SESSION default — reading only the latter would
 * ask "is my default container a home channel" about a call that went
 * elsewhere. Same order, and the same reason, as `resolveConfirmTarget`.
 */
async function resolveHomeChannelContainer(client, 
/**
 * ⚠ **OPTIONAL, AND ABSENT MEANS "NOT KNOWN" — WHICH IS THE OPPOSITE
 * DIRECTION FROM `agent.ts`'s "REQUIRED, WITH NO DEFAULT, DELIBERATELY".**
 * That argument is about `op="grant"`, where a missing directory would WIDEN
 * the scope an agent can reach. Here an absent directory narrows behaviour to
 * exactly what it was before this module existed — the call goes out as the
 * agent wrote it and the SERVER refuses it — so the safe reading and the
 * convenient one are the same reading. Every registrar passes it.
 */
directory) {
    if (!directory)
        return null;
    // ⚠ **THE WHOLE PROBE IS INSIDE THE `try`, THE LOOKUP INCLUDED.** Every step
    // is an optional capability of whatever client this server was handed, and a
    // throw from any of them means the same thing: not known. Catching only the
    // directory read would let a client without a workspace accessor take down a
    // read that has no stake in the answer.
    try {
        const workspaceId = client_1.workspaceContext.getStore() ?? client.getWorkspaceId();
        if (!workspaceId)
            return null;
        const kinds = await directory.containerKindIndex();
        return kinds.get(workspaceId) === "home_channel" ? workspaceId : null;
    }
    catch {
        // ⚠ FAIL OPEN — see the header. "I could not read the directory" is not
        // "this is a home channel", and the server holds the refusal either way.
        return null;
    }
}
/**
 * The CHANNEL inside a home-channel container — the id `shareToChannelId` takes.
 *
 * ⚠ **ONE CHANNEL PER LINK CONTAINER, MINTED FROM THE SAME NAME**
 * (`src/features/home/server/service-writes.ts › createHomeChannel`), which is
 * what makes this lookup single-valued rather than a pick. A container that
 * somehow holds two is treated as unresolvable rather than guessed at: picking
 * one would file a grant in a room the caller did not name.
 *
 * ⚠ `getHomeChannels` is `scope=account` and is NARROWED by the MCP layer's own
 * container lock; the filter below is the POSITIVE `container.kind === "link"`
 * (§4A, F-564) plus an exact container-id match, so a workspace channel can
 * never answer here.
 */
async function resolveHomeChannelId(client, containerId) {
    try {
        const { channels } = await client.getHomeChannels();
        const matches = channels.filter((c) => c.workspaceId === containerId && c.container?.kind === "link");
        return matches.length === 1 ? matches[0].id : null;
    }
    catch {
        return null;
    }
}
/**
 * 🔒 **DESTINATION 2's CHANNEL, OR `undefined`** — the one call the knowledge
 * write lane makes. `resolveHomeChannelContainer` then {@link
 * resolveHomeChannelId}, so `opCreateBase` spends one line rather than a branch
 * (`knowledge-ops-write.ts` sits at §1's 500-line cap).
 *
 * ⚠ **`undefined` MEANS "SEND NO GRANT", NEVER "IT IS FINE"** — a home channel
 * whose channel will not resolve produces an UNSHARED create, which the server
 * then refuses by name. That is the fail-open rule in this file's header, and it
 * is why this returns a value rather than throwing.
 */
async function resolveChannelShareTarget(client, directory) {
    const container = await resolveHomeChannelContainer(client, directory);
    if (!container)
        return undefined;
    return (await resolveHomeChannelId(client, container)) ?? undefined;
}
