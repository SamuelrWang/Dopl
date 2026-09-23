import type { IdentityField } from "../client/types";

/**
 * WHAT AN OPERATOR MAY CHANGE AT LAUNCH — the shape, the bounds, and the
 * "did anything actually change?" question. Nothing here renders and nothing
 * here reaches the bridge (INVARIANTS §1: one file, one reason to change).
 *
 * ⚠ OVERRIDES ARE EPHEMERAL AND THIS MODULE IS WHY THAT IS CHEAP. Nothing
 * written here is ever PATCHed back onto the identity: the launch sheet builds
 * one of these, `sessions.launch` carries it, main splices it into that one
 * spawn's ROLE block, and the durable row is untouched. The identity's own
 * editor is the only authoring surface (`../components/identity-editor.tsx`).
 *
 * ⚠ MODEL **AND** FIELDS, both (Samuel, 2026-08-22 — this RESOLVES the spec's
 * OQ-2, which recommended model-only for the first wave). The product statement
 * is that a launch may re-point both, so shipping model-only would have meant a
 * second form and a second wave for the half already designed.
 * ⚠ **AND INSTRUCTIONS SINCE 2026-09-13** (Samuel, over the launch sheet), which
 * is the field the 2026-08-22 wave explicitly refused. See
 * {@link IdentityLaunchOverrides.instructions}.
 *
 * The one producer is `channels/components/use-agent-launch-run.ts › launchOverridesOf`
 * (`model`, `instructions`). Nothing in the renderer produces `fields`; main still
 * honours the key (`main/identity-resolve.js › narrowOverrides`) — P7-14 deleted the
 * test-only field helpers, not the wire key.
 *
 * ⚠ THE CHARSET RULE IS NOT RE-STATED HERE, DELIBERATELY, AND THE BOUNDS BELOW
 * ARE ONLY THE NUMBERS. `SAFE_LABEL_RE` lives in `@/shared/lib/safe-label`,
 * whose module body imports **zod** — and `../client/types.ts` is explicit that
 * a value import from that family "would drag the validator into the renderer",
 * which is a rule about the desktop SPA bundle rather than a style preference.
 * A second copy of a neutralizer is worse than none (the copy that drifts is the
 * one that stops neutralizing), so the client half is: **single-line `<input>`
 * elements, which cannot hold a newline by construction, plus the size caps
 * below** — and MAIN RE-VALIDATES the whole payload before any of it reaches a
 * prompt. Filed as F-281.
 *
 */

/**
 * The instructions bound, mirroring `../schema.ts › MAX_INSTRUCTIONS_CHARS` and
 * `main/identity-resolve.js › MAX_INSTRUCTIONS` — the COLUMN's own CHECK.
 *
 * ⚠ **THE SAME NUMBER, DELIBERATELY.** `main/prompt-framing-agent-identity.js`'s F-287
 * block is the argument: a smaller bound at a later layer is not extra safety, it
 * is one layer quietly deciding the operator's configuration says less than it
 * says while every other surface keeps showing the whole thing.
 */
export const MAX_OVERRIDE_INSTRUCTIONS_CHARS = 32_768;

/**
 * The ephemeral half of a launch.
 *
 * ⚠ ABSENT IS THE ONLY SPELLING OF "NO OVERRIDE". There is no `null` sentinel
 * and no empty-object-means-default: `undefined` on either key means main reads
 * the identity's own value, which is the same rule
 * `channels/lib/agent-models.ts › AGENT_MODEL_DEFAULT` follows for the durable
 * posture row — one vocabulary, three surfaces.
 */
export interface IdentityLaunchOverrides {
  /** An SDK model id. Absent ⇒ the identity's `model`, or the desktop's own
   *  default when the identity carries none. */
  model?: string;
  /**
   * WHAT THIS RUN IS TOLD TO DO, REPLACING the identity's own `instructions` for
   * this spawn alone (2026-09-13, Samuel: *"we should add an Instructions field
   * in the New agent popup"*).
   *
   * ⚠ **THE LAUNCH SHEET'S READ-ONLY DISCLOSURE IS WHAT THIS REPLACED, AND THAT
   * IS THE RULING THAT DELETED IT.** This module's header said *"MODEL AND
   * FIELDS, both … an editable instructions box at launch is a SECOND AUTHORING
   * SURFACE for the durable thing"* — Samuel overruled the second half on
   * 2026-09-13 and the first half is untouched: nothing here is written back, so
   * the durable identity is exactly as unaffected as a model re-point leaves it.
   * The editor is still the only AUTHORING surface; this is one run's copy.
   * ⚠ **ABSENT IS STILL THE ONLY SPELLING OF "NO OVERRIDE"**, and the popup
   * measures against the IDENTITY'S OWN PROSE rather than against empty
   * (`channels/components/use-agent-launch.ts › launchOverridesOf`) — otherwise every
   * identity launch would carry a redundant copy of text main is about to read
   * from the row anyway.
   * ⚠ **NO CLIENT-SIDE CHARSET RULE, AND NOT AN OVERSIGHT** — the module header's
   * F-281 note: instructions are PROSE (`../schema.ts › InstructionsSchema` is
   * `safeOptionalProse`, newlines legal), the `<textarea>` bound is the length
   * cap below, and MAIN re-validates (`main/identity-resolve.js ›
   * narrowOverrides`) before any of it reaches a prompt.
   * ⚠ **A LAUNCH CARRYING THIS AND NO `identityId` IS NOT HONOURED TODAY** —
   * `main/identity-resolve.js › applyOverrides` answers `null` for a null
   * identity, so a BLANK agent's instructions are dropped in main. Filed as
   * F-695; Samuel owes the ruling on what a nameless role block says.
   */
  instructions?: string;
  /** REPLACES the identity's `fields` for this spawn — never merged. A partial
   *  merge over a set the operator can edit is how two field lists silently
   *  diverge (`../schema.ts`'s replace-set rule, same argument). */
  fields?: IdentityField[];
}
