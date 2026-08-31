"use client";

/**
 * WHAT ONE AGENT HAS BEEN DOING, AS ONE ORDERED LIST — the pure half of the work
 * stream both agent surfaces render (Samuel, 2026-08-22: the slide-out panel
 * graduates from a Sent-lane to the full stream).
 *
 * ⚠ FOUR THINGS SHARE ONE COLUMN, AND THEY ARE NOT THE SAME KIND OF THING. The
 * agent's own reasoning, the tools it ran, what it POSTED into the channel, and
 * the private 1:1 traffic between it and its operator. Only the third is public;
 * the first two are local to this machine and reach nobody; the fourth is
 * deliberately out of band (`main/session-seed.js › frameOperatorTurn` tells the
 * agent so). Rendering them alike is how an operator comes to believe the
 * counterparty saw a private steer.
 *
 * ⚠ THE `kind` VOCABULARY IS MAIN'S AND IS STILL GROWING. `session-narration.js ›
 * entryFor` owns it, and the desktop is adding distinguishable kinds as this
 * lands. **So the mapping below is an ALIAS TABLE with a fallback, not a switch
 * over a closed set** — an unrecognised kind renders as a plain note carrying its
 * own text, never as a crash and never as a dropped line. A stream that silently
 * loses frames is worse than one that renders a frame plainly: the operator is
 * reading this to find out what happened.
 *
 * ⚠ AND AN OLDER MAIN'S FRAMES STILL WORK UNCHANGED. `assistant` / `tool` /
 * `result` / `post` / `status` are the five that exist today; every one of them
 * has a row here, so a build that emits nothing new renders exactly what it
 * rendered before this file existed.
 */

import { escalationStreamPayload } from "./view-model-escalation";
import type { AgentNarrationEntry } from "./use-agent-narration";
import type { ChannelEscalation } from "../../escalation";
import type { ChannelConsentRequest, ChannelMessage } from "../../types";

/**
 * ⚠ THE LANE VOCABULARY LIVES IN `agent-stream-lanes.ts` SINCE 2026-08-31 (§1),
 * and this file stays its import path of record — {@link StreamLane} and
 * {@link frameLane} are re-exported here, so no importer changed. The seam: that
 * file moves when the DESKTOP's `kind` / `lane` vocabulary moves, this one when
 * the stream's own arithmetic does (the echo dedupe, the held-draft join, the
 * TTL, the grouping) — and neither has ever needed the other's reason.
 */
export { frameLane, type StreamLane } from "./agent-stream-lanes";
import { frameLane, type StreamLane } from "./agent-stream-lanes";

/** One row of the rendered stream. */
export interface StreamItem {
  key: string;
  lane: StreamLane;
  /** Epoch ms, for ordering. */
  at: number;
  text: string;
  /** `tool` rows only — the RAW tool name; shortened at render. */
  tool?: string;
  /** `tool` rows only — `false` on a result that failed. */
  ok?: boolean;
  /** `sent` rows only — where it went, for the box's banner. */
  to?: string | null;
  /**
   * `sent` rows only — THE STRUCTURED ESCALATION this post carries, when it is
   * one (2026-08-31). Set from the TRANSCRIPT row's server-stamped metadata and
   * never from a narration frame: the payload is reserved, so the only honest
   * source is the message the server actually stored.
   *
   * ⚠ ABSENT IS THE ORDINARY ANSWER and the row renders as the plain sent box,
   * showing the same words in prose — what a build without the key shows.
   */
  escalation?: { messageId: string; payload: ChannelEscalation };
  /**
   * `sent` rows only — **this post has not gone out yet.** The outbound consent
   * gate is holding it and the card is the review surface (Samuel, 2026-08-25).
   * ⚠ Never set on a row built from a TRANSCRIPT message: that row exists on the
   * server, which is the definition of sent.
   */
  pending?: boolean;
  /**
   * `pending` rows only — the `channel_consent_requests` row the Post button
   * decides, or `null` when nothing decidable matches this draft.
   *
   * ⚠ **`null` IS "NOTHING TO PRESS", NOT "IT NEVER WENT" (corrected 2026-08-25).**
   * It covers the 15s between a Post and the desktop's poll delivering it, a row
   * denied on another surface, and a body-join that missed — none of which is a
   * failure the card may assert. Only {@link StreamItem.expired} says that.
   */
  requestId?: string | null;
  /**
   * `pending` rows only — this draft's own row is PAST ITS TTL, so nothing will
   * ever post it. The one condition under which the card may say "Not sent".
   *
   * ⚠ **IT IS COMPUTED HERE BECAUSE THE SERVER DOES NOT SWEEP.** INVARIANTS §6:
   * expiry is LAZY and `listConsentRequests` is deliberately unswept, so an
   * elapsed row is still returned with `status: "pending"`. Trusting that status
   * would put a live Post button on a row the decide route will refuse.
   */
  expired?: boolean;
  /**
   * MAIN CUT THIS LINE AT ITS PROSE CAP AND THE TAIL EXISTS NOWHERE (2026-08-31,
   * `spa-bridge-shapes.ts › DesktopNarrationEntry.truncated`). The cap equals the
   * renderer's own expanded ceiling, so a `length >` check can never detect a
   * main-cut line — this flag is the only marker there is, and every face that
   * shows the text must say so when it is set (INVARIANTS §9).
   * ⚠ Absent means ARRIVED WHOLE — only an explicit `true` counts.
   */
  truncated?: boolean;
  /**
   * `directed` rows only — **WHICH of this operator's agents filed the direction**
   * (F-376a, 2026-08-31): an 8-char agent instance id, not a display name.
   *
   * 🔒 **A CAPTION, AND AN UNVERIFIED ONE. Nothing may gate, filter or authorize on
   * it** (`spa-bridge-shapes.ts › DesktopNarrationEntry.senderAgentId` carries the
   * argument: the server derives it from a header that proves nothing about the
   * caller). It is safe to SHOW only because sender and recipient are the same
   * operator's agents by construction.
   * ⚠ **IT IS AN ID, SO A FACE MUST RESOLVE IT BEFORE RENDERING IT** — an agent id
   * is never printed at a person on this surface (`agent-id-visibility.test.ts`).
   * ⚠ Absent is the ORDINARY case, not unknown: an external orchestrator has no
   * session stamp. The fallback is the anonymous sentence, never a raw id.
   */
  senderAgentId?: string;
}

/**
 * THE ONE NORMALIZATION BOTH SIDES OF THE PENDING JOIN GO THROUGH.
 *
 * ⚠ IT MIRRORS `main/session-narration.js › line(value, POST_CAP)` DELIBERATELY,
 * because that is what the frame's text has already been through: whitespace
 * collapsed to single spaces, trimmed, sliced at 1000, THEN TRIMMED AGAIN. The
 * consent row's `proposedReply` is the SAME body untouched (`session-windowless.js
 * › bridgeOutbound` posts `body` verbatim), so putting both through this is the
 * only way an equality can be true at all.
 *
 * ⚠ THE SECOND `.trim()` IS LOAD-BEARING AND MUST MATCH `line`. For a body over
 * 1000 chars whose char 999 is the space between two words, `slice(0, 1000)`
 * ends on that space; `line` drops it with its trailing trim and the frame text
 * does too, so an echo WITHOUT the trailing trim keeps a space the frame lost
 * and `landed.has(echo)` never matches — the card stays "Pending" over a message
 * that was delivered. The two chains cannot drift: they must be character-for-
 * character the same discipline.
 *
 * ⚠ **THE JOIN IS ON THE BODY BECAUSE THERE IS NO ID TO JOIN ON.** A consent row
 * carries `(channel, message_seq)` and nothing that names an AGENT — the row is
 * created by `bridgeOutbound` long after the frame was pushed, and the frame is
 * per-SESSION with no row id in it. The frame is already agent-scoped (the ring
 * belongs to one session), so the only ambiguity this can produce is between two
 * of one operator's drafts whose bodies are identical to the character — in which
 * case either row approves the same bytes.
 */
export function postEcho(text: string | null | undefined): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, POST_CAP).trim();
}

/**
 * `main/session-narration.js › POST_CAP`, and it must be **≤** main's, never ≥.
 *
 * ⚠ THIS NOTE STATED THE SAFE DIRECTION BACKWARDS UNTIL 2026-08-28 — it read *"it only has to be
 * an UPPER bound: main slicing shorter than this leaves both sides of the join untouched"*, which
 * is the failing case, not the safe one. Work the join:
 *
 *   `echo   = postEcho(frameText)`  — over text main ALREADY cut at ITS cap
 *   `landed = postEcho(fullBody)`   — over the untruncated server body
 *
 * If main's cap is SHORTER than this one, a body longer than main's cap gives `echo` main's
 * prefix and `landed` this file's longer prefix. They cannot be equal, `landed.has(echo)` is
 * false, and the card reads **Pending forever over a post that was delivered** — the exact defect
 * the second `.trim()` above was written to prevent, arriving by the other road. If main's cap is
 * LONGER, this file's `slice` cuts both chains at the same place and they match. So MAIN's is the
 * upper bound on THIS one.
 *
 * ⚠ IN PRACTICE THEY ARE THE SAME 1000 AND SHOULD STAY SO — main's own constant says *"DO NOT
 * MOVE IT: `channels-v2/agent-stream-model.ts › POST_CAP` is the SAME 1000 and the held-draft
 * join is character-for-character against it."* ⚠ AND NOTHING PINS EITHER LITERAL: the desktop
 * suite pins `PROSE_CAP`, not this, and the web side only brackets it from ABOVE
 * (`agent-stream-consent.test.tsx` re-slices at a hand-written 1000, which still passes if both
 * caps drop together). Filed as F-352.
 */
const POST_CAP = 1000;

/** Is this frame a post the outbound gate is still holding? ⚠ Read defensively —
 *  `pending` is main's to widen, and absent means SENT (`spa-bridge-shapes.ts`). */
function framePending(entry: AgentNarrationEntry): boolean {
  return (entry as AgentNarrationEntry & { pending?: unknown }).pending === true;
}

/**
 * IS THIS DRAFT'S ROW PAST ITS OWN TTL — the ONLY thing that earns the "Not
 * sent" face.
 *
 * ⚠ THE CLIENT HAS TO DO THIS ARITHMETIC BECAUSE THE SERVER DOES NOT SWEEP
 * (INVARIANTS §6: expiry is LAZY, no cron, and `listConsentRequests` is
 * deliberately unswept so it can serve as the audit trail). An elapsed row comes
 * back `status: "pending"` — the same shape as a live one — so a card that
 * trusted the status would offer a Post the decide route is going to refuse.
 *
 * ⚠ NO ROW IS NOT AN EXPIRED ROW. `null` returns `false`: the draft may be in
 * the 15-second gap between an approval and the desktop poll that delivers it,
 * and calling that "Not sent" is the exact defect this function was added with.
 * ⚠ A row with NO `expiresAt` never expires here — absent is unknown, and
 * unknown must not read as elapsed.
 */
function isExpired(
  request: ChannelConsentRequest | null,
  now: number
): boolean {
  if (!request?.expiresAt) return false;
  const at = new Date(request.expiresAt).getTime();
  return Number.isFinite(at) && at <= now;
}

/** ISO → epoch ms, or 0 for an unparseable stamp. ⚠ 0 SORTS FIRST rather than
 *  dropping the row: a message with a bad timestamp is still a message. */
function epoch(iso: string): number {
  const ts = new Date(iso).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * THE STREAM, IN TIME ORDER.
 *
 * ⚠ THE TRANSCRIPT IS THE RECORD OF A POST; THE NARRATION FRAME IS A LOCAL ECHO
 * OF IT. Both describe the same act, so `sent` FRAMES ARE DROPPED whenever real
 * transcript rows are supplied — otherwise every post appears twice, once as a
 * box and once as a line, and the reader has no way to know it is one event. The
 * transcript row wins because it is the thing that actually exists on the server:
 * it has an id, the stored body, and a timestamp everybody agrees on.
 *
 * ⚠ WITH NO TRANSCRIPT ROWS THE FRAMES ARE KEPT. A surface that has narration and
 * no messages read (or a post that has not landed in the transcript yet) would
 * otherwise show an agent that thinks and runs tools and never says anything.
 *
 * ⚠ `null` ENTRIES ARE "COULD NOT ASK" AND ARE NOT `[]`. This function takes the
 * distinction as given and simply builds from what it has; the CALLER words the
 * two absences differently (INVARIANTS §11 — UNKNOWN is not EMPTY).
 *
 * ⚠ STABLE SORT, BY TIME ONLY. Frames and messages interleave, and within one
 * timestamp the input order is the desktop's own — re-ordering it would be this
 * file claiming to know better than the machine that watched it happen.
 *
 * ── THE PENDING LANE (2026-08-25, Samuel's outbound-review ruling) ────────────
 *
 * ⚠ A GATED POST HAS NO TRANSCRIPT ROW BY CONSTRUCTION, so the blanket
 * "drop every `sent` frame once the transcript has anything" rule above would
 * DELETE the one row the operator has to act on. A pending frame is therefore
 * retired by its OWN text landing in the transcript — which is exactly the event
 * that means it was sent — and by nothing else.
 *
 * ⚠ THE FRAME NEVER CLEARS ITSELF. Main writes the ring entry once and does not
 * revisit it (`spa-bridge-shapes.ts › DesktopNarrationEntry.pending`), so after
 * the operator presses Post the frame still says pending; the SERVER's transcript
 * row is what retires it. That asymmetry is why the dedupe below is per-text
 * rather than per-lane.
 *
 * ── ⚠ THE `delivered` INPUT, AND THE BUG THAT BOUGHT IT (2026-08-25) ──────────
 *
 * A draft Samuel approved was DELIVERED — `channel_messages` row at 16:14:30Z,
 * consent row `allowed` at 16:14:15Z — and this stream still painted it
 * **"Not sent"**. Two mistakes compounded:
 *
 *   1. **The landing check read the AGENT-FILTERED lane.** `sent` comes from
 *      `agent-panel.tsx › agentSentMessages`, which requires
 *      `m.metadata.taskId === taskId`. **A channel-level post carries no
 *      `taskId`** — the measured row's metadata was
 *      `{intent, runtime, summary, session_id}` and nothing else — so the
 *      delivered row was filtered out before the join could see it, on every
 *      threadless post there is. The join itself was never wrong: the stored
 *      `proposed_reply` and the delivered `body` were byte-identical at 95
 *      chars. **So the landing check now reads `delivered`, the WHOLE channel
 *      transcript**, and only the RENDERING of a posted row stays agent-scoped.
 *   2. **Absence was read as failure.** "No pending row matched" was rendered as
 *      "Not sent", which is also true of the 15 seconds between a Post and the
 *      desktop's poll delivering it. **Absence is now UNKNOWN**; only a row past
 *      its own TTL earns the failed face.
 *
 * ⚠ NOTHING HERE IS LOCAL STATE ANY MORE, deliberately. An earlier cut tracked
 * pressed cards in a `useState` Set keyed on the stream key; that could not
 * survive a remount and could not see a Post pressed on the OTHER surface. Every
 * input below is a server fact.
 */
export function buildAgentStream({
  entries,
  sent,
  delivered,
  pending = [],
  threadTitle,
  now = Date.now(),
}: {
  entries: readonly AgentNarrationEntry[] | null;
  sent: readonly ChannelMessage[];
  /**
   * THE WHOLE CHANNEL TRANSCRIPT — the landing check's evidence, and NOT the
   * same thing as {@link sent}.
   *
   * ⚠ IT IS UNFILTERED ON PURPOSE. `sent` is agent-scoped so one agent's box
   * never shows a sibling's words (F-251); this answers a different question —
   * *did these bytes reach the channel at all* — and the agent filter is
   * actively wrong for it, because a threadless post carries no `taskId` to be
   * filtered ON. Defaults to `sent` so a caller that has not threaded it yet
   * behaves exactly as before.
   */
  delivered?: readonly ChannelMessage[];
  /**
   * The viewer's PENDING outbound consent rows (`use-consent-inbox.ts ›
   * outbound`). ⚠ Workspace-wide as it arrives, and deliberately not narrowed
   * here: the join is on the draft's own body, which is a stronger key than any
   * scope this function could apply.
   */
  pending?: readonly ChannelConsentRequest[];
  /** Where a post went, for the sent box's banner. */
  threadTitle?: string | null;
  /** Injectable clock — the TTL comparison below is the only reader. */
  now?: number;
}): StreamItem[] {
  const hasTranscript = sent.length > 0;
  const posted = new Set(sent.map((m) => postEcho(m.body)));
  const landed = new Set((delivered ?? sent).map((m) => postEcho(m.body)));
  const pendingByBody = new Map<string, ChannelConsentRequest>();
  for (const request of pending) {
    const body = postEcho(request.proposedReply);
    // FIRST wins, matching `view-model-requested.ts › joinRequestsToThreads`: the
    // oldest identical draft is the one that has been waiting.
    if (body && !pendingByBody.has(body)) pendingByBody.set(body, request);
  }
  const items: StreamItem[] = [];
  // ⚠ TRACKED HERE, NOT DERIVED FROM `items` — a frame that has LANDED carries no
  // `pending` on its item, so a settled ring is indistinguishable from an old
  // main's ring by the output alone. That is precisely the state Samuel's stale
  // gate note was sitting in.
  let sawGateStamp = false;

  (entries ?? []).forEach((entry, i) => {
    const lane = frameLane(entry);
    const text = entry.text ?? "";
    const echo = postEcho(text);
    if (lane === "sent" && framePending(entry)) sawGateStamp = true;
    // ⚠ HELD ONLY UNTIL ITS WORDS LAND. A frame whose body is in the channel
    // went out, whoever approved it and however many times this component has
    // remounted since — that is the fact that outranks every consent row.
    const held = lane === "sent" && framePending(entry) && !landed.has(echo);
    // Landed AND attributable to this agent: the real transcript row renders it,
    // so the echo drops rather than doubling.
    if (lane === "sent" && !held && posted.has(echo)) return;
    // ⚠ A FORMERLY-HELD FRAME IS NOT DROPPED BY `hasTranscript`. Its row exists
    // but `agentSentMessages` could not attribute it (no `taskId` on a threadless
    // post), so dropping it would delete the operator's only view of a post they
    // just authorized. It renders as the ordinary POSTED face instead.
    const wasHeld = lane === "sent" && framePending(entry);
    if (lane === "sent" && !held && !wasHeld && hasTranscript) return;
    const request = held ? (pendingByBody.get(echo) ?? null) : null;
    items.push({
      key: `f:${entry.at}:${i}`,
      lane,
      at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0,
      text,
      tool: entry.tool,
      ok: entry.ok,
      to: lane === "sent" ? (threadTitle ?? null) : undefined,
      // ⚠ Read like `framePending`: only an explicit `true` counts, and the field
      // rides through so every face can confess the cut (INVARIANTS §9).
      ...(entry.truncated === true ? { truncated: true } : {}),
      // ⚠ Same absent-means-ordinary discipline: the field rides through only when
      // main actually stamped one (F-376a).
      ...(lane === "directed" && typeof entry.senderAgentId === "string" && entry.senderAgentId
        ? { senderAgentId: entry.senderAgentId }
        : {}),
      ...(held
        ? { pending: true, requestId: request?.id ?? null, expired: isExpired(request, now) }
        : {}),
    });
  });

  for (const message of sent) {
    items.push({
      key: `m:${message.id}`,
      lane: "sent",
      at: epoch(message.createdAt),
      text: message.body,
      to: threadTitle ?? null,
      // ⚠ OFF THE STORED ROW, never off a frame — see `escalationPayload`.
      escalation: escalationStreamPayload(message),
    });
  }

  return dropSettledGateNotes(items, sawGateStamp)
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.at - b.item.at || a.i - b.i)
    .map(({ item }) => item);
}

/** What `main/session-narration.js › entryFor` emits for a gate it is waiting on.
 *  ⚠ A COPY OF WIRE COPY, matched exactly — a near-match here would silently stop
 *  dropping the line the day main rewords it, which fails in the safe direction
 *  (the note stays) rather than by hiding something. */
const GATE_NOTE = "Waiting for permission";

/**
 * DROP A GATE NOTE THE GATE HAS ALREADY OUTLIVED (2026-08-25).
 *
 * ⚠ THE RING IS APPEND-ONLY, WHICH IS WHY THIS IS THE READER'S JOB. Main writes
 * "Waiting for permission" when a gate opens and never revisits the entry, so the
 * line sat under a post that had long since been delivered — Samuel saw exactly
 * that, below a card the same wave had already fixed. **`session-narration.js`
 * now emits no note at all for an OUTBOUND post gate** (the card says Pending in
 * the operator's own words); this covers the rings that were already written,
 * and the older mains that keep writing them.
 *
 * ⚠ IT ONLY FIRES ON A RING THAT PROVES ITS OWN MAIN STAMPS `pending`. Without
 * that guard a build whose frames carry no gate flag would have every gate note
 * dropped — and on such a build the note is the ONLY thing that explains the
 * silence. So: this ring held a post at some point, and nothing is held now.
 */
function dropSettledGateNotes(
  items: StreamItem[],
  sawGateStamp: boolean
): StreamItem[] {
  if (!sawGateStamp) return items;
  if (items.some((item) => item.pending === true)) return items;
  return items.filter(
    (item) => !(item.lane === "note" && item.text === GATE_NOTE)
  );
}

/**
 * ONE RUN OF CONSECUTIVE TOOL ACTIVITY, AS ONE ROW (Samuel, 2026-08-27 — the
 * Claude-Code-desktop pattern).
 *
 * ⚠ IT IS A GROUPING, NOT A FILTER. Every frame that went in comes out inside a
 * group; nothing is dropped, and the detail the operator can open is the same
 * rows this stream rendered before. The stream's job is unchanged (a log that
 * loses lines is worse than a plain one) — what changes is that a dozen raw JSON
 * payloads no longer push the POST the operator opened the panel to read off the
 * screen.
 *
 * ⚠ THE BREAK IS ANY NON-TOOL LANE. A thinking line between two tool calls ends
 * the run, because the agent said something there and the summary must not
 * swallow it into "Used 4 tools".
 *
 * ⚠ THE COUNT IS TOOL USES, NOT ROWS. A call and its result are two frames about
 * ONE use (`LANE_BY_KIND` maps `tool` and `result` alike), so the number comes
 * from the frames that carry a tool NAME; a run of nameless frames falls back to
 * its row count rather than reporting zero.
 */
export interface StreamGroup {
  key: string;
  /** `null` for a single non-tool row; otherwise the run's tool-use count. */
  tools: number | null;
  items: StreamItem[];
}

export function groupStreamItems(items: readonly StreamItem[]): StreamGroup[] {
  const out: StreamGroup[] = [];
  for (const item of items) {
    if (item.lane !== "tool") {
      out.push({ key: item.key, tools: null, items: [item] });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.tools !== null) {
      last.items.push(item);
      last.tools = toolUses(last.items);
      continue;
    }
    out.push({ key: item.key, tools: toolUses([item]), items: [item] });
  }
  return out;
}

function toolUses(items: readonly StreamItem[]): number {
  const named = items.filter((item) => !!item.tool).length;
  return named || items.length;
}

/** `mcp__dopl__dopl_channel` → `dopl_channel`. ⚠ The segment after the LAST `__`,
 *  which is the rule `main/mcp-tool-names.js › mcpShortName` states: the server
 *  segment is the CLIENT's to choose and has never been ours to assume (F-139). */
export function shortToolName(name: string | undefined): string {
  if (!name) return "runs";
  return name.replace(/^mcp__.*__/i, "") || "runs";
}
