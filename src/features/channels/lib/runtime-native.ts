/**
 * THE RUNTIME-NATIVE LAUNCH SETTINGS A ROW MAY WRITE — the web mirror of
 * `dopl-desktop-app/main/runtime/selection-vocabulary.js › nativeDimensions` (2026-09-21, U8).
 *
 * ⚠ **IT EXISTS TO END THE DISPLAY-ONLY ILLUSION (F-390).**
 * `settings-agent-launch-rows.tsx` rendered Codex's sandbox and its five approval categories as
 * VALUE PILLS, with a docblock explaining that *"SANDBOX and the APPROVAL CATEGORIES have no wire
 * field at all, so they are rendered as DATA … and NOT as controls"*. U5 gave the sandbox axis a
 * validated write path (`launch-selection.js › normalizeRuntimeRecord`'s `native` branch, which
 * `session-engine.js` stamps at spawn), so the pill becomes a real control and this module is the
 * one place that says which dimensions have one.
 *
 * ⚠ **AND IT DOES NOT GIVE ONE TO THE APPROVAL CATEGORIES.** U5 is explicit that no adapter
 * declares Codex's granular approval CATEGORIES as configurable, because the structured
 * `approval_policy = { granular = { … } }` write shape is unmeasured. A dimension this module
 * reported would become a storable setting the adapter cannot spend — F-390's exact shape, in a
 * new costume. The categories stay a REPORT of what the platform will do, which is what they
 * always were and what they honestly are.
 *
 * ⚠ **TWO KINDS OF DIMENSION AND TWO FALL-BACK DIRECTIONS, AND THEY MUST NOT COLLAPSE** — the
 * main-process module's own rule, restated because the row has to render the difference:
 *   · CONTAINMENT (`toolMode.secondaryAxis` — Codex's sandbox) falls to its NARROWEST declared
 *     option, because a partially migrated containment value resolving to the widest is the one
 *     failure the plan's scope boundary names outright;
 *   · a MODEL dimension (`models.dimensions` — Codex's reasoning effort) is DROPPED, i.e. the
 *     platform's own pick, because there is no narrowest member to fall to.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT (INVARIANTS §1). The ONE reason this file changes is that
 * `main/runtime/selection-vocabulary.js` changed.
 */

import {
  dimensionDefaultFor,
  dimensionOptionsFor,
  type ModelCatalog,
} from "./model-catalog";
import {
  secondaryAxis,
  toolModeOptions,
  type RuntimeDescriptor,
  type RuntimeModeOption,
} from "./runtime-capability";

/** ⚠ The two are different questions with different fall-backs — see the header. */
export type NativeDimensionKind = "containment" | "model";

export interface NativeDimension {
  /** The store key inside the runtime record's `native` bag. */
  key: string;
  /** ⚠ THE PLATFORM'S OWN ROW NAME where it has one (`secondaryAxis.label` — "Sandbox"), because
   *  Dopl owns the CATEGORY and the runtime owns the OPTIONS (Decision #1). */
  label: string;
  kind: NativeDimensionKind;
  /** ⚠ NARROWEST FIRST on a containment axis — the ordering is load-bearing, not cosmetic. */
  options: ReadonlyArray<RuntimeModeOption>;
  /** The runtime's own declared default, or `null`. */
  default: string | null;
}

const NO_DIMENSIONS: ReadonlyArray<NativeDimension> = [];

/** The model-scoped dimension every runtime that has one spells the same way. */
export const REASONING_EFFORT = "reasoningEffort";

/** ⚠ Dopl owns the CATEGORY NAME for the model-scoped dimension, because the platforms do not
 *  ship one — the runtime owns the OPTIONS below it. */
const REASONING_EFFORT_LABEL = "Reasoning effort";

/**
 * EVERY NATIVE DIMENSION THE SELECTED RUNTIME DECLARES **AND CAN SPEND**, in the order a row
 * group renders them: containment first, then the model-scoped ones.
 *
 * ⚠ **EMPTY IS THE COMMON CASE AND IT RENDERS NOTHING** — Claude declares no `secondaryAxis` and
 * no `models.dimensions`, so no row exists for it: not greyed, not a placeholder, and with no
 * sentence explaining a sandbox Claude does not have (design §3.2, hide-never-gray).
 * ⚠ **A DIMENSION WITH NO OPTIONS IS DROPPED**, never rendered as an empty control. That is the
 * same refusal `main/runtime/contract.js › descriptorProblems` makes at registration.
 */
export function nativeDimensions(
  descriptor: RuntimeDescriptor | null | undefined,
  catalog: ModelCatalog | null | undefined,
  modelId: string | null | undefined
): ReadonlyArray<NativeDimension> {
  const out: NativeDimension[] = [];
  const secondary = secondaryAxis(descriptor);
  if (secondary && secondary.key && secondary.options.length) {
    out.push({
      key: secondary.key,
      label: secondary.label,
      kind: "containment",
      options: secondary.options,
      default: secondary.default ?? null,
    });
  }
  // ⚠ **TWO GATES, AND BOTH ARE LOAD-BEARING.** The DESCRIPTOR says whether this runtime has the
  // dimension at all and — through `models.dimensionOptions` — what Dopl can STORE for it; the
  // CATALOG says which of those the SELECTED MODEL supports. A control sourced from either alone
  // is wrong in a different direction: from the descriptor it offers efforts the model refuses,
  // from the catalog it offers efforts the store would drop (F-390's shape).
  const declared = (descriptor?.models?.dimensions ?? []).includes(REASONING_EFFORT);
  const options = declared ? dimensionOptionsFor(catalog, modelId, REASONING_EFFORT) : [];
  if (options.length) {
    out.push({
      key: REASONING_EFFORT,
      label: REASONING_EFFORT_LABEL,
      kind: "model",
      options: options.map((o) => ({
        value: o.value,
        label: o.label,
        description: o.description,
        native: true,
      })),
      default: dimensionDefaultFor(catalog, modelId, REASONING_EFFORT),
    });
  }
  return out.length ? out : NO_DIMENSIONS;
}

/**
 * THE VALUE A DIMENSION WILL ACTUALLY LAUNCH WITH, given what is stored.
 *
 * ⚠ **IT IS THE SAME FAIL-CLOSED ANSWER MAIN GIVES THE SAME VALUE** — an unrecognised containment
 * value resolves to `options[0]`, a model dimension to the declared default and then to absence.
 * A row that showed the stored word while main floored it would be the control lying about what
 * it does, which is the whole class of defect U8 exists to remove.
 * ⚠ `""` MEANS "NO PICK, THE PLATFORM DECIDES" on a model dimension and can never be the answer
 * on a containment one — that axis always has a narrowest member.
 */
export function effectiveNative(
  dimension: NativeDimension,
  stored: string | null | undefined
): string {
  const asked = typeof stored === "string" ? stored.trim() : "";
  if (asked && dimension.options.some((o) => o.value === asked)) return asked;
  if (dimension.kind === "containment") {
    const declared = dimension.default;
    if (declared && dimension.options.some((o) => o.value === declared)) return declared;
    return dimension.options[0]?.value ?? "";
  }
  return dimension.default && dimension.options.some((o) => o.value === dimension.default)
    ? dimension.default
    : "";
}

/**
 * THE COMPACT NATIVE SUMMARY — "on-request approvals · workspace-write sandbox", or `""`.
 *
 * ⚠ **IT IS A REPORT OF ACTUAL VALUES, NOT A SYNTHETIC CROSS-RUNTIME PRESET** (Decision #1, in as
 * many words). Every word in it is the platform's OWN option label off the descriptor; nothing
 * here paraphrases, ranks or maps one runtime's vocabulary onto another's.
 * ⚠ **IT IS THE ONLY THING THE NEW-AGENT DIALOG SAYS ABOUT NATIVE SETTINGS**, because a launch
 * carries no per-spawn native override — those ride the channel's stored record
 * (`channel-prefs.js › launchStartModes`). A control in the dialog would write nowhere.
 */
export function nativeSummary(
  descriptor: RuntimeDescriptor | null | undefined,
  dimensions: ReadonlyArray<NativeDimension>,
  tools: string | null | undefined,
  native: Readonly<Record<string, string>> | null | undefined
): string {
  const parts: string[] = [];
  const mode = typeof tools === "string" ? tools.trim() : "";
  const named = toolModeOptions(descriptor).find((o) => o.value === mode);
  if (named) parts.push(named.label);
  for (const dimension of dimensions) {
    const value = effectiveNative(dimension, native?.[dimension.key]);
    if (!value) continue;
    const label = dimension.options.find((o) => o.value === value)?.label ?? value;
    // ⚠ THE DIMENSION'S NAME RIDES ALONG BECAUSE THE OPTION LABELS ARE NOT SELF-DESCRIBING.
    // Codex spells a sandbox `workspace-write`, which reads as a mode of something unnamed.
    parts.push(`${label} ${dimension.label.toLowerCase()}`);
  }
  return parts.join(" · ");
}
