"use client";

/**
 * THE SETTINGS TAB'S PER-ITEM EYE — a small popover that explains ONE setting and
 * what each of its options does (2026-09-06, Samuel's settings overhaul, item 15).
 *
 * ── ⚠ WHY THIS IS NOT THE POPOVER THE 2026-08-19 RULING DELETED ──────────────
 *
 * That ruling killed `channel-settings-popover.tsx` and `channel-folder-control.tsx`
 * because **every setting on this surface was behind a click** — a drill-down inside
 * a tab, a menu hiding inside a menu — and its replacement rule is that *"every
 * control below is visible and operable where it sits"*. That rule is intact here
 * and this file must never be used to weaken it: **the CONTROL stays on the row.**
 * What moves behind the eye is the EXPLANATION, which was never a control.
 *
 * It is also the other half of the MINIMAL-COPY ruling of the same day (INVARIANTS
 * §5 — *"We should not be explaining everything to the user"*, a row is a NAME and a
 * CONTROL). That ruling deleted the explainer paragraphs and left the meanings in
 * docblocks *for developers*; Samuel's 2026-09-06 direction is that an OPERATOR
 * should be able to reach the same meanings **on demand** — "that way the actual
 * dropdown will look a lot cleaner". So the sublines go, and this is where they go
 * to. Do not read the deleted `Note` recipe as re-opened: there is still no way to
 * hang a standing third line under a row, and adding one is still the regression.
 *
 * ⚠ SMALL, AND THE BOUND IS THE POINT (Samuel: *"This shouldn't be too big or too
 * long"*). One short paragraph, then at most one line per option. A popover that
 * grows into documentation is the paragraph block this tab already refused, moved
 * one click away.
 *
 * ⚠ KIT ONLY. It composes the same `Popover` in COORDINATE mode that
 * `shared/ui/select-menu.tsx` opens, for that file's stated reason: these rows sit
 * inside scrolling, overflow-clipping panes where a trigger-anchored panel renders
 * as a clipped sliver. No hand-rolled positioning, no hex, no raw px.
 */

import { useRef, useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover } from "@/shared/ui/popover-menu";

/** One setting's explanation: what it is, then what each option does. */
export interface SettingHelpCopy {
  /** ONE short paragraph. What this setting governs, and its SCOPE. */
  body: string;
  /** At most one line per option — the sublines the dropdowns no longer carry. */
  options?: ReadonlyArray<{ label: string; text: string }>;
}

/**
 * The eye, and the panel it opens.
 *
 * ⚠ IT IS A REAL `<button>` WITH A REAL NAME. The eye is an icon with no text, so
 * without `aria-label` it announces as "button" — and this is the only affordance
 * on the row that a screen-reader user could not otherwise discover. The name says
 * WHICH setting it explains, because a tab of nine identical "About this setting"
 * buttons is no better than nine unlabelled ones.
 *
 * ⚠ THE PANEL IS `role="note"`, NOT A MENU. It contains nothing selectable;
 * `role="menu"` would promise arrow-key traversal to exactly one option and is the
 * idiom `settings-agent.tsx` records a standing rule against.
 */
export function SettingHelp({ name, copy }: { name: string; copy: SettingHelpCopy }) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    // ⚠ COORDINATE MODE, and the panel is pulled LEFT of the trigger's right edge
    // so a row near the panel's right rail does not open off-surface. Same reason
    // `select-menu.tsx` measures rather than anchors.
    if (rect) setAnchor({ x: rect.left - 220, y: rect.bottom + 4 });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={`What ${name} does`}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        className={cn(
          "shrink-0 rounded-[6px] p-0.5 text-text-muted transition-colors",
          "hover:bg-surface-raised-1 hover:text-text-secondary"
        )}
      >
        <Eye size={12} aria-hidden />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="min-w-[240px] max-w-[300px]"
      >
        <div role="note" className="flex flex-col gap-1.5 px-3 py-2.5">
          <p className="text-caption font-semibold text-text-primary">{name}</p>
          <p className="text-caption leading-snug text-text-secondary">{copy.body}</p>
          {copy.options && copy.options.length > 0 && (
            <ul className="flex flex-col gap-1 pt-0.5">
              {copy.options.map((option) => (
                <li key={option.label} className="text-caption leading-snug">
                  <span className="font-medium text-text-primary">{option.label}</span>
                  <span className="text-text-secondary"> — {option.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Popover>
    </>
  );
}

/**
 * ── THE COPY, IN ONE TABLE ───────────────────────────────────────────────────
 *
 * ⚠ ONE PLACE, for the reason `lib/agent-models.ts` states about model names: an
 * explanation that disagrees with the control it explains is worse than none, and
 * two tables is how that happens. Every entry is keyed by the row's own rendered
 * name, so a renamed row with no popover is a visible omission rather than a stale
 * sentence under a new label.
 *
 * ⚠ EACH ENTRY STATES SCOPE, BECAUSE THIS TAB DELETED ITS GROUP HEADINGS (item 2).
 * "On this Mac, every channel", "For every session on this channel" and "When you
 * launch an agent" used to carry scope for the rows beneath them. They are gone —
 * so a row whose scope is not obvious from its name MUST say it here, or the tab
 * has quietly stopped stating who a setting governs.
 */
export const SETTINGS_HELP: Readonly<Record<string, SettingHelpCopy>> = {
  Runtime: {
    body: "Which agent platform a launch in this channel runs on. Applies to agents you launch here.",
  },
  // ⚠ `LAUNCH_POSTURE_HEADING`'s sentence, rehomed (item 2): this is the scope the
  // deleted heading used to carry for this row and the two under it.
  "Tool use": {
    body:
      "How much freedom an agent you launch here starts with over its tools. Set when the agent launches; changing it does not move a running agent.",
    options: [
      { label: "Ask each time", text: "every tool call waits for you" },
      { label: "Accept edits", text: "file edits run, everything else asks" },
      { label: "Auto", text: "the common work tools run on their own" },
      { label: "Bypass", text: "the widest set this runtime allows" },
    ],
  },
  "Tool access": {
    body:
      "Which tools exist for agents on this channel at all. It applies on top of Tool use, so it bounds every session here — yours and any you launch.",
    options: [
      { label: "Full access", text: "everything, including your connected apps" },
      { label: "Dopl only", text: "files, web, and Dopl" },
      { label: "Read only", text: "local files only, with no way to post out" },
    ],
  },
  // ⚠ THE ASYMMETRY IS STATED HERE BY RULING (2026-09-06, item 8). Messaging is read
  // LIVE at the gate while every other row in this group is read once at launch, and
  // the operator cannot discover that from the control. Do not shorten this line.
  Messaging: {
    body:
      "Whether an agent's messages cross without you pressing anything — inbound, outbound, or both. Unlike the rows above it, this one applies immediately to agents already running.",
    options: [
      { label: "Ask", text: "you approve every message in and out" },
      { label: "Auto inbound", text: "replies reach your agent on their own" },
      { label: "Auto outbound", text: "your agent's replies send on their own" },
      { label: "Auto both", text: "messages cross in both directions unattended" },
    ],
  },
  "Working Folder": {
    body:
      "Where this channel's agents run on your Mac. It is context, not a sandbox — it does not change what an agent may do. Click the folder name to change it.",
  },
  // ⚠ THE MACHINE-WIDE FACT IS VERBATIM BY RULING (2026-09-06, item 9), because the
  // heading that used to say it ("On this Mac, every channel") is deleted.
  "Launch agents": {
    body:
      "Whether agents can start further agents for you, and where. In every channel flips a machine-wide switch — it is not limited to this room.",
    options: [
      { label: "Cannot launch agents", text: "an agent here starts nothing" },
      { label: "In this channel", text: "agents here may launch, in this room only" },
      { label: "In every channel", text: "also lets an outside session launch on this Mac" },
    ],
  },
  Model: {
    body: "Which model agents you launch in this channel run on.",
  },
};
