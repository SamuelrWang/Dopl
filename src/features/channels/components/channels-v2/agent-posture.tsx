"use client";

/**
 * THE LIVE PERMISSION CONTROLS — both axes, on a session that is ALREADY RUNNING
 * (Samuel, 2026-08-20).
 *
 * ⚠ ITS OWN FILE because it is its own reason to change: the agent window's other content is
 * a set of LANES over a feed, and this is a write surface over the two axes — which move when
 * the permission vocabulary moves, not when the wire shape does.
 */

import { useState } from "react";
import { SelectMenu } from "@/shared/ui/select-menu";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "../permission-preset-row";
import type { MessageMode, ToolMode } from "../../lib/permission-modes";
import { canSetAgentMode, setAgentMode } from "./agents-controls";

/** What a refused posture change says. ⚠ Exported for the test: a select that moves while
 *  main refuses is the exact lie the deleted session window's selects earned a fix for
 *  twice — the control claims a posture nothing is enforcing. */
export const POSTURE_REFUSED = "That didn't apply. The agent may have just ended.";

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
 */
export function PostureControls({
  agent,
  channelId,
  taskId,
}: {
  agent: DesktopSessionSummary;
  channelId: string;
  taskId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canSet] = useState(() => canSetAgentMode());
  // An ENDED agent has no posture to change; main answers `no-session` and the honest face
  // of that is no control, not a control that always refuses.
  if (!canSet || agent.state === "ended") return null;

  const apply = (axis: "tools" | "messages", mode: string) => {
    setBusy(true);
    setNotice(null);
    void setAgentMode({ channelId, taskId, axis, mode })
      .then((res) => {
        if (!res.ok) setNotice(POSTURE_REFUSED);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="shrink-0 border-b border-border-default px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SelectMenu<ToolMode>
          value={(agent.toolMode as ToolMode) ?? "manual"}
          options={TOOL_OPTIONS}
          onChange={(next) => apply("tools", next)}
          prefix="Tools"
          ariaLabel="Tool permissions for this agent"
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
          disabled={busy}
        />
      </div>
      {notice && (
        <p role="status" className="mt-1.5 text-caption text-text-muted">
          {notice}
        </p>
      )}
      {/* ⚠ SAYS WHEN IT TAKES EFFECT, because "next launch" is what every other posture
          control in this product means and a reader has no way to tell them apart. */}
      <p className="mt-1.5 text-micro text-text-muted">
        Applies to this agent from its next decision.
      </p>
    </div>
  );
}

