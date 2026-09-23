/**
 * THE TWO PERMISSION AXES — the shared vocabulary, and nothing that reads or
 * writes them.
 *
 * ⚠ SPLIT OUT OF `hooks/use-channel-permission-preset.ts` ON 2026-08-20, ahead of
 * that hook's deletion (the single-use permission ARM is retired — INVARIANTS §6,
 * §11). The arm was the vocabulary's original home only by accident of being the
 * first surface to need it; the DURABLE LAUNCH POSTURE
 * (`hooks/use-channel-launch-posture.ts`) and the Settings tab
 * (`channels/components/settings-agent.tsx`) speak exactly the same two axes and
 * outlive it. Deleting the arm with this attached would have taken the posture's
 * type, its normalizer and its default with it.
 *
 * ⚠ ONE REASON TO CHANGE (§1): the DESKTOP's enums moved. The values are the
 * desktop's real ones (`dopl-desktop-app/main/session-profiles.js`), which
 * re-validates every write — this module's job is to keep the web from offering a
 * value main would reject, not to be a second authority on what the values are.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT. Anything that reaches `window.dopl` belongs in a
 * hook; anything that renders belongs in a component. A reader added here is how
 * the next deletion gets tangled the same way this one was.
 */

/** AXIS A — what this machine's agent may DO. */
const TOOL_MODES = ["manual", "accept_edits", "auto", "bypass"] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

/** AXIS B — what CROSSES between the two machines. */
const MESSAGE_MODES = [
  "ask",
  "auto_inbound",
  "auto_outbound",
  "auto_both",
] as const;
export type MessageMode = (typeof MESSAGE_MODES)[number];

export interface PermissionPreset {
  tools: ToolMode;
  messages: MessageMode;
  // ⚠ `model?: string | null` STOOD HERE (2026-08-22) AND IS DELETED (2026-09-23, Samuel: "We
  // don't need a pin model in the settings"). The desktop stores no channel model and its
  // reply carries no `model` key; a launch's model is the launcher's pick, the identity's, or
  // the runtime's default (`dopl-desktop-app/main/runtime/launch-default.js`).
}

/** What an unset channel starts on: the most restrictive pair on both axes. */
export const DEFAULT_PERMISSION_PRESET: PermissionPreset = {
  tools: "manual",
  messages: "ask",
};

/**
 * Coerce a bridge reply into a preset, or null. ⚠ Both AXES must be known — a
 * half-valid pair is rejected WHOLE, like the main-process validator, so a
 * version-skewed desktop can never render as a posture the web cannot name.
 */
export function normalizePermissionPreset(raw: unknown): PermissionPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const { tools, messages } = raw as { tools?: unknown; messages?: unknown };
  const t = TOOL_MODES.find((m) => m === tools);
  const m = MESSAGE_MODES.find((v) => v === messages);
  if (!t || !m) return null;
  // ⚠ A `model` KEY AN OLDER DESKTOP STILL SENDS IS NOT READ (2026-09-23).
  return { tools: t, messages: m };
}

// ⚠ `hasModelKey` STOOD HERE (2026-08-22) AND IS DELETED (2026-09-23) with the channel model it
// probed for. Its OWN-KEY idiom lives on in `runtime-capability.ts › hasRuntimeKey` and
// `launch-selection.ts › readLaunchSelection`.
