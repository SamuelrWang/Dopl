/**
 * Thread grouping — turn the flat channel message list into an ordered render
 * model where one spawned-agent SESSION collapses into a single card.
 *
 * A session is the run of messages/events sharing one `metadata.taskId`
 * (deterministic `task-{channelId}-{seq}`): `task_started` →
 * (`task_progress`) → agent reply message(s) → `task_finished` /
 * `task_failed`. The web renders it as ONE card whose header carries the
 * status chip, so the flat "Started working…/Finished this request." rows are
 * replaced by the chip and never shown on their own.
 *
 * Human messages, `system` rows, and plain agent chat WITHOUT a taskId stay as
 * their own items and render unchanged.
 *
 * Pure + deterministic so it can be unit-tested in isolation. Input is the
 * transcript in `seq` order (the repository returns messages ascending).
 *
 * MODULE LAYOUT (§2 split, 2026-08-08 — this file was 819 lines). The seams are
 * "reasons to change", not arithmetic:
 * - `group-thread-types.ts`   — the render model every channels surface consumes.
 * - `group-thread-markers.ts` — the reserved metadata markers, read strictly.
 * - `group-thread-render.ts`  — the card's read side (lanes, bodies, proposals).
 * - `group-thread-draft.ts`   — the accumulator + what a finished one means.
 * - THIS FILE                 — the grouping state machine, kept whole per §2's
 *   reducer carve-out: the message walk, the fallback window, the pair-join and
 *   the finalize pass are one set of interlocking transitions, and splitting
 *   them by branch would scatter the invariants that make them correct.
 *
 * Every public name is RE-EXPORTED below, so no caller's import changed.
 */

import type { ChannelMessage, ChannelMessageKind } from "../types";
import type { SessionGroup, ThreadItem, ThreadOverlay } from "./group-thread-types";
import { calmSessionEndStatus, isSessionEndedMarker } from "./group-thread-markers";
import { substantiveEndBody } from "./group-thread-render";
import { computeStatus, computeSummary, type Draft } from "./group-thread-draft";

// The module's public surface, unchanged by the split. Callers import from
// `./group-thread` exactly as before; the sibling modules are an internal
// layout detail, and a re-export here is cheaper than touching nine importers.
export type {
  CloseProposal,
  SessionGroup,
  SessionStatus,
  ThreadItem,
  ThreadOverlay,
} from "./group-thread-types";
export {
  calmSessionEndStatus,
  calmTerminalStatus,
  isCalmTerminalStatus,
  isSessionEndedMarker,
  isThreadReopenedMarker,
  SESSION_ENDED_KEY,
  THREAD_REOPENED_KEY,
} from "./group-thread-markers";
export {
  readCloseProposal,
  splitSessionEntries,
  substantiveEndBody,
  truncateSummary,
  type SessionLanes,
} from "./group-thread-render";

const TASK_KINDS: ReadonlySet<ChannelMessageKind> = new Set([
  "task_started",
  "task_progress",
  "task_finished",
  "task_failed",
]);

function readTaskId(metadata: Record<string, unknown>): string | null {
  const value = metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The addressed recipient of a message (`metadata.to_user_id`), or null. */
function readToUserId(metadata: Record<string, unknown>): string | null {
  const value = metadata.to_user_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parse the trailing seq `N` from a legacy deterministic task id of the shape
 * `task-{channelId}-{N}` (the desktop spawner's id). The channelId is a UUID
 * that itself contains hyphens, so we anchor on the KNOWN channel id rather
 * than splitting on '-'. Returns null for any other id shape (a first-class
 * UUID task id, etc.), which is how the legacy-only backfill/pair-join stay
 * scoped to legacy exchanges.
 */
export function parseLegacyTaskSeq(taskId: string, channelId: string): number | null {
  const prefix = `task-${channelId}-`;
  if (!taskId.startsWith(prefix)) return null;
  const rest = taskId.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

/**
 * Which session, if any, an untagged agent post may take from the open fallback
 * window. The window is CHANNEL-WIDE but a session belongs to ONE operator: the
 * responder whose agent runs it. In a DM those are the same thing; in a channel
 * with a third member, or with two pairs working at once, they are not, so the
 * author must be checked before the post is folded in.
 *
 * - `"join"`   — the post is the open session's own responder, or the session
 *   has no known responder at all, which keeps an anonymous transcript
 *   byte-for-byte unchanged. A null responder is a REAL shape, not just a test
 *   fixture: `author_user_id` is `ON DELETE SET NULL`, so a departed member's
 *   history loses its author. Such a session keeps the old ungated behavior on
 *   purpose — there is no identity left to compare against.
 * - `"close"`  — the post comes from OUTSIDE the open session's
 *   {requester, responder} pair. It stands alone AND spends the window, exactly
 *   as an addressed third party already does in the pair-join: a stranger's post
 *   means the exchange moved on, so nothing after it folds in either.
 * - `"stand-alone"` — inside the pair but not the responder (the requester's own
 *   agent). It is not the session's answer so it does not join, but it is not a
 *   stranger either, so the window stays open for the responder's real reply.
 */
type OpenWindowVerdict = "join" | "close" | "stand-alone";

function classifyOpenWindowPost(
  openDraft: Draft | undefined,
  authorUserId: string | null
): OpenWindowVerdict {
  // No draft behind the open id (unreachable — the window is only opened right
  // after its draft exists): fall back to the pre-gate behavior.
  if (!openDraft) return "join";
  if (openDraft.responder === null) return "join";
  if (openDraft.responder === authorUserId) return "join";
  if (authorUserId !== null && openDraft.requester === authorUserId) {
    return "stand-alone";
  }
  return "close";
}

/**
 * Group a `seq`-ordered transcript into an ordered list of standalone messages
 * and session cards. A session card is emitted at the position of its first
 * event, so chronological order is preserved; concurrent sessions each keep
 * their own card and route later events by `taskId`.
 *
 * Sessions DO interleave. "One session runs per channel at a time" is a DM
 * invariant — a three-member channel, or two pairs working at once, breaks it
 * outright — which is why the single open fallback window below is author-gated
 * rather than trusted (see {@link classifyOpenWindowPost}).
 *
 * `taskOverlays` (optional) carries the authoritative `channel_tasks` state
 * keyed by task id. When a group's `taskId` is present, its `status`/`title`
 * are taken from the overlay; every other group falls back to the
 * message-derived status/summary. Calling `groupThread(messages)` with no map
 * is byte-for-byte the legacy behavior.
 */
export function groupThread(
  messages: ChannelMessage[],
  taskOverlays?: Map<string, ThreadOverlay>
): ThreadItem[] {
  const items: ThreadItem[] = [];
  const drafts = new Map<string, Draft>();
  // Index by seq for the legacy seq-N backfill: a legacy `task-{channelId}-{N}`
  // id points back at the seq of the opening request that spawned it.
  const bySeq = new Map<number, ChannelMessage>();
  for (const m of messages) bySeq.set(m.seq, m);
  // The single open fallback window: the session whose `task_started` has fired
  // and not yet been closed. It exists ONLY to catch a terminal-mode agent
  // reply that arrives without its own taskId (the reply is self-posted via MCP
  // and no `task_finished` will ever follow). The window is deliberately narrow
  // — it opens on `task_started` and closes on the FIRST of: a human/system row
  // (`authorKind !== 'agent'` or `kind === 'system'`); a NEW `task_started`
  // (a different session supersedes the prior open one); the matching
  // `task_finished`/`task_failed`; an agent post from OUTSIDE the session's
  // pair (see {@link classifyOpenWindowPost}); or a no-taskId reply being folded
  // in (terminal mode delivers one reply, then the window is spent). Once
  // closed, an incidental no-taskId agent post is no longer contiguous with any
  // open session and renders as a standalone plain agent bubble — a session card
  // can never contain a message that follows an intervening boundary.
  //
  // The window is channel-wide, so it is ALSO gated on authorship: only the open
  // session's own responder may take it. Without that gate a third member's
  // unrelated agent note becomes another pair's reply — retitling their card and
  // flipping a still-running request to Done — and, with two concurrent
  // exchanges, one pair's untagged reply lands in the other pair's card and
  // suppresses its "Working…" line.
  let openTaskId: string | null = null;

  for (const message of messages) {
    const isTaskEvent = TASK_KINDS.has(message.kind);
    const isAgentReply =
      message.kind === "message" && message.authorKind === "agent";
    const ownTaskId = readTaskId(message.metadata);
    const toUserId = readToUserId(message.metadata);

    // B2 OPEN-SESSION PAIR-JOIN — an ADDRESSED message with no task id of its
    // own that fits the open session's {requester, responder} pair joins that
    // session, even across the human/system boundary that would otherwise close
    // the window. This keeps a requester's follow-up (and the responder's
    // addressed reply) inside a legacy `task-{channel}-{seq}` exchange whose
    // follow-ups never carry the task id. A message to/from a THIRD party is not
    // in the pair: it does not join, and it terminates the window. Gated
    // strictly on `to_user_id`, so a transcript with no addressing metadata is
    // byte-for-byte unchanged.
    if (
      toUserId !== null &&
      ownTaskId === null &&
      message.kind === "message" &&
      openTaskId !== null
    ) {
      const openDraft = drafts.get(openTaskId);
      if (
        openDraft &&
        openDraft.startedEvent &&
        openDraft.requester !== null &&
        openDraft.responder !== null
      ) {
        const pair = new Set([openDraft.requester, openDraft.responder]);
        const author = message.authorUserId;
        const inPair =
          author !== null &&
          author !== toUserId &&
          pair.has(author) &&
          pair.has(toUserId);
        if (inPair) {
          openDraft.entries.push(message);
          if (Date.parse(message.createdAt) < Date.parse(openDraft.createdAt)) {
            openDraft.createdAt = message.createdAt;
          }
          // A responder-authored reply answers the exchange: spend the window
          // so that, if this session's task_finished never arrives, the NEXT
          // task's seq-N opener can't be absorbed into this stale card.
          if (author === openDraft.responder) {
            openTaskId = null;
          }
          continue;
        }
        // Addressed, but a third party is involved: the exchange moved on —
        // stop accepting into this session (the message itself stands alone).
        openTaskId = null;
      }
    }

    // Hard boundary: a human or system row ends any open fallback window, so a
    // later no-taskId agent post cannot fold into the session that preceded it.
    if (message.authorKind !== "agent" || message.kind === "system") {
      openTaskId = null;
    }

    // Resolve the session this message belongs to (if any).
    //  - An EXPLICIT `metadata.taskId` binds ANY row (a human request, an agent
    //    reply, or a lifecycle marker) to that group. A first-class task's
    //    request + replies + markers all share one id, so the requester's own
    //    message folds into the card alongside the answers.
    //  - With NO explicit id, only task events and agent replies fall back to
    //    the open window (legacy terminal-mode sessions that self-post without
    //    an id), and only when the author is that session's own responder —
    //    the window is channel-wide, the session is not. Human / system rows
    //    with no id always own themselves.
    let taskId: string | null = null;
    if (ownTaskId !== null) taskId = ownTaskId;
    else if ((isTaskEvent || isAgentReply) && openTaskId !== null) {
      const verdict = classifyOpenWindowPost(
        drafts.get(openTaskId),
        message.authorUserId
      );
      if (verdict === "join") taskId = openTaskId;
      else if (verdict === "close") openTaskId = null;
    }

    if (taskId === null) {
      items.push({ type: "message", key: message.id, message });
      continue;
    }

    // A no-taskId agent reply that reaches its session through the open window
    // (not by its own taskId) consumes that window — the terminal reply has
    // been delivered, so a LATER unrelated no-taskId post must not attach here.
    const viaFallback = isAgentReply && ownTaskId === null;

    let draft = drafts.get(taskId);
    if (!draft) {
      draft = {
        taskId,
        head: message,
        entries: [],
        startedEvent: null,
        endEvent: null,
        createdAt: message.createdAt,
        responder: null,
        requester: null,
        legacySeq: null,
        sessionEndedEvent: null,
      };
      drafts.set(taskId, draft);
      // Placeholder session object; finalized in place after the full pass.
      items.push({
        type: "session",
        key: `session:${taskId}`,
        session: draft as unknown as SessionGroup,
      });
    }

    if (Date.parse(message.createdAt) < Date.parse(draft.createdAt)) {
      draft.createdAt = message.createdAt;
    }

    switch (message.kind) {
      case "task_started":
        draft.startedEvent = message;
        // Prefer the lifecycle-opening event as the identity/time head.
        draft.head = message;
        // Establish the pair for the pair-join: the responder is this event's
        // author; the requester is the legacy seq-N opener's author IF that
        // opener addressed this responder (the same test the backfill applies).
        draft.responder = message.authorUserId;
        draft.legacySeq = parseLegacyTaskSeq(taskId, message.channelId);
        if (draft.requester === null && draft.legacySeq !== null) {
          const opener = bySeq.get(draft.legacySeq);
          if (
            opener &&
            draft.responder !== null &&
            readToUserId(opener.metadata) === draft.responder
          ) {
            draft.requester = opener.authorUserId;
          }
        }
        // A new start opens (and, if one was already open, supersedes/closes)
        // the fallback window.
        openTaskId = taskId;
        break;
      case "task_finished":
      case "task_failed":
        draft.endEvent = message;
        // P0-4 — AND IT IS ALSO AN ENTRY WHEN IT SAYS SOMETHING. The header chip
        // is derived from `endEvent`; that stays. What changes is that a marker
        // carrying a body the generators never write is content, and content
        // needs a render path. Without this line its body has NONE — which is
        // how a finished piece of work was stored, delivered, and shown nowhere.
        // Pushed here, in seq order, so it reads as the last thing said.
        if (substantiveEndBody(message)) draft.entries.push(message);
        if (openTaskId === taskId) openTaskId = null;
        break;
      case "task_progress":
        draft.entries.push(message);
        // P1-7: a session-end marker is an ordinary entry AND the source of the
        // card's honest end note. It is recorded here rather than in `endEvent`
        // precisely so it can never become the exchange's outcome.
        //
        // F-176: the REOPEN echo also rides `task_progress` for that same
        // guarantee, and needs nothing from the state machine — it is an
        // ordinary entry here, and only the LANE SPLIT tells it apart (a
        // resumption is a status line, not a milestone). Deliberately NOT wired
        // into `sessionEndedEvent`: a reopen is the opposite signal.
        if (isSessionEndedMarker(message)) draft.sessionEndedEvent = message;
        break;
      default:
        // A substantive body message — an agent reply, or (for a first-class
        // task) the requester's own explicit-taskId request.
        draft.entries.push(message);
        // A fallback (no-taskId) reply spends the open window: terminal mode
        // posts its single result and goes quiet, so nothing after it folds in.
        if (viaFallback && openTaskId === taskId) openTaskId = null;
        break;
    }
  }

  // Finalize each draft in place (the items array holds live references). The
  // overlay (a first-class `channel_tasks` row) is authoritative for
  // status/title; without one, the message-derived render is used unchanged.
  for (const draft of drafts.values()) {
    // B1 LEGACY TRIGGER BACKFILL — a legacy `task-{channelId}-{N}` session whose
    // opening request (the standalone seq-N message, addressed to the responder)
    // is still loose in the stream: pull it into the session as the OPENING
    // entry so the card leads with the request that started the work, and remove
    // it from the standalone stream. Only when the session actually started (has
    // a `task_started`); a lone decision-echo card (declined/dropped/interrupted
    // with no start and no entries) is deliberately left untouched.
    if (
      draft.startedEvent &&
      draft.legacySeq !== null &&
      draft.responder !== null
    ) {
      const idx = items.findIndex(
        (it) => it.type === "message" && it.message.seq === draft.legacySeq
      );
      if (idx !== -1) {
        const found = items[idx];
        if (
          found.type === "message" &&
          readToUserId(found.message.metadata) === draft.responder
        ) {
          draft.entries.unshift(found.message);
          if (draft.requester === null) {
            draft.requester = found.message.authorUserId;
          }
          items.splice(idx, 1);
        }
      }
    }

    const session = draft as unknown as SessionGroup;
    const overlay = taskOverlays?.get(draft.taskId);
    session.status = overlay ? overlay.status : computeStatus(draft);
    session.summary = computeSummary(draft);
    session.title = overlay?.title ?? null;
    session.mode = overlay?.mode ?? null;
    session.outcomeSummary = overlay?.outcomeSummary ?? null;
    // Honest end signal: a calm session-end marker (interrupted/capped/ended)
    // with NO restart after it means the session stopped, not that it is still
    // working. A later `task_started` (a resume that re-opened work) clears it.
    // Kept independent of `status` so an "active" overlay can't hide the end.
    // P1-7 — TWO SOURCES, ONE NOTE. A terminal marker's calm flag as before, and
    // the non-terminal `session_ended` marker for the case that used to be forced
    // through `task_failed` just to be visible. The terminal one wins when both
    // are present (a real end outranks a parked window), and either is cleared by
    // a later `task_started` — a resume re-opened the work.
    const endEvent = draft.endEvent;
    const terminalEnd = endEvent ? calmSessionEndStatus(endEvent) : null;
    const marker = draft.sessionEndedEvent;
    const source = terminalEnd !== null ? endEvent : marker;
    const endStatus = terminalEnd !== null ? terminalEnd : marker ? "ended" : null;
    const restarted =
      source !== null &&
      draft.startedEvent !== null &&
      draft.startedEvent.seq > source.seq;
    session.calmEndStatus = endStatus !== null && !restarted ? endStatus : null;
  }

  return items;
}
