"use client";

/**
 * THE AGENT VIEW'S CONTROL STRIP — Pause · End · Open window.
 *
 * ⚠ SPLIT OUT OF `agent-panel.tsx` ON 2026-08-22, when the 1:1 composer landed in
 * that panel and pushed it to 517 lines against the 500-line cap (INVARIANTS §1).
 * **The seam is the one `agents-controls.ts` was split on, not the line count
 * that forced the question**: this file is COMMANDS — it changes when the bridge
 * grows an op or an op grows a coordinate, which has happened four times in four
 * days — while what stays in `agent-panel.tsx` is the surface's LAYOUT and its
 * read-only lanes. Two rates of change in one file is how a panel gets
 * re-reviewed every time a button is added.
 *
 * ⚠ EVERYTHING HERE IS OWN-AGENTS-ONLY, structurally rather than by a check: the
 * ops resolve against main's OWN session registry, which holds nothing but this
 * operator's sessions on this machine (`agents-controls.ts` carries the rule, and
 * the `agentId` rule with it).
 *
 * ⚠ NEITHER STOP VERB TOUCHES A THREAD. `end` ends the AGENT; a thread has no
 * finished state on any surface (INVARIANTS §5).
 */

import { useEffect, useRef, useState } from "react";
import { PanelTop, Pause, Square } from "lucide-react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  canControlAgents,
  canOpenAgentWindow,
  openAgentWindow,
  type AgentControl,
  useAgentControls,
} from "./agents-controls";

/**
 * What a refused stop verb says. ⚠ Exported for the test: a swallowed refusal
 * and a successful stop are indistinguishable on screen, which is the whole
 * failure — the operator presses Pause, nothing visible happens, and they are
 * left to guess whether it worked.
 */
export const AGENT_CONTROL_REFUSED =
  "This agent already ended — nothing was changed.";

/**
 * ⚠ `AGENT_WINDOW_UNAVAILABLE` STOOD HERE AND IS DELETED (2026-08-20, F-212's
 * closure). It read "This agent runs without a window", which Samuel called
 * meaningless — correctly. **A window is a VIEW, not a runtime property.**
 * Whether main happened to mint a BrowserWindow for a spawn is an
 * implementation detail of the spawn shape; it is not a fact about the agent
 * and it is no answer to "show me what this thing is doing". The button opens
 * `components/channels-v2/agent-window.tsx` now, on every agent, so there is no
 * refusal left for it to word.
 *
 * The lesson worth keeping: an honest refusal is still only worth shipping when
 * the operator can DO something with it. "Main did nothing, and here is the
 * internal reason" is an improvement on silence and not a substitute for the
 * feature.
 */

/** How long a refusal notice stands before clearing itself. */
const REFUSAL_NOTICE_MS = 6000;

/**
 * PAUSE · END · OPEN WINDOW. All feature-detected: an older main has the feed
 * and not the controls, and must show no buttons rather than buttons that
 * silently do nothing.
 *
 * ⚠ TWO GATES, NOT ONE, BECAUSE THEY ARE TWO CAPABILITIES. `pause`/`end`
 * arrived with the SPA; `reopen` is the older op shared by both preloads. A
 * single `canControlAgents()` gate over the whole strip hid the open affordance
 * on every main that has `reopen` and neither stop verb — a real build shape,
 * and the affordance it hid is the one that still worked. `canOpenAgentWindow()`
 * now accepts EITHER open op for the same reason.
 *
 * ⚠ AN ENDED AGENT OFFERS NEITHER STOP VERB. Its registry entry is gone (the
 * pill outlives it by the retention rule), so main would answer `{ok:false}` —
 * disabled here is the honest face of that, not a guess.
 *
 * ⚠ AND THE RACE IS SAID OUT LOUD. `state === "ended"` is a frame old at best:
 * an agent that ends between the paint and the click leaves both buttons
 * enabled, main answers `{ok:false}`, and the boolean used to be DISCARDED —
 * the operator saw a pressed button and no consequence. The refusal now
 * renders, and the feed is re-read so the panel stops showing a live agent
 * that is not there.
 */
export function AgentControls({
  agent,
  workspaceSlug,
  onRefreshSessions,
}: {
  agent: DesktopSessionSummary;
  /** The workspace segment the agent window's route is built from. */
  workspaceSlug: string;
  /** Re-read the desktop's feed after a refusal — see `agents-model.ts ›
   *  DesktopSessionsFeed`. Absent in a tree that has no feed to refresh. */
  onRefreshSessions?: () => void;
}) {
  const control = useAgentControls();
  const [pending, setPending] = useState<AgentControl | null>(null);
  // ⚠ ONE notice slot for both refusal kinds, not two: they occupy the same
  // line under the same buttons, and two independent timers there race to blank
  // each other's message.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  const canControl = canControlAgents();
  const canOpen = canOpenAgentWindow();
  if (!canControl && !canOpen) return null;
  const stopped = agent.state === "ended";

  /** Show one refusal line, replacing any that is already standing. */
  const say = (message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), REFUSAL_NOTICE_MS);
  };

  const run = (which: AgentControl) => {
    setPending(which);
    setNotice(null);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    // The feed is the source of truth for what happened: main dispatches, the
    // projection moves, the push re-renders this panel. Nothing is stamped
    // optimistically — an agent that did not stop must not look stopped.
    void control(which, agent)
      .then((ok) => {
        if (ok) return;
        // ⚠ A REFUSAL IS NOT A PUSH. Main changed nothing, so nothing will
        // arrive to correct the panel; the re-read is what closes that gap.
        say(AGENT_CONTROL_REFUSED);
        onRefreshSessions?.();
      })
      .finally(() => setPending(null));
  };

  /**
   * "Open window" — the window showing this agent from the inside
   * (`agent-window.tsx`). It ALWAYS opens now; the only refusals left are the
   * ones every window-minting op has (a full budget, a blocking version floor,
   * an unusable id), and they share one shape by design so a caller cannot tell
   * them apart.
   *
   * ⚠ NO `onRefreshSessions` HERE, unlike the stop verbs. A refused open changed
   * nothing on main AND says nothing new about the session's state, so
   * re-reading the feed would answer a question nobody asked. The stop verbs
   * re-read because their refusal means "this agent is already gone", which is
   * something the panel IS showing wrongly.
   */
  const reveal = () => {
    void openAgentWindow(agent, workspaceSlug).then((res) => {
      if (!res.ok) say(AGENT_CONTROL_REFUSED);
    });
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-default px-3.5 py-2">
      <div className="flex items-center gap-2">
        {canControl && (
          <>
            <ControlButton
              icon={Pause}
              label="Pause"
              title="Stop the turn it is running. It stays yours and keeps its context."
              disabled={stopped || pending !== null}
              onClick={() => run("pause")}
            />
            <ControlButton
              icon={Square}
              label="End"
              title="End this agent. The thread is untouched."
              disabled={stopped || pending !== null}
              onClick={() => run("end")}
            />
          </>
        )}
        {canOpen && (
          <ControlButton
            icon={PanelTop}
            // ⚠ "Open agent" UNTIL 2026-08-25 (Samuel). It became "Open agent" on
            // 2026-08-20 (F-212) to stop a window reading as a runtime property
            // of the agent — but the panel it sits in IS the agent, so the verb
            // named the thing the operator was already looking at. What the
            // button opens is a WINDOW. ⚠ Two tests key on this string
            // (`agents-tab.test.tsx`, `agents-detail.test.tsx`); both updated.
            label="Open window"
            title="Watch what this agent is doing, and message it directly."
            onClick={reveal}
          />
        )}
      </div>
      {notice && (
        <p role="status" className="text-caption text-text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}

function ControlButton({
  icon: Icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: typeof Pause;
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      // ⚠ FULLY ROUNDED (Samuel, 2026-08-25) — `rounded-full`, not the `[8px]`
      // rectangle these wore. Size, padding and glyphs are untouched; only the
      // corner changed, so the strip keeps its measured geometry.
      className="btn-light flex items-center gap-1.5 rounded-full px-2 py-1 text-caption font-medium text-text-primary disabled:cursor-not-allowed disabled:text-text-disabled"
    >
      <Icon size={13} aria-hidden />
      {label}
    </button>
  );
}