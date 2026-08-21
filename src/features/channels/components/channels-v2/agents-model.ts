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
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";

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
 * ⚠ THREE PREDICATES, ALL LOAD-BEARING. Own rows are excluded because the LOCAL
 * feed is the richer truth for mine (a peer row carries no metrics); `ended` is
 * excluded because the server row outlives the run it describes; and the thread
 * narrowing matches the tab's own scope. Dropping any one of them makes the
 * badge count rows the list does not draw.
 */
export function peerCardsFor(
  peers: readonly ChannelPeerSession[],
  currentUserId: string | null,
  openThreadId: string | null = null
): ChannelPeerSession[] {
  return peers.filter(
    (p) =>
      p.userId !== currentUserId &&
      p.state !== "ended" &&
      (!openThreadId || p.threadId === openThreadId)
  );
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

/** Whether the pause / end controls can be offered at all. Feature-detected like
 *  every other bridge capability: an older main has the feed and not the
 *  controls, and must show no buttons rather than buttons that do nothing.
 *
 *  ⚠ THIS GATES THE STOP VERBS AND NOTHING ELSE. It used to gate the whole
 *  control strip, which hid "Open window" on every main that had `reopen` and
 *  not `pause`/`end` — a real build shape, since `reopen` is the OLD op shared
 *  by both preloads and the other two arrived with the SPA. Three independent
 *  capabilities, three detections; see {@link canOpenAgentWindow}. */
export function canControlAgents(): boolean {
  const sessions = getSpaBridge()?.sessions;
  return (
    typeof sessions?.pause === "function" && typeof sessions?.end === "function"
  );
}

/**
 * Whether this agent's own window can be revealed — a SEPARATE question from
 * {@link canControlAgents}, and the older capability of the two.
 *
 * ⚠ EITHER OP COUNTS (2026-08-20). `openAgentWindow` is the one that answers the
 * click properly; `reopen` is the OLDER op, which now hands a live windowless
 * session to the very same window in main. A build with only `reopen` still
 * opens the agent view, so gating the button on the new op alone would hide a
 * working affordance — the exact mistake this function's docblock already
 * records having made once with `pause`/`end`.
 *
 * ⚠ Both are detected at the CALL SITE rather than trusted from the type: a main
 * predating either ships a `sessions` object without it, and the type cannot
 * know (INVARIANTS §11).
 */
export function canOpenAgentWindow(): boolean {
  const sessions = getSpaBridge()?.sessions;
  return (
    typeof sessions?.openAgentWindow === "function" ||
    typeof sessions?.reopen === "function"
  );
}

/**
 * Whether this build can reach an agent directly at all.
 *
 * ⚠ IT DETECTS THE BRIDGE OP, NOT {@link messageAgent}. The wrapper is always a
 * function — it is an export of this module — so `typeof messageAgent` answers
 * `true` in a plain browser and renders a composer that can only ever refuse.
 * That is the exact failure the panel's no-inert-input rule exists to prevent,
 * and it shipped in the first draft of the agent window before its own test
 * caught it. Detect the capability you are about to USE (INVARIANTS §11).
 */
export function canMessageAgent(): boolean {
  return typeof getSpaBridge()?.sessions?.message === "function";
}

/**
 * TALK TO MY OWN AGENT, out of band — F-212's direct 1:1 lane.
 *
 * ⚠ THE ONE BRIDGE CALL IN THIS MODULE THAT STARTS A TURN. Everything else here
 * reads, stops, or opens a window. Main owns the whole security shape
 * (`main/session-reopen.js › messageByTask` states it in full): the session is
 * resolved by (channel, thread) against main's OWN registry, so this is
 * own-agents-only structurally; the text is delimited with that session's nonce
 * and carries operator authority rather than being fenced as counterparty data;
 * and it dispatches the SAME `steer` the session window's composer always did.
 *
 * ⚠ THE VERDICT IS RETURNED, NEVER SWALLOWED. A message the operator believes
 * they sent and the agent never received is the worst outcome this lane has.
 */
export async function messageAgent(payload: {
  channelId: string;
  taskId: string;
  text: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.message !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.message(payload.channelId, payload.taskId, payload.text);
  return { ok: res?.ok === true, reason: res?.reason };
}

/** Whether this build can LAUNCH an agent onto a thread (2026-08-20). */
export function canLaunchAgents(): boolean {
  return typeof getSpaBridge()?.sessions?.launch === "function";
}

/**
 * ATTACH MY OWN AGENT TO A THREAD — the Agents tab's launch button (Samuel,
 * 2026-08-20). Windowless requester-side session; the click IS the consent (own
 * agent, own thread — no row is raised) and MAIN owns the posture (inbound
 * auto-consumed; out per the channel's auto-send setting).
 */
export async function launchAgentOnThread(payload: {
  channelId: string;
  taskId: string;
  workspaceId: string;
  channelName: string;
  threadTitle: string | null;
  counterpartyId: string | null;
  direct: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.launch !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.launch(payload);
  return { ok: res?.ok === true, reason: res?.reason };
}

export type AgentControl = "pause" | "end";

/**
 * PAUSE / END MY OWN AGENT.
 *
 * ⚠ OWN AGENTS ONLY, and there is no other kind reachable from here: the ops
 * resolve `(channelId, taskId)` against MAIN'S OWN session registry, which holds
 * nothing but this operator's sessions on this machine. Nobody pauses another
 * member's agent (Samuel's ruling, INVARIANTS §11) — a peer's paused agent reads as
 * inactive/offline PRESENCE on their side, never as a stalled thread.
 *
 * ⚠ NEITHER OP TOUCHES A THREAD. `end` ends the AGENT; a thread has no finished
 * state on any surface (INVARIANTS §5).
 */
export function useAgentControls() {
  return useCallback(
    async (
      control: AgentControl,
      session: { channelId: string; taskId: string }
    ): Promise<boolean> => {
      const sessions = getSpaBridge()?.sessions;
      const op = control === "pause" ? sessions?.pause : sessions?.end;
      if (typeof op !== "function") return false;
      const result = await op(session.channelId, session.taskId);
      return result?.ok === true;
    },
    []
  );
}

/**
 * OPEN THE AGENT VIEW — a real window showing what this agent is doing, what it
 * has sent, and a composer that reaches it (`components/channels-v2/agent-window.tsx`).
 *
 * ⚠ IT ALWAYS OPENS SOMETHING NOW (2026-08-20, F-212's closure), and the short
 * history of this function is why that sentence is worth writing down. It began
 * as `reopen`, which revealed the session's own BrowserWindow. The
 * session-window retirement made every responder and every Agents-tab launch
 * WINDOWLESS, so there stopped being a window to reveal — and for a while this
 * returned `{ ok: false, reason: "windowless" }`, which the panel worded as
 * "this agent runs without a window". Samuel called that meaningless, and he was
 * right: **a window is a VIEW, not a runtime property.** Whether main minted a
 * BrowserWindow for a spawn is an implementation detail of the spawn shape, and
 * no answer at all to "show me my agent". So the view exists, and the click
 * opens it.
 *
 * ⚠ TWO OPS, ONE MEANING, NEWEST FIRST. `openAgentWindow` says exactly what the
 * caller wants; `reopen` is the older op and now hands a live windowless session
 * to the SAME window in main, so a build with only `reopen` behaves identically.
 * The fallback is not compatibility theatre — it is the reason the button works
 * on a main that predates the new op.
 *
 * ⚠ `segment` is needed because the window lands on a ROUTER PATH and main holds
 * the workspace UUID, not the slug. Main re-checks it (`isSafeSegment`) and
 * degrades rather than refusing when it is absent.
 */
export async function openAgentWindow(
  session: { channelId: string; taskId: string },
  segment: string
): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.openAgentWindow === "function") {
    const res = await sessions.openAgentWindow(segment, session.channelId, session.taskId);
    return { ok: res?.ok === true, reason: res?.reason };
  }
  // ⚠ The optional chain covered `sessions` and not `reopen`, so on a main
  // without either op this threw "reopen is not a function" out of a click
  // handler. Same detection as the gate that hides the button, so the two
  // cannot disagree.
  if (typeof sessions?.reopen !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.reopen(session.channelId, session.taskId, segment);
  return { ok: res?.ok === true, reason: res?.reason };
}
