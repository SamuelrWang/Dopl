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
 * ⚠ **BOTH CLOSED SETS ARE DECLARED IN `@dopl/contracts › pings.ts` AND
 * RE-EXPORTED HERE** (2026-09-02, v2 slice A13) — they had byte-equal twins in
 * `packages/dopl-client/src/ping-types.ts`. No import path changed. ⚠ The column
 * CHECK and the desktop's own copy state {@link PingKind} a third and fourth
 * time and no TypeScript reaches either, which is why the docblock over there
 * still says a fourth kind is a schema change in three trees.
 */
import type { PingKind, PingRecipientKind } from "@dopl/contracts";

export type { PingKind, PingRecipientKind };


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
