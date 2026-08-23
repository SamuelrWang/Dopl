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
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelSessionsPage, ChannelThread, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadPage, ReadMessagesOptions, WorkspaceAwaitResult, ThreadMode } from "./channel-types.js";
import type { LaunchDirective, LaunchDirectiveCreateInput, LaunchDirectiveCreated } from "./launch-types.js";
export declare function listChannels(t: DoplTransport, opts?: {
    includeArchived?: boolean;
}): Promise<Channel[]>;
export declare function getChannel(t: DoplTransport, channelId: string): Promise<Channel>;
export declare function listChannelMembers(t: DoplTransport, channelId: string): Promise<ChannelMember[]>;
export declare function readMessages(t: DoplTransport, channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
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
/**
 * ASK THE OPERATOR'S OWN DESKTOP TO START AN AGENT.
 *
 * ⚠ A REQUEST, NOT A COMMAND. The server files a row; the machine decides. The
 * `offline` branch means the machine is not listening and NOTHING WAS FILED.
 * ⚠ There is no operator argument, by design — see
 * {@link LaunchDirectiveCreateInput}.
 */
export declare function createLaunchDirective(t: DoplTransport, input: LaunchDirectiveCreateInput): Promise<LaunchDirectiveCreated>;
/**
 * POLL ONE DIRECTIVE — what a bounded hold reads while the desktop decides.
 *
 * ⚠ COARSE POLLING ONLY (1-2s). A directive lives at most two minutes and the
 * decision is a human-scale toggle plus a process spawn; polling faster buys
 * nothing and multiplies requests across every armed launch.
 * ⚠ Another operator's directive answers 404, indistinguishable from absent.
 */
export declare function getLaunchDirective(t: DoplTransport, id: string): Promise<LaunchDirective>;
