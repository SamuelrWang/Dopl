"use client";

/**
 * Per-setting eye popover. It explains; the control stays on the row (minimal copy, INVARIANTS §5).
 * Keep it small: one short paragraph, at most one line per option.
 */

import { useRef, useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover } from "@/shared/ui/popover-menu";

/** One setting's explanation: what it is, then what each option does. */
export interface SettingHelpCopy {
  /** One short paragraph: what this setting governs, and its scope. */
  body: string;
  /** At most one line per option. */
  options?: ReadonlyArray<{ label: string; text: string }>;
}

/** How far the panel opens left of the eye: the popover's `min-w-[240px]` less the trigger. */
const PANEL_PULL_LEFT = 220;

/** The eye button (named for its setting) and its `role="note"` panel — nothing in it is selectable. */
export function SettingHelp({ name, copy }: { name: string; copy: SettingHelpCopy }) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    // Coordinate mode, like `select-menu.tsx`: these rows sit in overflow-clipping panes. Pulled
    // left so a row near the right rail does not open off-surface.
    if (rect) setAnchor({ x: rect.left - PANEL_PULL_LEFT, y: rect.bottom + 4 });
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

/** All popover copy, keyed by each row's rendered name. Every entry states its scope: the tab has
 *  no group headings to carry it. */
export const SETTINGS_HELP: Readonly<Record<string, SettingHelpCopy>> = {
  Runtime: {
    body: "Which agent platform a launch in this channel runs on. Applies to agents you launch here.",
  },
  // One control for every runtime; Details under it shows each runtime's own reading.
  Permissions: {
    body:
      "How much freedom an agent you launch here gets over its tools, applied in each runtime's own settings. Running agents take the new tool setting; a sandbox change waits for the next launch.",
    options: [
      { label: "Ask", text: "the agent asks before edits and commands" },
      { label: "Auto", text: "routine work runs, riskier actions ask" },
      { label: "Full", text: "everything the tool profile allows runs" },
    ],
  },
  "Tool access": {
    body:
      "Which tools exist for agents on this channel at all. It applies on top of Permissions, so it bounds every session here — yours and any you launch.",
    options: [
      { label: "Full access", text: "everything, including your connected apps" },
      { label: "Dopl only", text: "files, web, and Dopl" },
      { label: "Read only", text: "local files only, with no way to post out" },
    ],
  },
  // Keep the asymmetry: Messaging is read live at the gate; the other launch rows once, at launch.
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
  // Keep the machine-wide sentence: no heading states that scope.
  "Launch agents": {
    body:
      "Whether agents can start further agents for you, and where. In every channel flips a machine-wide switch — it is not limited to this room.",
    options: [
      { label: "Cannot launch agents", text: "an agent here starts nothing" },
      { label: "In this channel", text: "agents here may launch, in this room only" },
      { label: "In every channel", text: "also lets an outside session launch on this Mac" },
    ],
  },
  // Machine-wide, like "Launch agents"; vendor-neutral because any runtime on this Mac can direct.
  "Direct agents": {
    body:
      "Whether your other coding sessions on this Mac can send private instructions to agents already running here. It starts a turn inside an agent that exists; it never launches one. In every channel flips a machine-wide switch — it is not limited to this room.",
    options: [
      { label: "Cannot direct agents", text: "directions are refused and the sender is told why" },
      { label: "In every channel", text: "your outside sessions may direct agents on this Mac" },
    ],
  },
};
