"use client";

/**
 * AXIS A AND THE RUNTIME-NATIVE ROWS BESIDE IT — Tool use in the selected runtime's own words,
 * its containment axis, its approval categories and its classifier instructions.
 *
 * ⚠ **ITS OWN FILE SINCE 2026-09-21 (U8), AND THE SEAM IS A REASON TO CHANGE (INVARIANTS §1).**
 * `settings-agent-launch-rows.tsx` changes when the GROUP changes — which rows exist, in what
 * order, at which scope. This changes when a RUNTIME'S OWN VOCABULARY changes: what its Axis-A
 * options are, which native dimensions it declares, what an unrecognised value falls back to.
 * That clock moved the day U5 gave the containment axis a validated write path, and it will move
 * again the day `freeform` gains one.
 *
 * ── ⚠ **F-390 IS CLOSED HERE, AND THIS IS WHAT CHANGED** ─────────────────────────────────────
 *
 * The old version of this group rendered the SANDBOX and the APPROVAL CATEGORIES as VALUE PILLS
 * with a docblock explaining that *"SANDBOX and the APPROVAL CATEGORIES have no wire field at
 * all, so they are rendered as DATA … and NOT as controls"*, and it rendered the Tool use row as
 * a live control whose write main REFUSED on any runtime whose vocabulary was not the default's.
 * Two different dishonesties in one group. Since U5:
 *
 *   · **TOOL USE WRITES.** `main/launch-selection.js › patchRejections` checks the asked mode
 *     against the SELECTED adapter's own declared options, so the row and the writer finally
 *     speak one language.
 *   · **THE CONTAINMENT AXIS WRITES.** It is a declared native dimension
 *     (`runtime/selection-vocabulary.js › nativeDimensions`), stored per runtime, validated
 *     against that runtime's own options, and stamped at spawn by `session-engine.js`.
 *   · **THE APPROVAL CATEGORIES STILL DO NOT, AND THEY ARE STILL NOT CONTROLS.** The structured
 *     app-server shape is measured now; `granular` safely maps to all five categories asking.
 *     What does not exist yet is a persisted per-category bag. They remain a REPORT of the
 *     platform's own words until that product surface is deliberately added end to end.
 *
 * ⚠ **NOTHING HERE INTERPRETS A `null`.** Every question is asked of `lib/runtime-capability.ts`
 * and `lib/runtime-native.ts`, because ABSENT hides a control almost everywhere and REFUSES in
 * three places, and a component that inlines the check gets the common meaning and is silently
 * wrong at the three that matter.
 *
 * ⚠ **HIDE, NEVER GRAY** (design §3.2). Claude declares no containment axis, so that row does not
 * exist on Claude — not greyed, not a placeholder, and with no sentence explaining a sandbox
 * Claude does not have.
 *
 * ⚠ **MINIMAL COPY** (Samuel, 2026-08-19; INVARIANTS §5). A row is a NAME and a CONTROL. The
 * per-option sentences live INSIDE the `SelectMenu` dropdown, where a person reads them while
 * choosing, and they are the PLATFORM's own words off the descriptor — never Dopl's paraphrase.
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { TOOL_OPTIONS } from "./permission-preset-row";
import { SettingRow } from "./settings-agent-rows";
import {
  approvalCategories,
  approvalCategoryMode,
  freeform,
  normalizeToolMode,
  toolModeOptions,
  type RuntimeDescriptor,
} from "../lib/runtime-capability";
import {
  effectiveNative,
  type NativeDimension,
} from "../lib/runtime-native";

/** The value-only recipe this tab already uses for a fact the operator cannot set here
 *  (`settings-desktop-rows.tsx › AgentFolderRows`'s folder line). ⚠ Kit tokens only — no hex,
 *  no raw px (docs/DESIGN-SYSTEM.md). */
const VALUE_PILL =
  "truncate rounded-[8px] border border-border-subtle bg-bg-inset px-2.5 py-1 text-caption text-text-secondary";

export interface AgentToolModeRowsProps {
  /** The runtime a launch here would use, or null off-desktop / pre-runtime. */
  descriptor: RuntimeDescriptor | null;
  /** The stored Axis-A value, in whatever vocabulary it was written in. */
  tools: string;
  onChange: (next: string) => void;
  /** The native dimensions this runtime declares AND can spend. ⚠ EMPTY IS THE COMMON CASE. */
  dimensions?: ReadonlyArray<NativeDimension>;
  /** The selected runtime's stored native bag. */
  native?: Readonly<Record<string, string>>;
  /** ⚠ THE WHOLE BAG, not one key — main replaces `native` wholesale. */
  onChangeNative?: (next: Record<string, string>) => void;
  busy: boolean;
}

/**
 * AXIS A, IN THE EFFECTIVE RUNTIME'S OWN VOCABULARY — plus the rows that exist only on the
 * runtimes that declare them.
 *
 * ⚠ THE VALUE IS COERCED, NOT ECHOED. The stored `tools` is the DEFAULT runtime's vocabulary on
 * every channel written before a runtime was picked, and `manual` is not a word Codex or Cursor
 * speaks. `normalizeToolMode` lands an unrecognised value on the NARROWEST member — index 0 of
 * the declared ordering, which is the same fail-closed answer main's own read gives it — so the
 * row never names a mode the runtime will not be asked for.
 * ⚠ NO DESCRIPTOR ⇒ DOPL'S OWN FOUR. That is the older-desktop and plain-browser lane, and it
 * renders exactly what it rendered before the runtime port: `permission-preset-row.tsx ›
 * TOOL_OPTIONS`, whose per-option copy a security review bought.
 */
export function AgentToolModeRows({
  descriptor,
  tools,
  onChange,
  dimensions = [],
  native,
  onChangeNative,
  busy,
}: AgentToolModeRowsProps) {
  const declared = toolModeOptions(descriptor);
  const options: ReadonlyArray<SelectMenuOption<string>> = declared.length
    ? declared.map((o) => ({
        value: o.value,
        label: o.label,
        // ⚠ `undefined`, NEVER `""` — an empty description renders an empty second line under
        // the row (`composer-launch-panel.tsx` states the same rule over its template options).
        description: o.description ?? undefined,
      }))
    : TOOL_OPTIONS;
  const value = declared.length ? normalizeToolMode(descriptor, tools) : tools;
  const categories = approvalCategories(descriptor);
  const categoryMode = approvalCategoryMode(descriptor);
  const classifier = freeform(descriptor);

  return (
    <>
      {/* ⚠ "Permissions" → "Tool use" (2026-09-06, item 5). A RENAME ONLY — same axis, same
          options, same write, and still the EFFECTIVE RUNTIME'S OWN vocabulary off the
          descriptor. ⚠ AND THE WRITE IS REAL ON EVERY RUNTIME SINCE U5 (F-390): main validates
          the asked mode against the SELECTED adapter's declared options rather than against the
          default runtime's four words. */}
      <SettingRow name="Tool use">
        <SelectMenu<string>
          variant="text"
          value={value ?? ""}
          options={options}
          onChange={onChange}
          ariaLabel="Tool use for agents you launch"
          disabled={busy}
        />
      </SettingRow>

      {/* THE RUNTIME'S OWN NATIVE DIMENSIONS — Codex's `sandbox_mode` today.
          ⚠ THEY DO NOT EXIST ON CLAUDE (no `secondaryAxis`, no `models.dimensions`) and this
          branch is the whole of that rule: no row, no placeholder, no greyed control.
          ⚠ **AND THEY ARE CONTROLS NOW, NOT DATA** — U5 gave them a validated write path and
          `session-engine.js` stamps the bag at spawn, so the pick affects the launch. The old
          value pill is gone with the illusion it carried (F-390).
          ⚠ A DIMENSION WITH NO WRITER STILL RENDERS AS A FACT: a caller that hands no
          `onChangeNative` (a read-only mount) gets the effective value rather than a control
          that goes nowhere. */}
      {dimensions.map((dimension) => {
        const picked = effectiveNative(dimension, native?.[dimension.key]);
        return (
          <SettingRow key={dimension.key} name={dimension.label}>
            {onChangeNative ? (
              <SelectMenu<string>
                variant="text"
                value={picked}
                options={dimension.options.map((o) => ({
                  value: o.value,
                  label: o.label,
                  description: o.description ?? undefined,
                }))}
                onChange={(next) => onChangeNative({ ...native, [dimension.key]: next })}
                ariaLabel={`${dimension.label} for agents you launch`}
                disabled={busy}
              />
            ) : (
              <span className={VALUE_PILL}>
                {dimension.options.find((o) => o.value === picked)?.label ?? picked}
              </span>
            )}
          </SettingRow>
        );
      })}

      {/* THE APPROVAL CATEGORIES — under the platform's own category-granularity mode ONLY, and
          in the platform's own words.
          ⚠ NO INVENTED NAMES. `sandbox_approval` / `rules` / `mcp_elicitations` /
          `request_permissions` / `skill_approval` are Codex's, off the descriptor, rendered
          verbatim. The design's first revision declared four words of its own that appear
          nowhere in the platform's docs; the descriptor exists to stop exactly that.
          ⚠ **STILL DATA, DELIBERATELY.** The structured launch shape is measured, and selecting
          `granular` sends all five as `true`. A per-category persistence contract is not present,
          so a toggle here would still write nowhere. */}
      {categoryMode !== null && value === categoryMode && (
        <ul className="flex flex-col gap-0.5 pt-0.5" aria-label="Approval categories">
          {categories.map((c) => (
            <li
              key={c}
              className="flex min-h-[24px] items-center rounded-[8px] border border-border-subtle bg-bg-inset px-2.5 py-1 font-mono text-caption text-text-secondary"
            >
              {c}
            </li>
          ))}
        </ul>
      )}

      {/* THE CLASSIFIER INSTRUCTIONS — `null` on all three adapters today, so this renders
          nothing. It is written as data anyway because §3.1 asks for it, and because `transport`
          must be SHOWN rather than hidden: the documented home is a file Dopl would share with
          the operator and with the platform itself, which is a fact about where the operator's
          words end up and not an implementation note. */}
      {classifier && (
        <SettingRow name={classifier.label}>
          <span className={VALUE_PILL}>{classifier.transport ?? "not stored"}</span>
        </SettingRow>
      )}
    </>
  );
}
