"use client";

/**
 * THE LIVE AGENT CONTROLS — both permission axes and the MODEL, on a session that
 * is ALREADY RUNNING (Samuel, 2026-08-20; the model 2026-08-22).
 *
 * ⚠ ITS OWN FILE because it is its own reason to change: the agent window's other content is
 * a set of LANES over a feed, and this is a write surface over the two axes — which move when
 * the permission vocabulary moves, not when the wire shape does.
 */

import { useState, type ReactNode } from "react";
import { SelectMenu } from "@/shared/ui/select-menu";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "../permission-preset-row";
import type { MessageMode, ToolMode } from "../../lib/permission-modes";
import {
  AGENT_MODEL_DEFAULT,
  agentModelOptionsFor,
} from "../../lib/agent-models";
import {
  canSetAgentMode,
  canSetAgentModel,
  setAgentMode,
  setAgentModel,
} from "./agents-controls";
import { agentRunningModel } from "./agents-model";

/** What a refused posture change says. ⚠ Exported for the test: a select that moves while
 *  main refuses is the exact lie the deleted session window's selects earned a fix for
 *  twice — the control claims a posture nothing is enforcing. */
export const POSTURE_REFUSED = "That didn't apply. The agent may have just ended.";

// ⚠ A SUCCESSFUL MODEL CHANGE SAYS NOTHING, AND THAT IS THE DESIGN (2026-08-22).
// `sessions.setModel` reports no timing, and it does not need to: main stamps
// `DesktopSessionSummary.model` from `system/init` and from every assistant
// message, so the FEED is the confirmation and the select below re-renders from
// main's own value. A sentence promising "applied now" would be this renderer
// stamping a claim it cannot check — the same no-optimistic-stamp rule both axes
// follow. Only a REFUSAL earns copy, and it shares `POSTURE_REFUSED`.

/**
 * THE LIVE MESSAGE AXIS, FLOORED — F-236's SPA half (2026-08-20).
 *
 * ⚠ `"ask"` IS NOT OFFERED ON A RUNNING AGENT, and this is not a style choice.
 * A windowless session has NO ACCEPT SURFACE: picking "Ask each time" used to
 * hold the peer's next message in `session-gate.js › enqueue` with every release
 * path deleted, parking the session at `awaiting_inbound` permanently with no
 * error anywhere. Main now CLAMPS it (`session-profiles.js ›
 * floorWindowlessMessage`), so the live failure is gone — but an option that
 * silently snaps back to something else is a control lying about what it did,
 * which is the defect this surface has been fixed for twice.
 *
 * ⚠ THE FLOOR IS MAIN'S AND STAYS MAIN'S. This list must never become the
 * enforcement — it is the same rule stated where the operator can see it, and a
 * newer main that grows an accept surface should be able to widen the axis
 * without this file being the thing that forbids it.
 * ⚠ The DURABLE posture on the Settings tab keeps all four: it governs the NEXT
 * spawn, whose lane floors at launch, and "ask" is a meaningful thing to store.
 */
const LIVE_MESSAGE_OPTIONS = MESSAGE_OPTIONS.filter((o) => o.value !== "ask");

/**
 * THE LIVE PERMISSION CONTROLS (Samuel, 2026-08-20) — both axes, on a RUNNING session.
 *
 * ⚠ THEY APPLY FROM THE VERY NEXT GATE DECISION, NOT THE NEXT LAUNCH, and that is a
 * property of the engine rather than a promise this component makes:
 * `dopl-desktop-app/main/session-io.js › grantArgs` reads both axes off the reducer state
 * at CALL time, so moving that state IS the change. Nothing is invalidated and nothing is
 * re-decided.
 *
 * ⚠ THEY ARE NOT THE SETTINGS TAB'S POSTURE. `settings-agent.tsx` writes a per-channel
 * record that governs the NEXT spawn; this moves ONE live session and stores nothing. The
 * two are deliberately separate surfaces because they answer different questions — "how
 * should my agents start here" and "how should THIS one behave for the rest of its run" —
 * and collapsing them would make a per-session decision permanent.
 *
 * ⚠ THE VALUE SHOWN IS MAIN'S, ALWAYS. The select renders `agent.toolMode` /
 * `agent.messageMode` off the pushed summary, and a change is only reflected when the feed
 * says so. That is what keeps it honest across the three things that move a posture without
 * this control: the auth hold resetting both axes, a resume, and a change made in another
 * window on the same agent.
 *
 * ⚠ NO OPTIMISTIC STAMP. On a refusal the select simply does not move, because it was never
 * moved — there is no rollback to get wrong.
 *
 * ⚠ "THE DROPDOWNS VANISHED" IS TWO DIFFERENT ANSWERS, and only one of them was ever a bug
 * (diagnosed 2026-08-27 over a screenshot of an ENDED agent's window):
 *   1. **The agent is ended → the row is absent BY DESIGN**, and that gate is original to the
 *      controls (`3dc7e6a7`). Main answers `no-session`; a select that always refuses is the lie
 *      this surface has been fixed for twice. Do not "restore" them on an ended agent.
 *   2. **The BOX went with them** — that half WAS new, and this wave fixed it. The usage readout
 *      moved inside this box in the same wave, so the posture gate's `return null` silently
 *      swallowed the context meter too.
 * A LIVE agent on a build with `sessions.setMode` renders all three, in the window exactly as in
 * the panel: the pop-out shares this component and `main/agent-window.js` gives it the same
 * preload, so there is no window-specific feature detection to fail.
 */
export function PostureControls({
  agent,
  channelId,
  taskId,
  stats,
}: {
  agent: DesktopSessionSummary;
  channelId: string;
  taskId: string;
  /** THE USAGE READOUT, rendered inside this box (Samuel, 2026-08-27) — it had a band of its
   *  own directly above these dropdowns, two stacked strips about one agent. */
  stats?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canSet] = useState(() => canSetAgentMode());
  // ⚠ A SEPARATE CAPABILITY, DETECTED SEPARATELY (2026-08-22). The model op is
  // landing on the desktop in this same wave, so a build with the two axes and no
  // model selector is a real and expected shape — gating both on one flag would
  // either hide working controls or render one that can only refuse
  // (`agents-controls.ts › canSetAgentModel` carries the argument).
  const [canModel] = useState(() => canSetAgentModel());
  // An ENDED agent has no posture to change; main answers `no-session` and the honest face
  // of that is no control, not a control that always refuses. ⚠ THIS GATE IS ORIGINAL
  // (`3dc7e6a7`, the wave that added these controls) and is NOT what to change when the
  // dropdowns are missing on a LIVE agent — see the module header.
  const canPosture = canSet && agent.state !== "ended";
  // ⚠ THE BOX GOES ONLY WHEN IT HOLDS NOTHING (2026-08-27) — the same correction
  // `agent-panel-controls.tsx › AgentControls` took in this wave, and it is owed for the same
  // reason. The usage readout moved INSIDE this box (Samuel's one-box ruling); a bare
  // `return null` on the posture gate then took the STATS with it, so an ended agent's window
  // lost its context meter as well as its controls — and the numbers have nothing to do with
  // either the bridge op or the session still running. They are the summary feed's.
  if (!canPosture && !stats) return null;

  // ⚠ MAIN'S VALUE, LIKE BOTH AXES. Absent means this build does not report a
  // running model, and the select then shows Default rather than a guess.
  // ⚠ THE EFFECTIVE MODEL IS FREE-FORM AND MAY NOT BE ONE OF THE FOUR PICKABLE
  // IDS (`spa-bridge.ts › DesktopSessionSummary.model`: a dated id, a `[1m]`
  // variant). `agentModelOptionsFor` appends it so the control SHOWS what the
  // agent is on — a `SelectMenu` whose value matches no option renders blank,
  // which is the surface saying nothing where it has an answer.
  const model = agentRunningModel(agent) ?? AGENT_MODEL_DEFAULT;
  const modelOptions = agentModelOptionsFor(model);

  const apply = (axis: "tools" | "messages", mode: string) => {
    setBusy(true);
    setNotice(null);
    // ⚠ `agent.agentId` NAMES THE INSTANCE (2026-08-22). Without it main moves
    // the posture of the OLDEST live agent on this thread, which under
    // multiplayer is a different agent than the one whose selects these are —
    // and the feed would then show this card's posture unchanged, reading as a
    // refusal that never happened. `agents-controls.ts`'s header carries the rule.
    void setAgentMode({ channelId, taskId, agentId: agent.agentId, axis, mode })
      .then((res) => {
        if (!res.ok) setNotice(POSTURE_REFUSED);
      })
      .finally(() => setBusy(false));
  };

  const applyModel = (next: string) => {
    setBusy(true);
    setNotice(null);
    void setAgentModel({ channelId, taskId, agentId: agent.agentId, model: next })
      .then((res) => {
        if (!res.ok) setNotice(POSTURE_REFUSED);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="shrink-0 border-b border-border-default px-4 py-2.5">
      {/* ⚠ THE STANDARDISED RAISED FACE, AT THE CONSOLIDATED SIZE (Samuel, 2026-08-29) —
          `select-menu.tsx › raisedField`. They were the `flat` inset pill until 2026-08-27, then
          `raised`, whose `h-9` box read as LARGE pills in the pop-out and pushed the window wider
          than its content. `raisedField` is the SAME FACE (`auth-btn-3d-light`, so the elevation
          cannot drift), one size down — it is what the composer launch panel's Template/Model rows
          already wear, so this row and that one are one dropdown size across the app rather than
          two. No new size was added for this surface.
          ⚠ THE WINDOW'S DEFAULT WIDTH IS MEASURED FROM THESE DIMENSIONS —
          `main/agent-window.js › createAgentWindow` carries the arithmetic and `minWidth` with it.
          Changing the variant here silently changes what that window needs.
          ⚠ THE WHOLE ROW IS ABSENT, NEVER DISABLED, on an ended agent or a build with no
          `sessions.setMode` — the rule every control in this family follows.

          ⚠ `flex-nowrap`, AND IT WAS `flex-wrap` UNTIL 2026-08-29 (Samuel: "only just enough so
          that they are all on the same line with the same spacing"). THE WRAP WAS THE WHOLE REASON
          THE WINDOW CARRIED SLACK. A too-long label — the model axis is FREE-FORM, so
          `agentModelOptionsFor` can append a dated id far wider than any of the four picks — used to
          push the third control onto a SECOND LINE, silently, and the only defence available was to
          open the window wide enough that it could not happen. That bought a band of dead space to
          the right of Model on every normal agent to protect an uncommon label.
          ⚠ OVERFLOW IS THE TRIGGER'S JOB NOW, NOT THE WINDOW'S. `select-menu.tsx` already gives the
          trigger `min-w-0 max-w-full` and its label span `min-w-0 truncate` — that contract could
          never ENGAGE here, because a flex line break is decided on an item's CONTENT width before
          shrinking is ever considered. In a nowrap row the same three classes finally do what they
          say: the long label ellipsizes inside its own pill and the row stays one line at any width.
          ⚠ SO THE WINDOW NUMBER IS NOW THE ROW'S HONEST MEASUREMENT AND NOTHING ELSE. Do not
          reintroduce `flex-wrap` here without widening `main/agent-window.js` back — they are one
          decision in two trees. */}
      {canPosture && (
        <div className="flex flex-nowrap items-center gap-2">
          <SelectMenu<ToolMode>
            value={(agent.toolMode as ToolMode) ?? "manual"}
            options={TOOL_OPTIONS}
            onChange={(next) => apply("tools", next)}
            prefix="Tools"
            ariaLabel="Tool permissions for this agent"
            variant="raisedField"
            disabled={busy}
          />
          <SelectMenu<MessageMode>
            // ⚠ The FALLBACK stays `auto_inbound`, not `"ask"`: that is the floor a
            // windowless session actually runs on, and defaulting the display to a
            // value the list no longer offers would render an empty control.
            value={(agent.messageMode as MessageMode) ?? "auto_inbound"}
            options={LIVE_MESSAGE_OPTIONS}
            onChange={(next) => apply("messages", next)}
            prefix="Messages"
            ariaLabel="Message permissions for this agent"
            variant="raisedField"
            disabled={busy}
          />
          {/* THE LIVE MODEL (Samuel, 2026-08-22). ⚠ ABSENT, NOT DISABLED, without
              the op — the rule every control in this family follows. */}
          {canModel && (
            <SelectMenu<string>
              value={model}
              options={modelOptions}
              onChange={applyModel}
              prefix="Model"
              ariaLabel="Model for this agent"
              variant="raisedField"
              disabled={busy}
            />
          )}
        </div>
      )}
      {stats && <div className={canPosture ? "mt-2" : undefined}>{stats}</div>}
      {notice && (
        <p role="status" className="mt-1.5 text-caption text-text-muted">
          {notice}
        </p>
      )}
      {/* ⚠ SAYS WHEN IT TAKES EFFECT, because "next launch" is what every other posture
          control in this product means and a reader has no way to tell them apart.
          ⚠ IT IS SCOPED TO THE TWO AXES and always has been — those are the ones
          `session-io.js › grantArgs` re-reads at every gate decision. The MODEL's
          timing is main's to report and rides the notice line above, so this
          sentence must not be widened to cover it.
          ⚠ IT RIDES WITH THE CONTROLS. With the row absent there is no posture to apply, and a
          sentence about controls that are not there is chrome explaining nothing. */}
      {canPosture && (
        <p className="mt-1.5 text-micro text-text-muted">
          Permissions apply to this agent from its next decision.
        </p>
      )}
    </div>
  );
}

