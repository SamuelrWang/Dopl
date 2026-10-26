"use client";

/**
 * THE AGENT VIEW'S CONTROL STRIP — Pause · End · Open window.
 *
 * This file is COMMANDS — it changes when the bridge grows an op or an op grows a
 * coordinate — while `agent-panel.tsx` is the surface's LAYOUT and its read-only
 * lanes.
 *
 * ⚠ EVERYTHING HERE IS OWN-AGENTS-ONLY, structurally rather than by a check: the
 * ops resolve against main's OWN session registry, which holds nothing but this
 * operator's sessions on this machine (`agents-controls.ts` carries the rule, and
 * the `agentId` rule with it).
 *
 * ⚠ NEITHER STOP VERB TOUCHES A THREAD. `end` ends the AGENT; a thread has no
 * finished state on any surface (INVARIANTS §5).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelTop, Pause, Square } from "lucide-react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";
import { interruptRefusal } from "../lib/runtime-capability";
import { agentHeldGates } from "./agents-held-gates";
import { canAnswerPermission } from "./agents-gate-controls";
import {
  canControlAgents,
  canOpenAgentWindow,
  openAgentWindow,
  type AgentControl,
  useAgentControls,
} from "./agents-controls";
// ⚠ THE HELD-GATE CARDS RENDER IN THIS BOX (2026-09-17, Samuel's inline-approval ruling):
// Approve / Deny is a CONTROL, and it belongs beside Pause / End / Open window rather than in
// the stream, which is a RECORD of what the agent did. Both channel surfaces mount
// `ChannelsAgentPanel`, which mounts this strip.
import { AgentHeldGates } from "./agent-held-gate";

/**
 * What a refused stop verb says. ⚠ Exported for the test: a swallowed refusal
 * and a successful stop are indistinguishable on screen, which is the whole
 * failure — the operator presses Pause, nothing visible happens, and they are
 * left to guess whether it worked.
 */
export const AGENT_CONTROL_REFUSED =
  "This agent already ended — nothing was changed.";

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
  stats,
}: {
  agent: DesktopSessionSummary;
  /** THE CONTEXT/USAGE READOUT, rendered inside this box under the buttons: one band of chrome.
   *  A slot, because what it renders is the panel's business, not the controls'. */
  stats?: ReactNode;
  /** The workspace segment the agent window's route is built from. */
  workspaceSlug: string;
  /** Re-read the desktop's feed after a refusal — see `agents-model.ts ›
   *  DesktopSessionsFeed`. Absent in a tree that has no feed to refresh. */
  onRefreshSessions?: () => void;
}) {
  const control = useAgentControls();
  /**
   * ⚠ THE AGENT'S OWN RUNTIME (`DesktopSessionSummary.runtimeId`), never the channel's current
   * pick. A REFUSAL WITH ITS SENTENCE, never a control that vanishes (§3.2): without an interrupt
   * Dopl cannot stop a session it started, so the buttons go inert AND say why. No descriptor yet
   * (off-desktop, or before the first read answers) refuses nothing.
   */
  const runtime = useChannelLaunchPosture(agent.channelId).descriptorOf(agent.runtimeId);
  const stopRefusal = runtime ? interruptRefusal(runtime) : null;
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
  // ⚠ THE BOX GOES ONLY WHEN IT HOLDS NOTHING (2026-08-27). It used to go whenever this build had
  // neither control op — correct while the box was buttons and nothing else. Since the usage
  // readout moved IN here (Samuel's one-box ruling), that early return would take it with it, and
  // the numbers have nothing to do with the bridge: they are the SUMMARY FEED's, and a plain
  // browser that can neither pause nor open a window can still say how much context is used.
  // ⚠ THE HELD CALLS ARE READ BEFORE THE EARLY RETURN, AND THEY COUNT TOWARD IT. A build with
  // neither stop verb nor an open op and no stats can still be HOLDING a call, and returning
  // null above the one control that would unblock it is the exact failure this box just gained
  // a card to fix. ⚠ THE CAPABILITY IS PART OF THE CONDITION, not just of the card: `AgentHeldGates`
  // renders nothing on a build that cannot answer, so counting held calls alone would keep this
  // box alive as a bare hairline with nothing in it.
  const canAnswerHeld = agentHeldGates(agent).length > 0 && canAnswerPermission();
  if (!canControl && !canOpen && !stats && !canAnswerHeld) return null;
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
              disabled={stopped || pending !== null || stopRefusal !== null}
              onClick={() => run("pause")}
            />
            <ControlButton
              icon={Square}
              label="End"
              title="End this agent. The thread is untouched."
              disabled={stopped || pending !== null || stopRefusal !== null}
              onClick={() => run("end")}
            />
          </>
        )}
        {canOpen && (
          <ControlButton
            icon={PanelTop}
            label="Open window"
            title="Watch what this agent is doing, and message it directly."
            onClick={reveal}
          />
        )}
      </div>
      {stats}
      {/* ⚠ UNDER THE BUTTONS AND THE NUMBERS, ABOVE THE NOTICES — it is the thing to ACT on, so
          it sits with the actions rather than under the two transient lines. `AgentHeldGates`
          renders nothing when this build cannot answer a gate (absent, never inert). */}
      <AgentHeldGates agent={agent} onRefreshSessions={onRefreshSessions} />
      {/* ⚠ A STANDING NOTE, NOT THE SIX-SECOND NOTICE BELOW IT. The refusal is a FACT about
          this runtime, not the outcome of a click, so it must not time out — and it renders
          above `notice` so a genuine refusal from a press still lands last. */}
      {stopRefusal && (
        <p role="note" className="text-caption text-text-muted">
          {stopRefusal}
        </p>
      )}
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
      className="btn-light flex items-center gap-1.5 rounded-full px-2 py-1 text-caption font-medium text-text-primary disabled:cursor-not-allowed disabled:text-text-disabled"
    >
      <Icon size={13} aria-hidden />
      {label}
    </button>
  );
}