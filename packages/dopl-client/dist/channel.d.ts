/**
 * Channel methods for `DoplClient`. Free functions over `DoplTransport`.
 *
 * `awaitMessages` is a LONG-POLL: server holds the request open (~50s) for a
 * message with seq > since. ⚠ Longer network timeout, GET auto-retry DISABLED
 * — a retry opens a second poll and can double-count arrivals.
 *
 * ONE call stays bounded at ~50s on purpose: `/api/channels/[id]/await` has
 * maxDuration 60s, so a longer single request is killed mid-flight. A
 * multi-minute hold (WAKE-V1) is assembled ABOVE this layer, in the MCP `await`
 * op, by re-issuing with the same cursor.
 */
import type { DoplTransport } from "./transport.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelArtifact, ChannelArtifactAction, ChannelArtifactResult, ChannelCreateInput, ChannelUpdateInput, ChannelMember, ChannelMessage, ChannelReadEntry, ChannelMessageInput, ChannelMessagePosted, ChannelSessionsPage, ChannelThread, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadPage, ReadMessagesOptions, WorkspaceAwaitResult, ThreadMode } from "./channel-types.js";
/** Network read-timeout for the long-poll — above the server cap.
 *  ⚠ EXPORTED for the DEADLINE CHAIN's gate, not for the deleted `ping.ts`:
 *  `@dopl/mcp-server › tools/channel-deadlines.test.ts` greps this literal so
 *  the hold budget cannot be raised past the timeout bounding it. Two copies
 *  drift, and the one that drifts low aborts a graceful hold. */
export declare const AWAIT_TIMEOUT_MS = 55000;
/**
 * Server-side long-poll window when the caller passes none. Sent explicitly
 * rather than relying on the route default, so poll length is pinned
 * client-side and stays under AWAIT_TIMEOUT_MS.
 *
 * ⚠ EXPORTED for {@link AWAIT_TIMEOUT_MS}'s reader, and for its reason.
 */
export declare const DEFAULT_AWAIT_TIMEOUT_MS = 50000;
/**
 * ⚠ **`opts.includeArchived` IS DELETED (Samuel's ruling R-21, 2026-09-17).** It
 * set `?include=archived`, the route's only query param, so a caller could see
 * rooms the archive filter hid. Both the filter and the feature are gone: this
 * read answers every live channel the caller may see, archived-stamped rows
 * included.
 */
export declare function listChannels(t: DoplTransport): Promise<Channel[]>;
export declare function getChannel(t: DoplTransport, channelId: string): Promise<Channel>;
export declare function listChannelMembers(t: DoplTransport, channelId: string): Promise<ChannelMember[]>;
export declare function readMessages(t: DoplTransport, channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
/**
 * THE SAME READ, KEEPING THE FOLD — messages plus `entries` when the page
 * actually folded something (#1220 §4).
 *
 * ⚠ **`entries: null` MEANS "NOTHING ON THIS PAGE IS IN AN ARTIFACT", AND SO
 * DOES AN OLDER SERVER THAT OMITS THE KEY.** Both collapse to the same handling
 * — render the messages — which is why one nullable field is enough and no
 * version probe is needed.
 * ⚠ **`readMessages` ABOVE IS UNCHANGED AND STAYS.** Every installed caller is
 * artifact-unaware; this is the additive twin for one that is not.
 */
export declare function readTranscript(t: DoplTransport, channelId: string, opts?: ReadMessagesOptions): Promise<{
    messages: ChannelMessage[];
    entries: ChannelReadEntry[] | null;
}>;
/**
 * `op="artifact"` — create / add / remove / dissolve, one POST.
 *
 * ⚠ **THERE IS NO `delete`, AND THAT IS THE WHOLE SAFETY ARGUMENT.**
 * `dissolve` clears the column from every member and retires the card; nothing
 * is deleted, so every action on this surface is reversible in the way the rest
 * of this client's writes are.
 */
export declare function writeArtifact(t: DoplTransport, channelId: string, input: ChannelArtifactAction): Promise<ChannelArtifactResult>;
/** OPEN ONE CARD — its members verbatim, in seq order, unfolded (#1220 §4).
 *  ⚠ `truncated` says the member list hit its ceiling; never drop it. */
export declare function readArtifact(t: DoplTransport, channelId: string, artifactId: string): Promise<{
    artifact: ChannelArtifact;
    messages: ChannelMessage[];
    truncated: boolean;
}>;
export declare function awaitMessages(t: DoplTransport, channelId: string, opts: AwaitMessagesOptions): Promise<AwaitResult>;
/**
 * WORKSPACE-WIDE long-poll — the `channel`-less await. Holds across every channel
 * the caller is a MEMBER of and returns the moment anything lands.
 *
 * ⚠ SAME BOUNDS AS {@link awaitMessages}, deliberately: one call stays at ~50s
 * because `/api/channels/await` has `maxDuration` 60, and a multi-minute hold is
 * assembled ABOVE this layer by re-issuing on the same cursor. ⚠ `retries: 0` —
 * a retry opens a SECOND long-poll and can double-count arrivals.
 *
 * ⚠ It is NARROWER than `op="read"`: a PUBLIC channel the caller never joined is
 * not watched. `channelCount` on the result says how many channels were being
 * watched, so ZERO memberships is reported rather than rendered as silence.
 */
export declare function awaitWorkspaceMessages(t: DoplTransport, opts: AwaitMessagesOptions): Promise<WorkspaceAwaitResult>;
export declare function createChannel(t: DoplTransport, input: ChannelCreateInput): Promise<Channel>;
/**
 * Patch a channel: `name`, `topic` and `infoCard`.
 *
 * `PATCH /api/channels/{id}` also accepts `visibility`, which is field-level
 * `sessionOnly` — an agent token is refused it outright, so
 * {@link ChannelUpdateInput} does not carry it. `name` / `topic` are MANAGE
 * writes (owner or workspace admin).
 *
 * `infoCard` is intentionally AGENT-WRITABLE and gated on MEMBERSHIP rather than
 * session: the card is the channel's shared scratch surface and changes no
 * visibility, roster, lifecycle or fact.
 */
export declare function updateChannel(t: DoplTransport, channelId: string, patch: ChannelUpdateInput): Promise<Channel>;
export declare function inviteToChannel(t: DoplTransport, channelId: string, userId: string): Promise<ChannelMember>;
/**
 * Post a message.
 *
 * ⚠ The response envelope carried a second key, `threadClosed`, until thread
 * closing was removed (wiring plan Phase 4, 2026-08-18) — normalized to a
 * boolean HERE, because an older deployment sent no key and the caller must not
 * have to tell "false" from "unknown". The shape of that rule still applies to
 * every additive envelope field this client reads.
 */
export declare function postMessage(t: DoplTransport, channelId: string, input: ChannelMessageInput): Promise<ChannelMessagePosted>;
/**
 * A channel's threads, MOST RECENTLY ACTIVE FIRST — the server's order, which
 * is the only order (`repository-tasks.ts › listTasksByChannel`). ⚠ Do not
 * re-sort: the server's LIMIT clipped against that order, so a re-sorted list is
 * the wrong rows in a plausible order.
 *
 * `truncated` rides through from the envelope; an older server that does not
 * send it reads as `false`, which is the pre-existing behaviour (an unbounded
 * read never clipped), not a claim.
 */
export declare function listChannelThreads(t: DoplTransport, channelId: string): Promise<ChannelThreadPage>;
/**
 * The caller's OWN live sessions. `channelId` narrows to one channel; omitted =
 * all of the caller's in the active workspace. ⚠ Own-scoped server-side — a
 * peer's sessions never come back.
 */
/**
 * The caller's OWN sessions. ⚠ OWN-SCOPED AT THE SERVER (`ctx.userId`), which is
 * what licenses the operator-only telemetry on the returned shape — a PEER's
 * session comes back from `GET /api/channels/[channelId]/sessions` instead, and
 * carries the coarse projection only.
 */
export declare function listChannelSessions(t: DoplTransport, channelId?: string): Promise<ChannelSessionsPage>;
export declare function getChannelThread(t: DoplTransport, channelId: string, threadId: string): Promise<ChannelThread>;
export declare function createChannelThread(t: DoplTransport, channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
/**
 * ⚠ TWO BINDINGS ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18): `proposeChannelThreadClose` (`PATCH … {op:"propose_close"}`, the
 * agent lane's terminal act) and `closeChannelThread` (`{op:"close"}`, human
 * lane only). The route arms behind both are deleted, so a resurrected binding
 * would 400 on the discriminator rather than fail quietly.
 */
export declare function setChannelThreadMode(t: DoplTransport, channelId: string, threadId: string, input: {
    mode: ThreadMode;
}): Promise<ChannelThread>;
export { createLaunchDirective, createAgentDirective, getLaunchDirective, createAgentDirection, getAgentDirection, listAgentDirections, } from "./channel-directives.js";
