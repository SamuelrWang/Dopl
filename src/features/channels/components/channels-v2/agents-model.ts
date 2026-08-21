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

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpaBridge, type DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";
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
export function isAgentActive(state: DesktopSessionSummary["state"]): boolean {
  return state !== "ended";
}

/**
 * THE STABLE IDENTITY OF ONE AGENT, and the id the open-agent state holds.
 *
 * ⚠ NOT `sessionId`. That id is a React key and is re-minted by a park+resume or
 * a recreate, so keying the open panel on it would close the view under the
 * operator the moment their agent parked. `(channel, thread)` is the pair main
 * itself resolves on (`store.sessionKey`), which is exactly why the pause / end
 * ops take it too.
 */
export function agentKey(session: {
  channelId: string;
  taskId: string;
}): string {
  return `${session.channelId}:${session.taskId}`;
}

/**
 * The desktop's session feed, plus the one imperative way to re-read it.
 *
 * ⚠ `refresh` EXISTS FOR THE REFUSAL PATH AND NOTHING ELSE. The feed is a PUSH
 * and stays one: main dispatches, the projection moves, the push re-renders.
 * The single case a push cannot cover is a control main REFUSED — the operator
 * pressed Pause on an agent whose registry entry was already gone, so nothing
 * changed on that side and nothing will be pushed. Re-reading is how the panel
 * stops showing a live-looking agent that is not there. It is NOT a poll and
 * must not become one.
 */
export interface DesktopSessionsFeed {
  /** `null` = could not ask; `[]` = asked, nothing is running. Never collapse
   *  one into the other (INVARIANTS §11 — UNKNOWN is not EMPTY). */
  sessions: DesktopSessionSummary[] | null;
  refresh: () => void;
}

/**
 * Subscribe to the desktop's own session feed.
 *
 * `null` = no bridge, or a main without the feed. `[]` = a bridge with nothing
 * running. AFTER MOUNT, NEVER DURING RENDER: the bridge is a window global, so
 * reading it while rendering makes the server and the first client render
 * disagree — the subscription effect is the only place it is read.
 */
/** Re-probes for the preload global before settling on "could not ask". Five
 *  tries at 200ms is one second — long enough for a slow first paint, short
 *  enough that a plain browser reaches its honest `null` inside a blink. */
const BRIDGE_PROBE_LIMIT = 5;
const BRIDGE_PROBE_MS = 200;

export function useDesktopSessions(): DesktopSessionsFeed {
  const [summaries, setSummaries] = useState<DesktopSessionSummary[] | null>(null);
  const [probe, setProbe] = useState(0);
  // ONE mounted flag for the imperative re-read. The subscription below keeps
  // its own `live` local because it is scoped to a single effect run; a
  // refresh fired from a click has no effect to be scoped to, and an answer
  // that lands after unmount must not set state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    const sessions = getSpaBridge()?.sessions;
    if (typeof sessions?.summaries !== "function") return;
    void sessions
      .summaries()
      .then((r) => {
        if (mounted.current) setSummaries(r.sessions);
      })
      // A failed re-read leaves the last pushed frame standing. It is strictly
      // less wrong than replacing a real feed with "could not ask".
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sessions = getSpaBridge()?.sessions;
    // Both members are optional on the interface: an older main has `reopen` and
    // neither of these, and must degrade to "could not ask" rather than to a
    // broken call.
    const canRead = typeof sessions?.summaries === "function";
    const canListen = typeof sessions?.onSummaries === "function";
    // ⚠ A BOUNDED RE-PROBE, ADDED 2026-08-20 — the effect used to run ONCE on
    // `[]` deps, so a first mount that raced the preload's global left the feed
    // permanently `null` and the Agents tab permanently said "could not ask".
    // BOUNDED on purpose: `null` is the CORRECT terminal answer for a plain
    // browser and for a main without the feed (INVARIANTS §11 — UNKNOWN is not
    // EMPTY), so this must converge on it rather than poll for a bridge that is
    // never coming. It is not a data poll — it re-probes a window global and
    // stops.
    if (!canRead || !canListen) {
      if (probe >= BRIDGE_PROBE_LIMIT) return;
      const timer = setTimeout(() => setProbe((n) => n + 1), BRIDGE_PROBE_MS);
      return () => clearTimeout(timer);
    }

    let live = true;
    // READ ONCE, THEN LISTEN. The feed is a push, and a push-only surface leaves
    // a freshly opened channel blank until the next state change — which on a
    // quiet machine never comes.
    void sessions
      .summaries?.()
      .then((r) => {
        // The subscription below may already have delivered a NEWER frame while
        // this read was in flight; it must not be overwritten by the older one.
        if (live) setSummaries((prev) => prev ?? r.sessions);
      })
      .catch(() => {
        if (live) setSummaries((prev) => prev ?? []);
      });

    const off = sessions?.onSummaries?.((e) => {
      if (live) setSummaries(e.sessions);
    });
    return () => {
      live = false;
      off?.();
    };
  }, [probe]);

  return { sessions: summaries, refresh };
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
