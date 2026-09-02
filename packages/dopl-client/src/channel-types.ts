/**
 * Channel types — cross-user, agent-to-agent collaboration.
 *
 * CHANNEL (or DM) holds many THREADS. A THREAD is ONE exchange between two
 * members, SHARED: both see the same thread, title, status. A SESSION is ONE
 * member's agent run on a thread, on that member's machine; each side has its
 * own, neither sees the other's. Messages carry a monotonic `seq` cursor →
 * `awaitMessages` long-polls past it. Mirrors the API DTOs (camelCase) in
 * `src/features/channels`.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. Route paths
 * (`/api/channels/[channelId]/tasks/**`) and response field names (`tasks`,
 * `task`) are storage names, deliberately unchanged; mapping happens here and
 * in `channel.ts`.
 */

// ⚠ THE ESCALATION FIELDS ARE AN EXTENDED INTERFACE, NOT TWO KEYS DECLARED HERE
// (2026-08-31). `escalation-types.ts` is their own module for `launch-types.ts`'s
// reason — this file is at the 500-line cap — and `extends` is what keeps the
// rule, the caps and the docblock stated ONCE, over there. ⚠ THE SESSION HEALTH
// half is a THIRD on the same grounds (2026-09-01); see its own header.
import type { ChannelEscalationFields } from "./escalation-types.js";

/**
 * ⚠ **THE TEN CLOSED SETS AND THE TELEMETRY SHAPE BELOW ARE DECLARED IN
 * `@dopl/contracts` AND RE-EXPORTED HERE UNDER THIS PACKAGE'S OWN NAMES**
 * (2026-09-02, v2 slice A13). `ChannelMemberRole` is the package's
 * `ChannelRole` and `ChannelAuthorKind` is its `MessageAuthorKind`, aliased on
 * the way through, so **NO CONSUMER IMPORT CHANGES**: `@dopl/client` publishes
 * exactly the names it always has.
 *
 * ⚠ **THIS IS WHAT THE "HAND MIRROR" HEADERS IN THIS PACKAGE WERE ASKING FOR.**
 * Every one of these was re-typed here because this package cannot import
 * `src/` — separate `tsc` programs, resolved through `node_modules`.
 * `@dopl/contracts` is the shared module that removes the reason: it is TYPE-ONLY
 * and has no build, so importing it costs this package nothing at runtime and
 * adds nothing to its `dist/`.
 *
 * ⚠ **THE `dist/` COPIES OF THESE UNIONS ARE GONE, NOT STALE.** Three drift
 * gates used to parse `packages/dopl-client/dist/*.d.ts` as a separate mirror
 * because it is what `@dopl/mcp-server` actually imports. A re-export emits a
 * re-export, so there is no literal union in `dist/` left to disagree — the
 * gates dropped those sites rather than being pointed at them.
 */
import type {
  ChannelVisibility,
  ChannelRole as ChannelMemberRole,
  ThreadMode,
  ThreadStatus,
  ThreadOutcome,
  MessageAuthorKind as ChannelAuthorKind,
  ChannelMessageKind,
  MessageIntent,
  SessionPillState,
  ChannelSessionTelemetry,
} from "@dopl/contracts";

export type {
  ChannelVisibility,
  ChannelMemberRole,
  ThreadMode,
  ThreadStatus,
  ThreadOutcome,
  ChannelAuthorKind,
  ChannelMessageKind,
  MessageIntent,
  SessionPillState,
  ChannelSessionTelemetry,
};

import type {
  ChannelInfoCard,
} from "./info-card-types.js";

export type {
  ChannelInfoCard,
  ChannelInfoCardBuiltInKey,
  ChannelInfoCardRow,
  ChannelUpdateInput,
} from "./info-card-types.js";

export interface Channel {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  topic: string;
  visibility: ChannelVisibility;
  /** True for a direct (1:1) channel. */
  isDirect?: boolean;
  /** Resolved peer for a direct channel; null / absent otherwise. */
  directPeer?: {
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  createdBy: string;
  /** ISO datetime archived, null when active. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on list/get only. */
  memberCount?: number;
  /** Present on list/get only — ISO datetime of latest message, or null. */
  lastMessageAt?: string | null;
  /**
   * The curated Main-info card. ⚠ OPTIONAL here and NOT on the server — see
   * {@link ChannelInfoCard}. A reader that dereferences it without a fallback
   * throws on a row minted before the column existed.
   */
  infoCard?: ChannelInfoCard;
}

// ⚠ THE DELIVERY VOCABULARY LIVES IN `delivery-types.ts` (§1 split, 2026-09-02),
// re-exported here so this file stays the channels barrel and there is no second
// import path to a symbol. It moved because this file reached the 500-line cap and
// the seam is real: those two unions change when the DELIVERY contract changes,
// and everything else here changes when a channel shape does.
import type { ChannelDelivery, ChannelWakeVerdict } from "./delivery-types.js";
export type { ChannelDelivery, ChannelWakeVerdict };

export interface ChannelMessage {
  id: string;
  /** Monotonic cursor — `read`/`await` return messages with a higher seq. */
  seq: number;
  channelId: string;
  authorUserId: string | null;
  authorKind: ChannelAuthorKind;
  kind: ChannelMessageKind;
  body: string;
  metadata: Record<string, unknown>;
  clientMsgId: string | null;
  createdAt: string;
  /**
   * Hydrated author display. Lets a reader label who an agent acts FOR —
   * "agent for <authorName>" — so a counterparty is never mistaken for its own
   * operator. Null / absent on a system row or unresolved profile.
   */
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  // ── THE DELIVERY KEYSTONE (2026-09-02, A9; `delivery-types.ts`) ─────────
  // ⚠ **OPTIONAL *AND* NULLABLE, AND BOTH MEAN "NOT ANSWERED HERE"** — an older
  // server omits the key, a newer one sends `null` for a row it could not
  // resolve, and neither is "nobody" (that is `"none"`). ⚠ `[]` on either array
  // IS "resolved to nobody"; absent is not. Collapsing the two breaks the
  // desktop's fallback — the argument is on the original.
  wakeVerdict?: ChannelWakeVerdict | null;
  recipientUserIds?: string[] | null;
  recipientAgentIds?: string[] | null;
  /** ⚠ Without `deliveryAt` this is the server's write-time PREDICTION. */
  delivery?: ChannelDelivery | null;
  deliveryAt?: string | null;
}

/**
 * POST result: the stored message.
 *
 * ⚠ IT CARRIED ONE MORE FIELD, `threadClosed`, until thread closing was removed
 * (wiring plan Phase 4, 2026-08-18) — non-optional by construction, because the
 * server sent the key only on a post into a closed thread and an older
 * deployment sent none, and both had to read `false` rather than `undefined`.
 * That normalize-an-additive-field-to-a-value discipline still governs
 * `openingSeq`; this alias keeps the write result named apart from the read
 * shape so a future post-time notice has somewhere to go.
 */
export type ChannelMessagePosted = ChannelMessage;

export interface ChannelMember {
  channelId: string;
  userId: string;
  role: ChannelMemberRole;
  lastReadAt: string | null;
  addedBy: string | null;
  joinedAt: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface ChannelCreateInput {
  name?: string;
  topic?: string;
  visibility?: ChannelVisibility;
  /** Open a direct (1:1) channel with `memberUserId` instead of a named one. */
  direct?: boolean;
  /** Peer's user id — required, and only used, when `direct` is true. */
  memberUserId?: string;
}

/**
 * One titled, mode-tagged exchange; transcript rides on `channel_messages`
 * (`metadata.taskId` = ChannelThread.id — wire key keeps the storage name).
 */
export interface ChannelThread {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  /** ⚠ LEGACY, UNREAD — see {@link ThreadStatus}. Four fields, one story. */
  status: ThreadStatus;
  outcome: ThreadOutcome | null;
  mode: ThreadMode;
  createdBy: string;
  targetUserId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  outcomeSummary: string | null;
  /**
   * When the thread last saw real activity — the newest message tagged for it,
   * or its own `createdAt` when nobody has posted into it. ⚠ NOT `updatedAt`,
   * which moves only when the ROW is patched.
   *
   * ⚠ ABSENT means THIS READ DID NOT DERIVE IT (`get_thread` loads one row and
   * does not), never "no activity". Only the thread LIST carries it, and the
   * list is ORDERED by it.
   */
  lastActivityAt?: string;
}

/**
 * One page of a channel's threads: the rows, most recently active first, plus
 * whether the server's ceiling clipped them.
 *
 * ⚠ `truncated` exists because threads never leave the list, so the read is
 * bounded and a clipped page that renders like an exhausted one asserts
 * something the read never established (INVARIANTS §9). Surface it; a caller
 * that drops it is claiming these are all of them.
 */
export interface ChannelThreadPage {
  threads: ChannelThread[];
  truncated: boolean;
}

// ⚠ THE SESSION PROJECTION LIVES IN `session-types.ts` (§1 split, 2026-09-02),
// re-exported here so this file stays the channels barrel and there is no second
// import path to a symbol — the arrangement `session-health-types.ts` already has
// with it. The seam is the reason to change: those types move when the session
// PROJECTION moves, and everything else here when a channel shape does.
import type { ChannelSessionStateOwn } from "./session-types.js";
// ⚠ `SessionPillState` and `ChannelSessionTelemetry` are NOT re-exported through
// this line: they come from `@dopl/contracts` above (A13), and `session-types.ts`
// re-exports them for its own readers. One name, one declaration, one door here.
export type {
  ChannelSessionState,
  ChannelSessionStateOwn,
  ChannelSessionsPage,
  SessionDetailKey,
} from "./session-types.js";

export interface ChannelThreadCreateInput {
  title: string;
  mode?: ThreadMode;
  body: string;
  toUserId: string;
  /**
   * Idempotency key — re-sent create_thread with same id returns the existing
   * thread instead of double-creating it (and double-spawning the responder's
   * window). Mirrors `ChannelMessageInput.clientMsgId`.
   */
  clientMsgId?: string;
  /**
   * SPAWN-WITH-HANDOFF. Set by an EXTERNAL agent (Claude Desktop / Claude Code
   * over MCP): the session driving this thread opens ON THE OPERATOR'S MACHINE
   * instead of staying with the external session that created it. Absent/false
   * → an external create opens nothing there. Server stamps it onto the opening
   * message's reserved `metadata.handoff`, which the desktop reads.
   */
  handoff?: boolean;
}

/**
 * `createChannelThread` result: thread + `openingSeq`, the seq of the opening
 * request message the server posted — exactly the cursor the requester arms
 * `await` on. ⚠ Guessing it via `read limit=1` races the peer answering in
 * between: the "newest message" is then the reply, so the await starts one past
 * it and never sees what already arrived.
 *
 * `null` only for the idempotent short-circuit returning a thread created by
 * SOMEONE ELSE (no opening message).
 */
export interface ChannelThreadCreated {
  thread: ChannelThread;
  openingSeq: number | null;
}

/**
 * ⚠ TWO RESULT SHAPES ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18): `ChannelThreadClosed` (thread + `echoSeq`, the seq of the
 * `task_finished` / `task_failed` marker a close posted) and
 * `ChannelThreadCloseProposed` (thread + `markerSeq` + the proposed outcome).
 *
 * The rule they both carried is live on {@link ChannelThreadCreated.openingSeq}
 * and is the reason they existed at all: **a write that also posts a message
 * hands its seq BACK.** Guessing one (last known seq + 1) once armed a hold past
 * a peer reply already in the channel and the wait never returned. `null` means
 * look it up, never "one past the last seq you saw".
 */

export interface ChannelMessageInput extends ChannelEscalationFields {
  body: string;
  kind?: ChannelMessageKind;
  metadata?: Record<string, unknown>;
  authorKind?: ChannelAuthorKind;
  clientMsgId?: string;
  /**
   * Target channel member. Route validates active membership and stores it in
   * `metadata.to_user_id`; a listener triggers only on messages addressed to it
   * (or, in a 2-member channel, the implicit other member).
   */
  toUserId?: string;
  /**
   * **THE ONE RECIPIENT, IN EITHER NAMESPACE** (2026-09-02, B4/B8) — a member
   * (email or user id) **or an agent** (`@agent-<id>` / `@<handle>`). The route
   * resolves it once at the door (`service-writes-metadata-recipient.ts ›
   * resolveToRecipient`): a member BECOMES {@link toUserId} before any fence
   * runs, an agent rides `recipient_agent_ids`, and a name that resolves to
   * NOBODY is a 400 `CHANNEL_RECIPIENT_UNRESOLVED` listing the live handles.
   * ⚠ Mutually exclusive with {@link toUserId} — sending both is
   * `CHANNEL_CHAT_ADDRESSED`, because two addressee fields on one message is
   * two answers to one question.
   */
  to?: string;
  /** One-line intent (<=200 chars) surfaced in the receiver's notification. */
  summary?: string;
  /**
   * Whether this post may reach anybody's agent. Absent = `request`.
   *
   *  - `request` — DM auto-address fires (a post into a direct channel with no
   *    `to` is addressed to the peer server-side), so the listener triggers.
   *    This is what makes a reply deliverable.
   *  - `chat` — HUMAN TALK. DM auto-address SKIPPED ENTIRELY: no `to_user_id`
   *    manufactured, so nothing on the far side reads it as an ask. Otherwise a
   *    normal message — seq, realtime, read watermark, `thread` tag.
   *
   * ⚠ `chat` + `toUserId` is a CONTRADICTION, refused 400
   * `CHANNEL_CHAT_ADDRESSED`, never silently resolved either way.
   * ⚠ Named agents (`toAgent` / `toAgents`) are gone; the server REFUSES those
   * fields rather than dropping them, so an old caller is told.
   */
  intent?: MessageIntent;
}

export interface ReadMessagesOptions {
  /** Only messages with seq greater than this. */
  since?: number;
  /** Server caps at 200. */
  limit?: number;
  /**
   * Scope the read to ONE thread — only messages tagged `metadata.taskId`. A
   * FILTER, not a lookup: an id nothing carries returns `[]`, not 404, and
   * legacy `task-<channelId>-<seq>` ids work as well as uuids. Composes with
   * `since` / `limit`.
   */
  thread?: string;
}

export interface AwaitMessagesOptions {
  /** Last seq the caller processed — poll for seq greater than it. */
  since: number;
  /** Server long-poll window before returning `timedOut` (ms). */
  timeoutMs?: number;
  /**
   * Messages by this user id neither end the poll nor appear in its result — a
   * caller posting while its own await is armed otherwise wakes on its own
   * echo. Unset watches every author.
   */
  excludeAuthor?: string;
}

/**
 * Long-poll result. `timedOut` → `messages` empty, caller re-polls with the
 * same `since`.
 */
export interface AwaitResult {
  messages: ChannelMessage[];
  timedOut: boolean;
  /**
   * THE CALLER'S OWN AGENT SESSIONS, as of the moment the hold RETURNED
   * (2026-08-22). One own-scoped read at return time, so an orchestrator that
   * was going to follow every await with a `read_sessions` no longer has to —
   * which halves the loop.
   *
   * ⚠ **OPTIONAL, AND IT STAYS OPTIONAL.** A server older than this wave sends
   * no such key and a client must read that as "not reported", never as "you
   * have no sessions" (INVARIANTS §13 — an older deployment is a supported
   * peer). ⚠ Distinguish it from `[]`, which IS a claim: the server looked and
   * this machine is reporting nothing.
   *
   * ⚠ OWN-SCOPED, always. A peer's session never appears here, and the rich
   * telemetry is exactly why: see {@link ChannelSessionTelemetry}.
   * ⚠ It is a SNAPSHOT AT RETURN, never sampled during the hold — the tick loop
   * is the hottest path in the tree and nothing was added to it.
   */
  sessions?: ChannelSessionStateOwn[];
  /**
   * IS THE CALLER'S OWN MACHINE STILL HEARTBEATING, as of the same instant
   * (2026-08-23, F-294). See {@link ChannelSessionsPage} for the whole rule.
   *
   * ⚠ **IT RIDES OR STAYS WITH `sessions`, NEVER ALONE.** Both come from ONE
   * own-scoped read at return time, and a `false` emitted when that read FAILED
   * would report the operator's machine as gone on the strength of a server-side
   * error — the exact class of lie the `undefined` ≠ `[]` rule above exists for.
   */
  operatorOnline?: boolean;
}

/**
 * WORKSPACE-WIDE long-poll result — `awaitWorkspaceMessages`, the `channel`-less
 * await. Same cursor semantics and the same `sessions` block; the difference is
 * that each message names the channel it came from, because a page can span
 * several.
 *
 * ⚠ `seq` IS WORKSPACE-GLOBAL AND GAPPY, which is what makes one cursor legal
 * across every channel at once — the same number that makes a per-channel `seq`
 * range meaningless as a count.
 */
export interface WorkspaceAwaitResult extends AwaitResult {
  messages: WorkspaceChannelMessage[];
  /**
   * HOW MANY CHANNELS THE HOLD WAS WATCHING when it returned.
   *
   * ⚠ **REPORTED RATHER THAN INFERRED, AND `0` IS THE CASE IT EXISTS FOR.** A
   * caller who belongs to no channel would otherwise read an empty page as
   * "nothing happened" and re-arm forever on a hold that can never fire. It is
   * also the number that lets a render say the scope out loud — a workspace hold
   * watches channels you are a MEMBER of, and a public channel you never joined
   * is NOT among them.
   */
  channelCount: number;
}

/**
 * A message on a workspace-wide page: the ordinary shape plus the channel it
 * belongs to, resolved server-side.
 *
 * ⚠ `channelName` / `channelSlug` are MEMBER-TYPED — a channel is named by
 * whoever opened it — so they are counterparty-influenced display text on their
 * way into a rendered result, exactly like `ChannelSessionState.channelName`.
 * ⚠ Either may be `null` when the channel row could not be resolved; a render
 * must fall back to the id rather than print an empty label.
 */
export interface WorkspaceChannelMessage extends ChannelMessage {
  channelName: string | null;
  channelSlug: string | null;
}
