"use client";

/**
 * Channels v2 — MY RUNNING AGENTS, wired. The data behind the right panel's
 * Agents tab and the agent view it opens (wiring plan Phase 5, 2026-08-18).
 *
 * ⚠ THIS REPLACED `fixtures-agents.ts`, WHICH IS DELETED. Every number below is
 * measured by the desktop that is running the agent — nothing here is a
 * placeholder, and nothing here is fabricated when a fact is missing: an
 * unmeasured metric is `null` and the UI renders its ABSENCE (INVARIANTS §11 —
 * UNKNOWN is not EMPTY).
 *
 * THE SOURCE IS LOCAL RUNTIME STATE, NOT A TABLE (INVARIANTS §5).
 * `spa-bridge.ts › DesktopSessionSummary` over `sessions.summaries` /
 * `sessions.onSummaries`, projected by `dopl-desktop-app/main/session-summary.js`.
 * The server stores none of it: `session-state-push.js › reportRow` picks the
 * `channel_sessions` columns by name and takes no metric.
 *
 * ⚠ IT IS AN OPERATOR SURFACE, NOT A ROSTER, and that is structural rather than
 * filtered: the feed is one machine's own registry, so another member's agent
 * cannot appear here however the list is sliced. Their presence lives in the
 * Info tab's Members list.
 *
 * ⚠ DESKTOP-ONLY, AND SILENT-BUT-NOT-BLANK WITHOUT IT. `null` from
 * {@link useDesktopSessions} means "could not ask" — a plain browser, or a
 * desktop older than the feed — and is a DIFFERENT fact from `[]`, which means
 * "asked, nothing is running". The tab says which; it does not render one as the
 * other. Detection is CAPABILITY-KEYED (`typeof … === "function"`), never a
 * shell name or a truthy `window.dopl`.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";
import { normalizeAgentModel } from "../../lib/agent-models";
import { metric } from "./agent-metrics";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";

/**
 * IS THIS AGENT STILL RUNNING — the ONE ended-state rule, shared by the own list
 * and the peer list (Samuel, 2026-08-20).
 *
 * ⚠ IT EXISTS BECAUSE THE TWO LISTS USED TO DISAGREE. `peerCardsFor` dropped
 * `ended` and `ownAgentsFor` did not, so the Agents tab's badge — which sums both
 * — counted MY stopped agents and not my teammates'. One number over two rules is
 * the F-142 defect in miniature, and a badge is exactly where it goes unnoticed.
 *
 * ⚠ THE LIST AND THE BADGE ANSWER DIFFERENT QUESTIONS, DELIBERATELY. The badge
 * counts what is ACTIVE; the own LIST still renders an ended agent as a stopped
 * card, because "my agent just finished" is something the operator opened the tab
 * to see. A peer's ended row is not shown either way — the server row outlives the
 * run it describes, so it is not evidence of anything.
 */
function isAgentActive(state: DesktopSessionSummary["state"]): boolean {
  return state !== "ended";
}

/**
 * THE AGENT'S OWN ID — what every surface in this family SHOWS where a stone
 * handle used to be (Samuel, 2026-08-21, multiplayer agents).
 *
 * ⚠ THE STONE-NAME POOL IS DELETED, and the reason is not taste. `quartz` / `flint` / `onyx`
 * named ONE agent per channel — a promise multiplayer cannot keep, since every launch mints a NEW
 * instance and several sit on one thread. Main mints a random 8-char id per instance instead, and
 * that id is the only thing an operator can say out loud to tell two of their own agents apart.
 *
 * ⚠ READ OPTIONALLY, AND IT FALLS BACK TO `name`. A main older than the id emits a handle and
 * nothing else, and the card must read exactly as it did before this existed — a blank header is
 * strictly worse than a legacy name (INVARIANTS §11). It is read off the summary rather than
 * declared on `spa-bridge.ts › DesktopSessionSummary`, which is the DESKTOP's to widen.
 */
export function agentDisplayId(session: {
  agentId?: string | null;
  name?: string | null;
}): string {
  const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
  return id || session.name || "Agent";
}

/**
 * THE SAME AGENT, SAID IN FULL: `#<id>` (Samuel, 2026-08-31; it was `Agent #<id>` from
 * 2026-08-24) — what the transcript pill renders (`attribution-pill.tsx › attributionName`),
 * so one agent reads the same in both.
 * ⚠ THE WORD "agent" LEFT THE NAME AND MOVED INTO CHROME (Samuel's ruling): agent-ness is
 * stated by a grey borderless chip beside the name (`attribution-pill.tsx › AgentChip`), so
 * the NAME is just the id — or whatever the operator renamed it to. A name that carries the
 * word "agent" next to a chip that says "agent" says it twice.
 * ⚠ The `#` is LITERAL and belongs to the id, not a separator; one text node.
 * ⚠ A LEGACY `name` IS NOT AN ID and gets no prefix: `#flint` asserts a shape no main minted.
 * ⚠ PRECEDENCE, 2026-08-25 (unchanged): operator's OWN name, then `#<id>`, then the legacy
 * handle — where both are reported the ID wins, since a pool handle was re-issued after its
 * session left.
 */
export function agentDisplayName(session: {
  agentId?: string | null;
  name?: string | null;
  displayName?: string | null;
}): string {
  const own = typeof session.displayName === "string" ? session.displayName.trim() : "";
  if (own) return own;
  const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
  return id ? `#${id}` : agentDisplayId(session);
}

/**
 * THE PER-INSTANCE POST STAMP, as `dopl-desktop-app/main/session-outbound-tag.js
 * › nextOwnPostId` mints it: `agent-<agentId>-<n>`. Anchored at BOTH ends and
 * carrying the agent-id charset (`main/agent-id.js › AGENT_ID_RE`) on purpose —
 * "starts with something id-shaped" is not good enough here, because the OTHER
 * `agent-…` producer on that machine is `main/channel-post.js › postResult`,
 * whose id is `agent-<channelId>-<seq>` and whose channel UUID can begin with
 * eight id-shaped characters. That form carries four more `-` groups, so an
 * exact match rules it out and a `startsWith` would not.
 *
 * ⚠ ONE DECLARATION, AND IT LIVES HERE (2026-08-22). It stood in
 * `agent-panel.tsx` as long as `agentSentMessages` was its only reader; the
 * transcript's per-agent attribution pill is the second, and a second charset
 * written out by hand is how the two come to disagree about what an agent id is.
 * The review wave already caught one such duplicate attempt — do not re-declare
 * this pattern anywhere, import {@link parseAgentPostStamp}.
 *
 * ⚠ **IT MOVED TO `lib/agent-post-stamp.ts` ON 2026-08-31 AND IS RE-EXPORTED
 * HERE, SO NO IMPORT CHANGED** — `lib/mentions-mask.ts`'s split, for the same
 * kind of reason. A SERVER reader arrived (`server/service-writes-metadata-
 * escalation.ts`, deriving the asking agent off the escalation it answers) and
 * this module is `"use client"`. **One declaration is still the rule; this file
 * is no longer where it lives.**
 */
export { parseAgentPostStamp } from "../../lib/agent-post-stamp";

/**
 * THE STABLE IDENTITY OF ONE AGENT, and the id the open-agent state holds.
 *
 * ⚠ NOT `sessionId`. That id is a React key and is re-minted by a park+resume or
 * a recreate, so keying the open panel on it would close the view under the
 * operator the moment their agent parked.
 *
 * ⚠ `(channel, thread)` STOPPED BEING UNIQUE ON 2026-08-21 (multiplayer agents).
 * Main used to keep one session per pair, so the pair WAS the agent; a launch
 * now spawns a new instance every click and N of them share a thread. The pair
 * therefore keys a THREAD, not an agent — leaving it here made every card on a
 * shared thread render under one React key, marked every one of them "Viewing"
 * at once, and pointed the agent view at whichever happened to be first.
 *
 * ⚠ THE PAIR IS STILL THE ADDRESS THE BRIDGE OPS TAKE, and that is deliberate:
 * `pause` / `end` / `openAgentWindow` resolve `(channelId, taskId)` against
 * main's own registry (`agents-controls.ts`), and they read it off the SESSION
 * OBJECT, never by parsing this string. Nothing anywhere splits this value —
 * it is compared and used as a React key and nothing else — which is what makes
 * changing its shape safe.
 *
 * ⚠ FALLS BACK TO THE OLD PAIR when the summary carries no id, so a main that
 * predates the id keys exactly as it always did.
 */
export function agentKey(session: {
  channelId: string;
  taskId: string;
  agentId?: string | null;
}): string {
  const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
  return id || `${session.channelId}:${session.taskId}`;
}

/**
 * MY agents in ONE channel, grouped so agents sharing a thread sit together — a
 * card between them hides the very thing this tab has to show. Group order
 * follows first appearance and `sort` is stable, so within a thread the feed's
 * own order survives.
 *
 * Pure and exported: main pushes every session on the machine (the list is
 * bounded by the desktop's window budget, so there is nothing to page and no
 * per-channel watch handshake to get out of step) and each consumer takes its
 * own slice.
 */
export function agentsForChannel(
  sessions: readonly DesktopSessionSummary[],
  channelId: string
): DesktopSessionSummary[] {
  const mine = sessions.filter((s) => s.channelId === channelId);
  const order = [...new Set(mine.map((s) => s.taskId))];
  return [...mine].sort(
    (a, b) => order.indexOf(a.taskId) - order.indexOf(b.taskId)
  );
}

/**
 * MY agents on the surface as it is currently scoped: `agentsForChannel`, then
 * the thread narrowing the tab applies in thread view.
 *
 * ⚠ IT EXISTS SO THE TAB'S LIST AND THE TAB'S BADGE CANNOT DISAGREE (2026-08-20).
 * The Agents tab wrote this narrowing inline and the tab-row count would have
 * had to write it a second time — which is F-142's defect exactly ("the web chip
 * shows Idle while the desktop works": two readers, two derivations, one of them
 * wrong). A badge that says 3 over a list of 2 is the same class of lie, and the
 * only structural fix is that both callers run the same function.
 */
export function ownAgentsFor(
  sessions: readonly DesktopSessionSummary[],
  channelId: string,
  openThreadId: string | null = null
): DesktopSessionSummary[] {
  const inChannel = agentsForChannel(sessions, channelId);
  return openThreadId
    ? inChannel.filter((a) => a.taskId === openThreadId)
    : inChannel;
}

/**
 * OTHER members' agents on the same surface — the peer cards, and the peer half
 * of the tab's badge. Same one-derivation argument as {@link ownAgentsFor}.
 *
 * ⚠ THREE PREDICATES, AND THE ROW'S PRESENCE IS THE FOURTH FACT — not a filter.
 * Own rows go because the LOCAL feed is the richer truth for mine (a peer row
 * carries no metrics); `ended` goes through the shared {@link isAgentActive},
 * which a legacy desktop could still report; the thread narrowing matches the
 * tab's scope. **LIVENESS IS MEMBERSHIP:** the push is a FULL-SET REPLACE keyed
 * on `(user, workspace)`, so an ended session is deleted by OMISSION and
 * `session-state-push.js › liveForWire` keeps it off the wire to begin with
 * (INVARIANTS §11). A row in the fetch is a session that has not gone away.
 * ⚠ THE WALL-CLOCK FRESHNESS GUARD IS DELETED (Samuel, 2026-08-22): *"the card
 * STAYS until the session actually goes away."* It stood from 2026-08-20 and it
 * read `updated_at` as a HEARTBEAT, which that column has never been. The push
 * fires on state change only — `session-state-push.js` says so in its own header
 * and forbids a timer — and the reconcile is narrower still:
 * `server/repository-sessions.ts › sessionRowMatches` compares field by field
 * and does NOT touch `updated_at` for a row whose projection did not move, so
 * the read's ordering survives a busy machine. An idle peer agent — alive,
 * listening, about to answer — therefore aged past `PRESENCE_ONLINE_WINDOW_MS`
 * and its card VANISHED mid-run. A liveness rule built on a stamp that is not a
 * heartbeat cannot be tuned; it has to go.
 * ⚠ WHAT THE GUARD REALLY BOUGHT IS KEPT, AS INK RATHER THAN ABSENCE. Rows do
 * outlive a crashed or signed-out desktop (`session-state-push.js`'s own KNOWN
 * GAP), so {@link peerRowStale} answers "this row has not moved in a while" and
 * `agents-tab.tsx` DIMS such a card. A quiet card beats a vanished one: the
 * disappearance is unattributable.
 * ⚠ IT NOW DIVERGES FROM `peer-activity.tsx › peerWorkingOn`, deliberately: that
 * row makes a PRESENT-TENSE claim a reader waits on ("Diana's agent is working…")
 * so it fails toward silence and keeps the window. This answers "does this agent
 * exist", which age does not settle.
 */
export function peerCardsFor(
  peers: readonly ChannelPeerSession[],
  currentUserId: string | null,
  openThreadId: string | null = null
): ChannelPeerSession[] {
  return peers.filter((p) => {
    if (p.userId === currentUserId) return false;
    if (!isAgentActive(p.state)) return false;
    if (openThreadId && p.threadId !== openThreadId) return false;
    return true;
  });
}

/**
 * HAS THIS PEER ROW GONE QUIET — the staleness TREATMENT, never a filter
 * (Samuel, 2026-08-22).
 * ⚠ IT DECIDES INK, NOT MEMBERSHIP, and that separation is the whole ruling. The
 * row still renders; it renders DIMMER. {@link peerCardsFor} decides whether
 * there is a card at all, and no timestamp may reach it.
 * ⚠ IT IS NOT A HEARTBEAT READ AND DOES NOT PRETEND TO BE. `updated_at` moves on
 * a projection CHANGE, so a long-lived idle agent is stale by this measure and
 * perfectly alive — which is why the answer is a shade, not a disappearance.
 * ⚠ ABSENT OR UNPARSEABLE READS AS STALE, the direction every read of this stamp
 * fails in. ⚠ THE WINDOW IS `PRESENCE_ONLINE_WINDOW_MS`, DELIBERATELY REUSED — a
 * second staleness number would let the roster call a member offline while their
 * agent card still reads at full strength.
 */
export function peerRowStale(
  peer: Pick<ChannelPeerSession, "updatedAt">,
  now: number = Date.now(),
  windowMs: number = PRESENCE_ONLINE_WINDOW_MS
): boolean {
  const ts = peer.updatedAt ? new Date(peer.updatedAt).getTime() : NaN;
  if (Number.isNaN(ts)) return true;
  return now - ts >= windowMs;
}

/**
 * THE TAB BADGE'S NUMBER — active agents on the surface as it is scoped, own and
 * peer under the ONE rule (Samuel, 2026-08-20).
 *
 * ⚠ IT IS EXPORTED SO THE BADGE AND THE LISTS CANNOT DRIFT, which is the same
 * argument {@link ownAgentsFor} was extracted on. `info-panel.tsx` had summed the
 * two list lengths inline, which is what let the ended-state asymmetry through.
 */
export function activeAgentCount(
  sessions: readonly DesktopSessionSummary[],
  peers: readonly ChannelPeerSession[],
  channelId: string,
  currentUserId: string | null,
  openThreadId: string | null = null
): number {
  const mine = ownAgentsFor(sessions, channelId, openThreadId).filter((a) =>
    isAgentActive(a.state)
  );
  return mine.length + peerCardsFor(peers, currentUserId, openThreadId).length;
}

/**
 * How many of MY agents share each thread, keyed by `taskId`. Two on one thread
 * is the case the cards have to make obvious, and a count is the cheapest way to
 * say it without the reader comparing two `↳` lines.
 */
export function agentsPerThread(
  sessions: readonly DesktopSessionSummary[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) out.set(s.taskId, (out.get(s.taskId) ?? 0) + 1);
  return out;
}

/**
 * WHAT THIS AGENT IS DOING, IN WORDS — the ONE place the desktop's `detail` key
 * becomes copy (2026-08-20).
 *
 * ⚠ THE KEY IS DERIVED ON THE DESKTOP, THE SENTENCE IS WRITTEN HERE, and the
 * split is deliberate. `main/session-detail.js` owns "which of six situations is
 * this", because that is a fact about the engine and there must be exactly one
 * answer to it (the ONE MODULE, ONE DERIVATION rule `session-summary.js` is built
 * on). What a human reads is a product decision that belongs in the tree with the
 * design tokens — and shipping the sentence over IPC would mean a copy change
 * needing a desktop release.
 *
 * ⚠ AN UNKNOWN KEY RENDERS NOTHING, NOT THE RAW KEY. A newer main can emit a
 * seventh value; "awaiting_handoff" appearing verbatim on a card is worse than
 * falling back to the pill's own word, which is always true.
 * ⚠ ABSENT IS ALSO NOTHING — an older main omits the field entirely, and the
 * cards then read exactly as they did before this existed.
 */
export function agentDetailLabel(session: {
  detail?: DesktopSessionSummary["detail"];
  toolLabel?: string | null;
}): string | null {
  switch (session.detail) {
    case "thinking":
      return "Thinking…";
    case "tool":
      // ⚠ The unnamed case is a REAL one, not a defensive stub: `toolLabel` is
      // null whenever the tool name could not be shortened to anything. "Running
      // a command" is true either way, which is why it is the fallback rather
      // than a blank or the word "tool".
      return session.toolLabel
        ? `Running ${session.toolLabel}`
        : "Running a command";
    case "posting":
      return "Sending a message";
    case "permission":
      // The one detail that is about the OPERATOR rather than the agent: it is
      // blocked on a click, and the card is where they find out.
      return "Waiting on you";
    case "awaiting_peer":
      return "Waiting for a reply";
    case "awaiting_inbound":
      return "Message waiting";
    default:
      return null;
  }
}

/**
 * WHEN THIS AGENT ENDED, or `null`.
 *
 * ⚠ ADDITIVE AND OPTIONAL, read off a widened local type rather than declared on
 * `spa-bridge.ts › DesktopSessionSummary` — the same rule {@link agentDisplayId}
 * follows, and for the same reason: the bridge type is the DESKTOP's to widen and
 * this side must survive either version of it.
 *
 * ⚠ ABSENT IS "CANNOT SAY", NOT "STILL RUNNING". An older main omits it, and so
 * does any agent that ended before the field shipped. The thing that states an
 * agent is over is `state === "ended"`, never this — a surface that gated the
 * Ended marker on a timestamp would show every legacy ended agent as live.
 */
export function agentEndedAt(
  session: DesktopSessionSummary & { endedAt?: number | null }
): number | null {
  return metric(session.endedAt);
}

/**
 * WHICH MODEL THIS AGENT IS ACTUALLY RUNNING ON, or `null` (2026-08-22).
 *
 * ⚠ ADDITIVE AND OPTIONAL, read off a widened LOCAL type rather than declared on
 * `spa-bridge.ts › DesktopSessionSummary` — the same rule {@link agentDisplayId}
 * and {@link agentEndedAt} follow, and for the same reason: the bridge type is the
 * DESKTOP's to widen, main and this tree ship separately, and this side must
 * compile and behave against either version of it.
 *
 * ⚠ ABSENT IS "THIS BUILD CANNOT SAY", NOT "THE DEFAULT". Every surface that
 * shows it renders the ABSENCE — no chip at all — rather than the word "Default",
 * because a card states what an agent IS RUNNING and a build that does not report
 * a model has said nothing about that (INVARIANTS §11 — UNKNOWN is not EMPTY).
 * The Settings tab's durable row is the opposite case: there the operator is
 * PICKING, and "Default" is one of the picks.
 *
 * ⚠ IT IS THE EFFECTIVE MODEL, NOT THE CHANNEL'S STORED PICK. A live agent may
 * have been switched mid-run (`agent-posture.tsx`), or have been spawned before
 * the channel's posture changed, so the card must read the SESSION rather than
 * the record — which is exactly the F-142 defect ("the web chip shows Idle while
 * the desktop works") restated for a different field.
 */
export function agentRunningModel(
  session: DesktopSessionSummary & { model?: string | null }
): string | null {
  return normalizeAgentModel(session.model);
}

/** WHERE AN AGENT IS ON NO THREAD (Samuel, 2026-08-27). ⚠ It read "no thread title" — a MISSING
 *  FIELD, where the truth is a PLACE: a channel-level agent is on the ROOM on purpose
 *  (`agents-controls.ts`: `taskId: null`). ⚠ ONE STATEMENT; THREE callers each spelled it out — the third (`agents-tab-cards.tsx › AgentCard`) was missed by the 2026-08-27 wave and converted 2026-08-28, so the card and the panel it opens no longer disagree. */
export const NO_THREAD_LABEL = "main channel";

export type AgentLivenessTone = "working" | "waiting" | "idle" | "ended";

export interface AgentLivenessState {
  tone: AgentLivenessTone;
  label: string;
}

/**
 * WHAT AN AGENT IS DOING, AS THE ONE WORD EVERY SURFACE SHOWS — the liveness
 * mapping (Samuel, 2026-08-22).
 *
 * ⚠ THIS BLOCK SAT ABOVE `agentEndedAt` UNTIL 2026-08-22 (F-256), stranded there
 * by a concurrent edit and describing a function two declarations away, while the
 * function it belongs to had no doc at all. Pure relocation — not one word of it
 * changed.
 *
 * ⚠ FOUR STATES, AND THE SPLIT THAT MATTERS IS INSIDE `idle`. The wire has three
 * values (`working` / `idle` / `ended`), which lumped two very different
 * situations under one word: an agent that is ALIVE between turns and will answer
 * the moment something arrives, and one that is parked and has to be woken. Both
 * read "Idle", so an operator watching a live agent wait for a counterparty saw
 * the same label as one that was not running at all. The desktop now reports
 * which (`listening`), and this is where that becomes copy.
 *
 * | state     | listening    | label               | tone    |
 * |-----------|--------------|---------------------|---------|
 * | `working` | —            | `detail` ?? Running | working |
 * | `idle`    | `true`       | Waiting             | waiting |
 * | `idle`    | false/absent | Idle                | idle    |
 * | `ended`   | —            | Ended               | ended   |
 *
 * ⚠ `listening` IS READ OPTIONALLY AND ITS ABSENCE CHANGES NOTHING. An older main
 * omits it, and every one of its idle agents then reads "Idle" — exactly the
 * labels that build already produced. Absent is NOT "not listening" as a claim;
 * it is "this machine cannot say", and the quieter of the two words is the honest
 * rendering of that (INVARIANTS §11). It is read off a widened local type rather
 * than declared on `spa-bridge.ts › DesktopSessionSummary`, which is the DESKTOP's
 * to widen — the same rule `agentDisplayId` follows.
 *
 * ⚠ `working` KEEPS THE WORD "Running" rather than becoming "Working". The pill's
 * vocabulary is what the operator has been reading since this surface shipped, the
 * state's MEANING did not change, and `detail` refines it in most live cases
 * anyway. Renaming it would be churn bought with nothing.
 *
 * ⚠ THE DETAIL ONLY EVER REFINES `working`, enforced here rather than trusted from
 * a caller: a card reading "Idle" and "Thinking…" at once is the
 * two-readers-one-fact defect in miniature.
 *
 * ⚠ IT IS THE ONE MAPPING. Every surface that shows liveness runs this — the
 * Agents tab's cards, the panel and window headers, the thread Info tab's rows —
 * so a fifth state or a re-word lands everywhere at once instead of in four files
 * that drift.
 */
export function agentLiveness(session: {
  state: "working" | "idle" | "ended";
  /** ⚠ ADDITIVE AND OPTIONAL — an older main omits it. */
  listening?: boolean | null;
  detail?: DesktopSessionSummary["detail"];
  toolLabel?: string | null;
}): AgentLivenessState {
  if (session.state === "ended") return { tone: "ended", label: "Ended" };
  if (session.state === "working") {
    return { tone: "working", label: agentDetailLabel(session) ?? "Running" };
  }
  return session.listening === true
    ? { tone: "waiting", label: "Waiting" }
    : { tone: "idle", label: "Idle" };
}

/**
 * ⚠ THE IMPERATIVE OPS MOVED TO `agents-controls.ts` (2026-08-20) — `canControlAgents`,
 * `useAgentControls`, `openAgentWindow`, `launchAgentOnThread`, `messageAgent`,
 * `setAgentMode` and their detectors. This file is the PROJECTION (the feed and the pure
 * slicing over it); that one is the COMMANDS. They change at different rates, which is the
 * §1 seam — the bridge grew four ops in three days while the wire shape moved twice.
 * ⚠ NOT re-exported here: a barrel would keep every consumer pointed at this file and make
 * the split invisible, which is how the last one got tangled (`permission-modes.ts`).
 * ⚠ AND `formatTokens` / `metric` MOVED TO `agent-metrics.ts` (2026-08-22), on the same rule
 * and with the same no-barrel clause: this file is WHICH AGENTS EXIST, that one is HOW A
 * MEASUREMENT (or its absence) READS.
 */
