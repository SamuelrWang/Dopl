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
 * The server stores none of it: `session-state-push.js › rowFor` picks the
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
 * ⚠ THE STONE-NAME POOL IS BEING DELETED, and the reason is not taste. `quartz`
 * / `flint` / `onyx` named ONE agent per channel, which is a promise multiplayer
 * cannot keep: every launch now mints a NEW instance and several of them sit on
 * one thread at once. Main mints a random 8-char id per instance instead, and
 * that id is the only thing an operator can say out loud to tell two of their
 * own agents apart.
 *
 * ⚠ READ OPTIONALLY, AND IT FALLS BACK TO `name`. A main older than the id emits
 * a handle and nothing else, and the card must then read exactly as it did
 * before this existed — a blank header is strictly worse than a legacy name
 * (INVARIANTS §11: render what IS known, never a blank standing in for it).
 * The field is read off the summary rather than declared on
 * `spa-bridge.ts › DesktopSessionSummary` because the bridge type is the
 * DESKTOP's to widen; this side must survive either shape.
 */
export function agentDisplayId(session: {
  agentId?: string | null;
  name?: string | null;
}): string {
  const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
  return id || session.name || "Agent";
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
 */
const AGENT_POST_STAMP_RE = /^agent-([a-z][a-z0-9]{7})-\d+$/;

/**
 * WHICH OF MY AGENTS WROTE THIS POST — the agent id off a `client_msg_id`, or
 * `null` when the row is not stamped by one instance.
 *
 * ⚠ `null` IS "CANNOT SAY", NEVER "SOME OTHER AGENT". Three real classes of
 * agent-authored row carry no per-instance stamp: a main older than the stamp,
 * an agent that supplied its own idempotency key, and every courtesy no-op
 * `main/channel-post.js › postCourtesy` sends about the MACHINE rather than
 * about one agent (`agent-<channelUUID>-<seq>` — the UUID form fails the
 * anchored pattern above, and that failure IS the discriminator). Both readers
 * fail toward the OLD behaviour on `null`: `agent-panel.tsx ›
 * agentSentMessages` keeps showing the row, and the transcript keeps the plain
 * "Agent" pill (INVARIANTS §11 — render what IS known, never a blank or a guess
 * standing in for it).
 */
export function parseAgentPostStamp(
  clientMsgId: string | null | undefined
): string | null {
  if (typeof clientMsgId !== "string") return null;
  return AGENT_POST_STAMP_RE.exec(clientMsgId)?.[1] ?? null;
}

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
 * ⚠ FOUR PREDICATES, ALL LOAD-BEARING. Own rows are excluded because the LOCAL
 * feed is the richer truth for mine (a peer row carries no metrics); `ended` is
 * excluded through the shared {@link isAgentActive} because the server row
 * outlives the run it describes; the thread narrowing matches the tab's own
 * scope; and the row must be FRESH. Dropping any one of them makes the badge
 * count rows the list does not draw.
 *
 * ⚠ THE FRESHNESS GUARD JOINED 2026-08-20 (Samuel), AND IT IS THE SAME ONE
 * `peer-activity.tsx › peerWorkingOn` ALREADY APPLIED. `channel_sessions` rows
 * outlive the process that wrote them (`main/session-state-push.js` says so in
 * its own header and names sign-out as the uncovered case), and there is no
 * server-side sweep — `session-state-service.ts › listChannelSessions` returns
 * every row for the channel. So a crashed desktop left a card reading `working`
 * forever, next to a peer-activity row that had correctly gone silent for the
 * SAME row: two surfaces, one fact, opposite answers. An indicator that believes
 * a dead machine is strictly worse than no indicator, because the reader waits
 * for a reply that is not coming.
 *
 * ⚠ IT FAILS TOWARD SILENCE, like every other read of this stamp. An absent or
 * unparseable `updatedAt` reads as STALE, never as fresh.
 * ⚠ THE WINDOW IS `PRESENCE_ONLINE_WINDOW_MS`, DELIBERATELY REUSED — a second
 * staleness number would let the roster call a member offline while their agent
 * card still says working (INVARIANTS §11).
 */
export function peerCardsFor(
  peers: readonly ChannelPeerSession[],
  currentUserId: string | null,
  openThreadId: string | null = null,
  now: number = Date.now(),
  windowMs: number = PRESENCE_ONLINE_WINDOW_MS
): ChannelPeerSession[] {
  return peers.filter((p) => {
    if (p.userId === currentUserId) return false;
    if (!isAgentActive(p.state)) return false;
    if (openThreadId && p.threadId !== openThreadId) return false;
    const ts = p.updatedAt ? new Date(p.updatedAt).getTime() : NaN;
    if (Number.isNaN(ts)) return false;
    return now - ts < windowMs;
  });
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

/** `84_000` → `"84k"`. Tokens are only ever glanced at here; the exact integer is
 *  noise at caption size, and above a million the thousands are too. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  return `${Math.round(value / 1000)}k`;
}

/**
 * A metric, or `null`. ⚠ The one place the wire's three absences collapse into
 * one: an older main omits the field, a model this build has no window for has
 * no denominator, and nothing is measured before the first turn reports usage.
 * All three mean "cannot say", and NONE of them means zero — a context meter
 * reading 0% of a window that is nearly full is a lie the operator acts on.
 */
export function metric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * ⚠ THE IMPERATIVE OPS MOVED TO `agents-controls.ts` (2026-08-20) — `canControlAgents`,
 * `useAgentControls`, `openAgentWindow`, `launchAgentOnThread`, `messageAgent`,
 * `setAgentMode` and their detectors. This file is the PROJECTION (the feed and the pure
 * slicing over it); that one is the COMMANDS. They change at different rates, which is the
 * §1 seam — the bridge grew four ops in three days while the wire shape moved twice.
 * ⚠ NOT re-exported here: a barrel would keep every consumer pointed at this file and make
 * the split invisible, which is how the last one got tangled (`permission-modes.ts`).
 */
