/**
 * THE "NEEDS YOU" SIGNAL — an agent telling exactly ONE recipient that it is
 * done, has a question, or is blocked (2026-09-01, `docs/specs/needs-you-ping.md`).
 *
 * ⚠ SPLIT OUT OF `types.ts` at the 500-line cap, `types-direction.ts`'s
 * arrangement; re-exported from there, so there is no second path to a symbol.
 *
 * ⚠ **IT IS THE DIRECT LANE'S SIBLING, NOT ITS SUBTYPE.** A direction carries
 * WORK into one agent and waits for that turn's answer; a ping carries ATTENTION
 * out to one recipient and waits for nothing. They share a table shape and
 * nothing else — a ping has no status, no refusal vocabulary, no reply, and three
 * recipient forms where a direction has exactly one.
 */

/**
 * WHAT AN AGENT IS SAYING — **exactly three words, and the closed set is the
 * contract all three trees code against.**
 *
 *  - `done`     — the work is finished. This is the one Samuel's escalation cards
 *                 were missing: an agent that ended had no way to say so.
 *  - `question` — it needs an answer to continue. It is NOT an `escalate`: an
 *                 escalation offers OPTIONS a human presses. A question ping says
 *                 "come look", and the thread is where the question lives.
 *  - `blocked`  — it cannot continue and is not asking a question — a credential,
 *                 a dependency, a decision elsewhere.
 *
 * ⚠ A FOURTH KIND IS A SCHEMA CHANGE IN THREE TREES, deliberately: the column
 * carries the same CHECK and the desktop carries its own copy, so an unknown value
 * cannot be stored and cannot reach a render as raw text.
 */
export type PingKind = "done" | "question" | "blocked";

/**
 * WHOSE INBOX — stamped by the service from WHICH argument the caller used, never
 * sent by a caller.
 *
 *  - `member`  — another member of this channel. The ONE form that names somebody
 *                else, and it is fenced like a post: the sender must be a MEMBER
 *                of the channel (membership, not readability) and so must the
 *                recipient.
 *  - `desktop` — the sender's OWN operator's external Desktop Agent — the session
 *                that holds `/api/pings/await` open.
 *  - `agent`   — one named agent session on the sender's OWN operator's machine.
 *
 * 🔒 **`desktop` AND `agent` STAMP `ctx.userId` AND TAKE NO OPERATOR ARGUMENT.**
 * That absence is `direct_agent`'s authorization story reused verbatim, and it is
 * the whole of the loop brake here: **an agent can never ping another member's
 * agent**, because there is no field with which to say so.
 */
export type PingRecipientKind = "member" | "agent" | "desktop";

/**
 * ONE PING.
 *
 * ⚠ **NOT A MESSAGE, AND DELIBERATELY OFF `channel_messages`** — INVARIANTS §5 and
 * the migration header. The consequence to know: **a ping has no
 * `channel_messages.seq` and can never end a channel `await`.** {@link seq} below
 * is a SEPARATE cursor space, read only by the ping routes.
 */
export interface ChannelPing {
  id: string;
  /**
   * THE PING CURSOR — table-global and monotonic, the `since=` of
   * `/api/pings/await` and of `op="pings"`.
   *
   * ⚠ **GAPPY FOR ANY ONE READER, AND THAT IS LEGAL.** Rows a reader cannot see
   * still consume the identity, exactly as the workspace message await's cursor
   * does. A cursor is an ordering, never a count — never render it as one and
   * never assume `seq + 1` exists.
   */
  seq: number;
  channelId: string;
  /** Channel slug, for a link the reader can act on without a second read. */
  channelSlug: string | null;
  /** Wire/storage name `task` == domain name `thread`. Null when unthreaded. */
  threadId: string | null;
  senderUserId: string;
  /**
   * ⚠ **A CAPTION AND NOTHING ELSE**, `AgentDirection.senderAgentId`'s rule
   * verbatim: derived server-side from the `X-Dopl-Session-Id` tail and dropped
   * unless it matches the charset. **Nothing may gate, route, filter or authorize
   * on it.** `null` means "not reported", never "a human sent it".
   */
  senderAgentId: string | null;
  recipientKind: PingRecipientKind;
  recipientUserId: string;
  /** Set iff {@link recipientKind} is `agent` — the constraint is at rest too. */
  recipientAgentId: string | null;
  kind: PingKind;
  /** One line, 1..600. The thread is where the report lives. */
  body: string;
  createdAt: string;
}
