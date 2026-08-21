"use client";

import { MessageSquare, Wrench } from "lucide-react";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import {
  type MessageMode,
  type PermissionPreset,
  type ToolMode,
} from "../lib/permission-modes";

/**
 * THE TWO PERMISSION AXES, as an operator reads them: what an agent may DO, and
 * which messages cross without asking.
 *
 * WHY EACH OPTION SPELLS ITSELF OUT: a security review found operators could not
 * tell what a permission switch actually permitted — a single control governed
 * both the shell and outbound messages, and its label never named the blast
 * radius. The fix was two independent axes, each stating in plain words what it
 * does. That copy is carried here VERBATIM from the desktop session window
 * (renderer/session/session-labels.js TOOL_POSTURE / MESSAGE_POSTURE), and it
 * lives INSIDE the options — the operator reads what a mode does while choosing
 * it, not in a summary line afterwards.
 *
 * Desktop-only, exactly like the folder pill: no bridge means no control at all,
 * and the bridge is feature-detected after mount so the first paint is
 * hydration-safe.
 */

/** AXIS A. Titles are short; the description is the desktop's exact posture line. */
export const TOOL_OPTIONS: ReadonlyArray<SelectMenuOption<ToolMode>> = [
  {
    value: "manual",
    label: "Ask each time",
    description: "Asking before each command",
  },
  {
    value: "accept_edits",
    label: "Accept edits",
    description: "Auto approving file edits",
  },
  {
    value: "auto",
    label: "Auto",
    description:
      "Auto approving local edits and lookups, asking for shell, web and workspace writes",
  },
  {
    value: "bypass",
    label: "Bypass",
    description: "Auto approving every command the tool profile allows",
  },
];

/** AXIS B — what crosses between the two machines. */
export const MESSAGE_OPTIONS: ReadonlyArray<SelectMenuOption<MessageMode>> = [
  {
    value: "ask",
    label: "Ask each time",
    description: "Asking before messages in and out",
  },
  {
    value: "auto_inbound",
    label: "Auto accept in",
    description: "Auto accepting incoming messages",
  },
  {
    value: "auto_outbound",
    label: "Auto send out",
    description: "Auto sending outgoing messages",
  },
  {
    value: "auto_both",
    label: "Automatic",
    description: "Messages flow automatically",
  },
];

/**
 * ⚠ `RequestPermissionRow` STOOD HERE AND IS DELETED (2026-08-20, Samuel's ruling).
 *
 * It was the bridge-gated wrapper over the single-use consent ARM
 * (`window.dopl.channels.get/setPermissionPreset`), mounted inside
 * `launch-panel.tsx`'s inbound disclosure. That disclosure had not rendered since
 * the 2026-08-18 consent rewrite (F-233), so the control was reachable by nobody,
 * and the arm it wrote is gone from the desktop with it.
 *
 * ⚠ THE FILE STAYS BECAUSE THE OPTION TABLES ABOVE ARE LIVE. `TOOL_OPTIONS` and
 * `MESSAGE_OPTIONS` are what `channels-v2/settings-agent.tsx` renders for the
 * DURABLE launch posture, and `RequestPermissionRowView` below is still the
 * presentation both surfaces share. The copy inside those options is the reason
 * this file exists at all — see the header.
 */

/**
 * The control's presentation, split from the bridge-gated wrapper so it renders
 * (and is tested) on its own. Two pills matching the folder pill's recipe
 * (rounded-full + border-border-strong + bg-bg-inset), each one a kit dropdown —
 * never a bare native `<select>`, which cannot show the per-option copy above.
 */
export function RequestPermissionRowView({
  preset,
  busy,
  onChange,
}: {
  preset: PermissionPreset;
  /** True while a write is in flight — both pills disable. */
  busy: boolean;
  onChange: (patch: Partial<PermissionPreset>) => void;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <SelectMenu<ToolMode>
        value={preset.tools}
        options={TOOL_OPTIONS}
        onChange={(tools) => onChange({ tools })}
        prefix="Tools"
        icon={<Wrench size={12} className="shrink-0" />}
        ariaLabel="What this thread's agent may do"
        disabled={busy}
      />
      <SelectMenu<MessageMode>
        value={preset.messages}
        options={MESSAGE_OPTIONS}
        onChange={(messages) => onChange({ messages })}
        prefix="Messages"
        icon={<MessageSquare size={12} className="shrink-0" />}
        ariaLabel="Which messages cross without asking"
        disabled={busy}
      />
    </div>
  );
}
