/**
 * Thread grouping — turn the flat channel message list into an ordered render
 * model where one spawned-agent SESSION collapses into a single card.
 *
 * A session is the run sharing one `metadata.taskId` (deterministic
 * `task-{channelId}-{seq}`): `task_started` → (`task_progress`) → agent reply
 * message(s) → `task_finished` / `task_failed`. Rendered as ONE card whose
 * header carries the status chip, so the flat lifecycle rows never show alone.
 *
 * Human messages, `system` rows, and plain agent chat with NO taskId stay their
 * own items. ⚠ Pure + deterministic; input is the transcript in `seq` order.
 *
 * Module layout — `group-thread-types.ts` (render model),
 * `group-thread-markers.ts` (reserved markers, read strictly),
 * `group-thread-render.ts` (card read side), `group-thread-draft.ts`
 * (accumulator). ⚠ THIS FILE is the grouping state machine and is kept WHOLE:
 * the message walk, fallback window, pair-join and finalize pass are one set of
 * interlocking transitions, and splitting by branch scatters the invariants.
 *
 * Every public name is RE-EXPORTED below, so no caller's import changed.
 */

import type { ChannelMessage, ChannelMessageKind } from "../types";
import type { SessionGroup, ThreadItem, ThreadOverlay } from "./group-thread-types";
import { calmSessionEndStatus, isSessionEndedMarker } from "./group-thread-markers";
import { substantiveEndBody } from "./group-thread-render";
import { computeStatus, computeSummary, type Draft } from "./group-thread-draft";

// ⚠ Public surface — callers import from `./group-thread`; the sibling modules
// are an internal layout detail.
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
 * Parse the trailing seq `N` from a legacy `task-{channelId}-{N}` id.
 * ⚠ Anchor on the KNOWN channel id, never split on '-' — the channelId is a UUID
 * that contains hyphens. Null for any other shape, which is what keeps the
 * legacy-only backfill/pair-join scoped to legacy exchanges.
 */
export function parseLegacyTaskSeq(taskId: string, channelId: string): number | null {
  const prefix = `task-${channelId}-`;
  if (!taskId.startsWith(prefix)) return null;
  const rest = taskId.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

/**
 * Which session an untagged agent post may take from the open fallback window.
 * ⚠ The window is CHANNEL-WIDE but a session belongs to ONE operator — the
 * responder whose agent runs it — so the AUTHOR must be checked before folding.
 *
 * - `"join"` — the open session's own responder, or a session with NO known
 *   responder (a real shape: `author_user_id` is `ON DELETE SET NULL`, so a
 *   departed member's history loses its author, and there is no identity left
 *   to compare against).
 * - `"close"` — from OUTSIDE the {requester, responder} pair. Stands alone AND
 *   spends the window: a stranger's post means the exchange moved on.
 * - `"stand-alone"` — inside the pair but not the responder. Does not join, but
 *   the window stays open for the responder's real reply.
 */
type OpenWindowVerdict = "join" | "close" | "stand-alone";

function classifyOpenWindowPost(
  openDraft: Draft | undefined,
  authorUserId: string | null
): OpenWindowVerdict {
  // No draft behind the open id — fall back to the pre-gate behavior.
  if (!openDraft) return "join";
  if (openDraft.responder === null) return "join";
  if (openDraft.responder === authorUserId) return "join";
  if (authorUserId !== null && openDraft.requester === authorUserId) {
    return "stand-alone";
  }
  return "close";
}

/**
 * Group a `seq`-ordered transcript into standalone messages and session cards.
 * A card is emitted at the position of its FIRST event, so chronological order
 * is preserved; concurrent sessions each keep their own and route later events
 * by `taskId`.
 *
 * ⚠ Sessions DO interleave. "One session per channel at a time" is a DM
 * invariant that a three-member channel or two concurrent pairs breaks, which
 * is why the single open fallback window is author-gated rather than trusted
 * ({@link classifyOpenWindowPost}).
 *
 * `taskOverlays` carries authoritative `channel_tasks` state by task id and wins
 * for `status`/`title`; every other group falls back to message-derived values.
 */
export function groupThread(
  messages: ChannelMessage[],
  taskOverlays?: Map<string, ThreadOverlay>
): ThreadItem[] {
  const items: ThreadItem[] = [];
  const drafts = new Map<string, Draft>();
  // Index by seq for the legacy backfill: a `task-{channelId}-{N}` id points
  // back at the seq of the opening request that spawned it.
  const bySeq = new Map<number, ChannelMessage>();
  for (const m of messages) bySeq.set(m.seq, m);
  // ⚠ The single open fallback window. Exists ONLY to catch a terminal-mode
  // agent reply arriving with no taskId (self-posted via MCP, no
  // `task_finished` will follow). Deliberately narrow: opens on `task_started`,
  // closes on the FIRST of — a human/system row; a NEW `task_started`; the
  // matching `task_finished`/`task_failed`; an agent post from OUTSIDE the pair
  // ({@link classifyOpenWindowPost}); or a no-taskId reply being folded in.
  // Once closed, a later no-taskId agent post renders standalone: a session card
  // can never contain a message following an intervening boundary.
  //
  // ⚠ ALSO gated on AUTHORSHIP, because the window is channel-wide. Without that
  // gate a third member's unrelated agent note becomes another pair's reply —
  // retitling their card and flipping a running request to Done — and with two
  // concurrent exchanges one pair's untagged reply lands in the other's card.
  let openTaskId: string | null = null;

  for (const message of messages) {
    const isTaskEvent = TASK_KINDS.has(message.kind);
    const isAgentReply =
      message.kind === "message" && message.authorKind === "agent";
    const ownTaskId = readTaskId(message.metadata);
    const toUserId = readToUserId(message.metadata);

    // OPEN-SESSION PAIR-JOIN — an ADDRESSED message with no task id that fits
    // the open session's {requester, responder} pair joins it, even across the
    // human/system boundary that would otherwise close the window. Keeps a
    // requester's follow-up inside a legacy exchange whose follow-ups never
    // carry the task id. ⚠ A THIRD party does not join AND terminates the
    // window. Gated strictly on `to_user_id`, so an unaddressed transcript is
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
          // ⚠ Responder reply answers the exchange — spend the window, or a
          // missing task_finished lets the NEXT task's seq-N opener be absorbed
          // into this stale card.
          if (author === openDraft.responder) {
            openTaskId = null;
          }
          continue;
        }
        // Third party involved: the exchange moved on — stop accepting here.
        openTaskId = null;
      }
    }

    // ⚠ Hard boundary — a human or system row ends any open fallback window.
    if (message.authorKind !== "agent" || message.kind === "system") {
      openTaskId = null;
    }

    // Resolve this message's session:
    //  - EXPLICIT `metadata.taskId` binds ANY row to that group, so a
    //    first-class task's request + replies + markers share one card.
    //  - NO explicit id: only task events and agent replies fall back to the
    //    open window, and only when the author is that session's own responder.
    //    ⚠ Human / system rows with no id ALWAYS own themselves.
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

    // ⚠ A no-taskId reply reaching its session through the WINDOW consumes it —
    // the terminal reply is delivered, so a later no-taskId post must not attach.
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
        draft.head = message;
        // Establish the pair: responder = this event's author; requester = the
        // legacy seq-N opener's author IF that opener addressed this responder.
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
        // A new start opens (and supersedes any already-open) fallback window.
        openTaskId = taskId;
        break;
      case "task_finished":
      case "task_failed":
        draft.endEvent = message;
        // ⚠ Also an ENTRY when it says something. The header chip comes from
        // `endEvent`, but a marker carrying a body the generators never write is
        // CONTENT and needs a render path — without this, its body has none and
        // finished work is stored, delivered, and shown nowhere.
        if (substantiveEndBody(message)) draft.entries.push(message);
        if (openTaskId === taskId) openTaskId = null;
        break;
      case "task_progress":
        draft.entries.push(message);
        // ⚠ A session-end marker is an ordinary entry AND the source of the
        // card's honest end note — recorded HERE rather than in `endEvent`
        // precisely so it can never become the exchange's outcome.
        //
        // ⚠ The REOPEN echo also rides `task_progress` for that guarantee; only
        // the LANE SPLIT tells it apart. Deliberately NOT wired into
        // `sessionEndedEvent` — a reopen is the opposite signal.
        if (isSessionEndedMarker(message)) draft.sessionEndedEvent = message;
        break;
      default:
        // Substantive body — an agent reply, or a first-class task's own
        // explicit-taskId request.
        draft.entries.push(message);
        // ⚠ A no-taskId reply spends the window — terminal mode posts one result
        // and goes quiet, so nothing after it folds in.
        if (viaFallback && openTaskId === taskId) openTaskId = null;
        break;
    }
  }

  // ⚠ Finalize in place — the items array holds live references. The overlay is
  // authoritative for status/title; without one, message-derived values stand.
  for (const draft of drafts.values()) {
    // LEGACY TRIGGER BACKFILL — pull a legacy session's still-loose opening
    // request (the standalone seq-N message addressed to the responder) in as
    // the OPENING entry and remove it from the standalone stream. ⚠ Only when
    // the session actually started; a lone decision-echo card (declined /
    // dropped / interrupted, no start, no entries) is left untouched.
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
    // with NO restart after it means the session stopped. A later `task_started`
    // clears it. ⚠ Kept independent of `status` so an "active" overlay cannot
    // hide the end. Two sources, one note — a terminal marker's calm flag and
    // the non-terminal `session_ended` marker; the terminal one wins when both
    // are present.
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
