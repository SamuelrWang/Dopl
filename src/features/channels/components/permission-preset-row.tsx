// ⚠ NO "use client" AND NO COMPONENT — this file is two data tables now (the
// `RequestPermissionRowView` that made it a component was deleted below). It is
// imported by client components and renders nothing itself.
import type { SelectMenuOption } from "@/shared/ui/select-menu";
import type { MessageMode, ToolMode } from "../lib/permission-modes";

/**
 * THE TWO PERMISSION AXES, as an operator reads them: what an agent may DO, and
 * which messages cross without asking.
 *
 * WHY EACH OPTION SPELLS ITSELF OUT: a security review found operators could not
 * tell what a permission switch actually permitted — a single control governed
 * both the shell and outbound messages, and its label never named the blast
 * radius. The fix was two independent axes, each stating in plain words what it
 * does, and the copy lives INSIDE the options — the operator reads what a mode
 * does while choosing it, not in a summary line afterwards.
 *
 * ⚠ THAT COPY WAS CARRIED VERBATIM FROM `renderer/session/session-labels.js`
 * (`TOOL_POSTURE` / `MESSAGE_POSTURE`), WHICH IS DELETED with the v1 session
 * window. Recorded as PROVENANCE, not as a sync obligation: **these tables are
 * the only statement of this copy now**, and the security review that bought the
 * wording is the reason to keep it rather than the file it came from.
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
 * ⚠ `RequestPermissionRow` AND `RequestPermissionRowView` BOTH STOOD HERE AND ARE
 * DELETED (the wrapper 2026-08-20 with the arm; the view later the same day).
 *
 * The wrapper was bridge-gated over the single-use consent ARM
 * (`window.dopl.channels.get/setPermissionPreset`), mounted inside
 * `launch-panel.tsx`'s inbound disclosure. That disclosure had not rendered since
 * the 2026-08-18 consent rewrite (F-233), so the control was reachable by nobody,
 * and the arm it wrote is gone from the desktop with it.
 *
 * ⚠ THE VIEW WENT BECAUSE THE CLAIM ABOVE IT WAS FALSE. Its docblock said it was
 * "still the presentation both surfaces share"; neither surface used it.
 * `channels-v2/settings-agent.tsx` and `channels-v2/agent-posture.tsx` each render
 * their own two `SelectMenu`s — the axes are the same, but the chrome around them
 * is not (one sits in a settings group, the other in a live control strip), and a
 * shared component that neither caller reached was a claim about reuse rather than
 * reuse.
 *
 * ⚠ THE FILE STAYS BECAUSE THE OPTION TABLES ABOVE ARE LIVE, and they are the
 * reason it exists at all: `TOOL_OPTIONS` and `MESSAGE_OPTIONS` carry the per-mode
 * copy a security review bought (see the header), and BOTH surfaces import them.
 * That is the sharing that survived — the vocabulary, not the markup.
 */
