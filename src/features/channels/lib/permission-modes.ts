/**
 * THE TWO PERMISSION AXES — the shared vocabulary, and nothing that reads or
 * writes them.
 *
 * ⚠ SPLIT OUT OF `hooks/use-channel-permission-preset.ts` ON 2026-08-20, ahead of
 * that hook's deletion (the single-use permission ARM is retired — INVARIANTS §6,
 * §11). The arm was the vocabulary's original home only by accident of being the
 * first surface to need it; the DURABLE LAUNCH POSTURE
 * (`hooks/use-channel-launch-posture.ts`) and the Settings tab
 * (`components/channels-v2/settings-agent.tsx`) speak exactly the same two axes and
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
  /**
   * WHICH MODEL the operator's next agent here starts on — an SDK model id, or
   * `null` for the SDK's own default (Samuel, 2026-08-22).
   *
   * ⚠ A THIRD FIELD, NOT A THIRD AXIS. The two axes above are SUPERVISION — who
   * gets asked before what — and they are re-validated by main against a closed
   * enum. A model is a CAPABILITY pick with no security meaning at all: it cannot
   * widen what an agent may reach, and its roster is the SDK's rather than this
   * product's (`lib/agent-models.ts` carries the vocabulary and says why it
   * refuses to be a second authority on the ids).
   *
   * ⚠ OPTIONAL, AND ITS ABSENCE IS NOT `null`. A main that predates the field
   * omits it from the get reply entirely; a current main that has never been given
   * a model answers `null`. Those are DIFFERENT facts — "this build cannot say"
   * versus "the default applies" — and the Settings row renders the first as NO
   * ROW and the second as "Default" (`use-channel-launch-posture.ts ›
   * ChannelLaunchPostureState.modelSupported` is the detector; INVARIANTS §11).
   * ⚠ `normalizePermissionPreset` therefore must NOT require it: a pair without a
   * model is still a valid posture, and rejecting it would blank the two axes on
   * every older desktop.
   */
  model?: string | null;
}

/** What an unset channel starts on: the most restrictive pair on both axes, and
 *  no model — the SDK's own default. ⚠ `model` is deliberately OMITTED rather
 *  than set to `null`: this constant also stands in for "could not read the
 *  posture at all", and a key here would claim a capability probe that never ran. */
export const DEFAULT_PERMISSION_PRESET: PermissionPreset = {
  tools: "manual",
  messages: "ask",
};

/**
 * Coerce a bridge reply into a preset, or null. ⚠ Both AXES must be known — a
 * half-valid pair is rejected WHOLE, like the main-process validator, so a
 * version-skewed desktop can never render as a posture the web cannot name.
 *
 * ⚠ THE MODEL IS NOT PART OF THAT RULE (2026-08-22). It is carried through when
 * present and simply absent when not — a reply with two good axes and no model is
 * a VALID posture from every desktop older than the field, and rejecting it would
 * blank the permission controls on all of them. It is also not validated against
 * a roster here: the ids are the SDK's and move without this tree shipping
 * (`lib/agent-models.ts › normalizeAgentModel` states the asymmetry).
 * ⚠ The KEY is preserved rather than normalized to `null`, because its ABSENCE is
 * the capability signal the Settings row gates on.
 */
export function normalizePermissionPreset(raw: unknown): PermissionPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const { tools, messages } = raw as { tools?: unknown; messages?: unknown };
  const t = TOOL_MODES.find((m) => m === tools);
  const m = MESSAGE_MODES.find((v) => v === messages);
  if (!t || !m) return null;
  const preset: PermissionPreset = { tools: t, messages: m };
  if (hasModelKey(raw)) {
    preset.model = typeof (raw as { model?: unknown }).model === "string"
      ? ((raw as { model: string }).model.trim() || null)
      : null;
  }
  return preset;
}

/**
 * DID THIS REPLY CARRY A MODEL FIELD AT ALL — the capability probe.
 *
 * ⚠ IT IS AN OWN-KEY TEST, NOT A TRUTHINESS TEST, and the distinction is the
 * whole feature. `model: null` is a current main saying "no model chosen, the SDK
 * default applies"; NO KEY is an older main that has no model concept. A `!!raw.model`
 * check collapses those into one answer and would hide the Settings row from every
 * operator who had not yet picked a model (INVARIANTS §11 — UNKNOWN is not EMPTY).
 *
 * ⚠ WHY A VALUE PROBE RATHER THAN A BRIDGE-MEMBER DETECTION. The model rides the
 * EXISTING `getLaunchPosture` / `setLaunchPosture` pair — there is no new op to
 * feature-detect on, which is what the rest of this family does. If the desktop
 * later grows a dedicated detector, this is the one function to re-point.
 */
export function hasModelKey(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    Object.prototype.hasOwnProperty.call(raw, "model")
  );
}
