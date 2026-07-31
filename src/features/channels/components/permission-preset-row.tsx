"use client";

import { MessageSquare, Wrench } from "lucide-react";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import {
  useChannelPermissionPreset,
  type MessageMode,
  type PermissionPreset,
  type ToolMode,
} from "../hooks/use-channel-permission-preset";

/**
 * The inbound consent card's PERMISSION PRESET row: the two axes the operator
 * picks BEFORE clicking Allow, so the session spawns on the posture they chose
 * instead of one they can only correct after the agent is already running.
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
    description: "Auto approving every command on this machine",
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

/** Bridge-gated wrapper — renders NOTHING outside the desktop shell. */
export function RequestPermissionRow({ channelId }: { channelId: string }) {
  const { bridge, preset, busy, update } = useChannelPermissionPreset(channelId);
  if (!bridge) return null;
  return (
    <RequestPermissionRowView
      preset={preset}
      busy={busy}
      onChange={(patch) => void update(patch)}
    />
  );
}

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
        ariaLabel="What this session's agent may do"
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
