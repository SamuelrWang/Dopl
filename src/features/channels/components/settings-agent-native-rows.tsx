"use client";

/**
 * Tool use (Axis A) in the selected runtime's own vocabulary, plus the native rows that runtime
 * declares. Undeclared rows are absent, never greyed; option copy is the platform's, off the descriptor.
 * Capability questions go to `lib/runtime-capability.ts` / `lib/runtime-native.ts`; never inline a
 * null check (absent hides almost everywhere but refuses in a few places).
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { TOOL_OPTIONS } from "./permission-preset-row";
import { SettingRow } from "./settings-agent-rows";
import {
  approvalCategories,
  approvalCategoryMode,
  normalizeToolMode,
  toolModeOptions,
  type RuntimeDescriptor,
} from "../lib/runtime-capability";
import {
  effectiveNative,
  type NativeDimension,
} from "../lib/runtime-native";

export interface AgentToolModeRowsProps {
  /** The runtime a launch here would use, or null off-desktop / pre-runtime. */
  descriptor: RuntimeDescriptor | null;
  /** The stored Axis-A value, in whatever vocabulary it was written in. */
  tools: string;
  onChange: (next: string) => void;
  /** The native dimensions this runtime declares and can spend; usually empty. */
  dimensions?: ReadonlyArray<NativeDimension>;
  /** The selected runtime's stored native bag. */
  native?: Readonly<Record<string, string>>;
  /** Must send the WHOLE bag: main replaces `native` wholesale. */
  onChangeNative: (next: Record<string, string>) => void;
  busy: boolean;
}

/**
 * An unrecognised stored value renders as the runtime's narrowest option (index 0) — the same
 * fail-closed answer main gives. No declared options ⇒ `TOOL_OPTIONS`, value shown as stored.
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
        // `undefined`, never `""`: an empty description renders an empty second line.
        description: o.description ?? undefined,
      }))
    : TOOL_OPTIONS;
  const value = declared.length ? normalizeToolMode(descriptor, tools) : tools;
  const categories = approvalCategories(descriptor);
  const categoryMode = approvalCategoryMode(descriptor);

  return (
    <>
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

      {dimensions.map((dimension) => (
        <SettingRow key={dimension.key} name={dimension.label}>
          <SelectMenu<string>
            variant="text"
            value={effectiveNative(dimension, native?.[dimension.key])}
            options={dimension.options.map((o) => ({
              value: o.value,
              label: o.label,
              description: o.description ?? undefined,
            }))}
            onChange={(next) => onChangeNative({ ...native, [dimension.key]: next })}
            ariaLabel={`${dimension.label} for agents you launch`}
            disabled={busy}
          />
        </SettingRow>
      ))}

      {/* Approval categories are a report, not controls: there is no per-category write path.
          Names are the platform's own, verbatim. */}
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
    </>
  );
}
