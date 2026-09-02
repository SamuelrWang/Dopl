/**
 * THE "NEEDS YOU" SIGNAL's types — an agent telling exactly ONE recipient that
 * it is done, has a question, or is blocked (2026-09-01,
 * `docs/specs/needs-you-ping.md`).
 *
 * ⚠ Their own module, `direction-types.ts`'s arrangement and reason:
 * `channel-types.ts` is at the 500-line cap and these describe a MAILBOX rather
 * than a channel.
 *
 * ⚠ THEY ARE A HAND MIRROR of `src/features/channels/types-ping.ts`, which is
 * where every rule about them is STATED. Nothing here may restate one — a rule
 * in two places drifts in one of them, and you cannot tell which from outside.
 */

/**
 * WHAT AN AGENT IS SAYING — a closed set of exactly three words. `done` (the
 * work finished), `question` (it needs an answer to continue), `blocked` (it
 * cannot continue and is not asking a question).
 */
export type PingKind = "done" | "question" | "blocked";

/**
 * WHOSE INBOX — stamped by the SERVICE from which argument the caller used,
 * never sent by a caller. `member` is the one form that names somebody else;
 * `desktop` and `agent` are the sender's own operator, stamped from the
 * authenticated caller.
 */
export type PingRecipientKind = "member" | "agent" | "desktop";

/**
 * ONE PING, as the server reports it.
 *
 * ⚠ **NOT A MESSAGE.** It has no `channel_messages.seq`, so it can never end a
 * channel `await`; {@link ChannelPing.seq} is a SEPARATE cursor space.
 */
export interface ChannelPing {
  id: string;
  /**
   * THE PING CURSOR — the `since=` of {@link AwaitPingsOptions} and of
   * {@link ListPingsOptions}, and of NOTHING ELSE.
   *
   * ⚠ **NEVER A MESSAGE `seq`, AND CROSSING THE TWO IS SILENT.** They are
   * separate identity spaces, so a message cursor used here reads a plausible
   * WRONG page rather than erroring. ⚠ Gappy for any one reader (rows it cannot
   * see still consume the identity) — an ordering, never a count.
   */
  seq: number;
  channelId: string;
  /** Channel slug, for a link the reader can act on without a second read. */
  channelSlug: string | null;
  /** Wire/storage name `task` == domain name `thread`. Null when unthreaded. */
  threadId: string | null;
  senderUserId: string;
  /**
   * 🔒 WHICH agent filed this — **an UNVERIFIED LABEL**, `AgentDirection.senderAgentId`'s
   * rule verbatim: derived server-side from the `X-Dopl-Session-Id` tail, a
   * documented NON-authorization header. **Nothing may gate, route, filter or
   * authorize on it.** `null` means "not reported", never "a human sent it".
   */
  senderAgentId: string | null;
  recipientKind: PingRecipientKind;
  recipientUserId: string;
  /** Set iff {@link recipientKind} is `agent`. */
  recipientAgentId: string | null;
  kind: PingKind;
  /** One line, 1..600 (`MAX_PING_BODY`). The thread holds the report. */
  body: string;
  createdAt: string;
}

/**
 * SEND ONE PING.
 *
 * 🔒 **NO SENDER FIELD, AND NO OPERATOR FIELD ON THE TWO SELF-SCOPED FORMS.**
 * The server stamps the authenticated caller for the sender always, and for the
 * recipient whenever the caller said {@link toDesktop} or {@link agentId}. That
 * absence IS the loop brake — an agent cannot ping another member's agent
 * because there is no field with which to say so.
 *
 * ⚠ EXACTLY ONE of {@link to} / {@link toDesktop} / {@link agentId}. Zero is a
 * signal with nowhere to go; two would make the server pick, and a
 * silently-dropped address is the invisible-delivery failure the addressing
 * contract exists to prevent.
 */
export interface CreatePingInput {
  /** Slug or id, resolved server-side. */
  channel: string;
  threadId?: string;
  kind: PingKind;
  body: string;
  /** A MEMBER reference — an email or user id, resolved against the ACTIVE
   *  roster the way a post's `to` is. The one form that names someone else. */
  to?: string;
  /** My OWN operator's external Desktop Agent — the session holding
   *  `/api/pings/await` open. ⚠ `true` or absent; never `false`. */
  toDesktop?: true;
  /** One agent session on my OWN operator's machine — the bare 8-char id. */
  agentId?: string;
}

/** `GET /api/pings` — the inbox catch-up read. ⚠ `since` is a PING seq. */
export interface ListPingsOptions {
  since?: number;
  /** 1..100 (`MAX_PING_LIMIT`); the server defaults to 20 when omitted. */
  limit?: number;
}

/**
 * `GET /api/pings/await` — the held read.
 *
 * ⚠ NO `excludeAuthor`, deliberately: a ping is never delivered to its own
 * sender (the recipient fence already excludes it), so the knob a message await
 * needs would have no effect here.
 */
export interface AwaitPingsOptions {
  since: number;
  /** Server-side hold, <=50000. Omitted, the client pins the default. */
  timeoutMs?: number;
}

/** What one held read returns. ⚠ `timedOut` true with a non-empty `pings` is
 *  not a shape the route produces; read `pings` first either way. */
export interface PingAwaitResult {
  pings: ChannelPing[];
  timedOut: boolean;
}
