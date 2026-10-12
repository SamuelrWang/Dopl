/**
 * **THE THREAD SHAPES, SPLIT OUT OF `channel-types.ts`** (2026-10-12).
 *
 * ⚠ **A REAL SPLIT, PAYING OFF A DATED EXEMPTION.** `channel-types.ts` sat at 499
 * lines against the 500-line cap and took a "split scheduled" entry in
 * `eslint.config.mjs` when B2 needed two declaration lines. Grammar B needed more
 * room again, so the debt is settled rather than rolled: the thread subject moves
 * here whole and the exemption is dropped. ⚠ The same lesson that list records
 * about `invitations.ts` — what finally moves a file is a behavioural requirement
 * landing on it, not the line count that had been scheduling it for weeks.
 *
 * ⚠ **THE SEAM IS THE SUBJECT, AND THE MESSAGE SHAPES DELIBERATELY STAYED.**
 * `ChannelMessage` is named by `twin-drift.test.ts`'s pair list against
 * `src/features/channels/types.ts`, and `WorkspaceChannelMessage` extends it; a
 * parity gate that has to chase a type between filenames is a gate that gets
 * turned off. Threads are a different subject and nothing in that pair list names
 * them.
 *
 * ⚠ **NO IMPORTER MOVED.** `channel-types.ts` re-exports every name below, which
 * is the arrangement the exemption list itself calls a real split — `channel.ts`,
 * `client-channels.ts` and `index.ts` all still import these from
 * `./channel-types.js`.
 */

import type {
  MessageIntent,
  ThreadMode,
  ThreadOutcome,
  ThreadStatus,
} from "@dopl/contracts";

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

export interface ChannelThreadCreateInput {
  title: string;
  mode?: ThreadMode;
  body: string;
  toUserId?: string; // omitted: the opener's thread alone, and its opener wakes nobody
  intent?: MessageIntent; // "chat" opens it as a record; refused with toUserId
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
