/**
 * The runtime-native launch settings a row may write (web half of
 * `main/runtime/selection-vocabulary.js › nativeDimensions`). Two kinds, two fall-backs:
 * containment (`toolMode.secondaryAxis`, Codex's sandbox) falls to its narrowest option; a model
 * dimension (Codex's reasoning effort) falls to absent, the platform's own pick.
 * Approval categories get no control: there is no persisted per-category bag to write (F-390).
 */

import {
  dimensionDefaultFor,
  dimensionOptionsFor,
  REASONING_EFFORT,
  type ModelCatalog,
} from "./model-catalog";
import {
  secondaryAxis,
  toolModeOptions,
  type RuntimeDescriptor,
  type RuntimeModeOption,
} from "./runtime-capability";

export type NativeDimensionKind = "containment" | "model";

export interface NativeDimension {
  /** The store key inside the runtime record's `native` bag. */
  key: string;
  /** The platform's own row name where it has one ("Sandbox"). */
  label: string;
  kind: NativeDimensionKind;
  /** ⚠ Narrowest first on a containment axis; the order is load-bearing. */
  options: ReadonlyArray<RuntimeModeOption>;
  default: string | null;
}

const NO_DIMENSIONS: ReadonlyArray<NativeDimension> = [];

/** Dopl names the model-scoped row; the runtime owns its options. */
const REASONING_EFFORT_LABEL = "Reasoning effort";

/**
 * Every native dimension the runtime declares and can spend, containment first. Empty (Claude)
 * renders nothing; a dimension with no options is dropped, never an empty control.
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
  // Two gates: the descriptor declares the dimension; the catalog says what the selected model supports.
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
 * The value a dimension will launch with, answered as main does: an unrecognised containment value
 * floors to `options[0]` (`selection-vocabulary.js › normalizeNative`, X-05), an absent one takes
 * the declared default; a model dimension takes the declared default, else `""` (platform decides).
 */
export function effectiveNative(
  dimension: NativeDimension,
  stored: string | null | undefined
): string {
  const asked = typeof stored === "string" ? stored.trim() : "";
  if (asked && dimension.options.some((o) => o.value === asked)) return asked;
  if (dimension.kind === "containment") {
    const declared = dimension.default;
    if (!asked && declared && dimension.options.some((o) => o.value === declared)) return declared;
    return dimension.options[0]?.value ?? "";
  }
  return dimension.default && dimension.options.some((o) => o.value === dimension.default)
    ? dimension.default
    : "";
}

/**
 * "on-request approvals · workspace-write sandbox", in the platform's own labels, or `""`.
 * ⚠ The New Agent dialog only reports native settings: a launch carries no per-spawn native
 * override (they ride the channel record, `channel-prefs.js › launchStartModes`).
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
    // The dimension name rides along: `workspace-write` alone does not say what it bounds.
    parts.push(`${label} ${dimension.label.toLowerCase()}`);
  }
  return parts.join(" · ");
}
