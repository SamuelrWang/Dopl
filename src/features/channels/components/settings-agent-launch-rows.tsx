"use client";

/**
 * The launch-posture group — one component for the channel Settings tab and the profile Agents pane,
 * over one record shape (`hooks/use-launch-selection.ts`). Rows in dependency order: runtime → tool
 * use → containment → messaging; the runtime decides the vocabulary of the rows under it, in the
 * platform's own words, and undeclared rows are absent, never greyed. No model row: main resolves a
 * launch's model (`main/runtime/launch-default.js`); the record stores none.
 * Capability questions go to `lib/runtime-capability.ts` / `lib/runtime-native.ts`; never inline a
 * null check (absent hides almost everywhere but refuses in a few places).
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "./permission-preset-row";
import { SettingRow } from "./settings-agent-rows";
import type { MessageMode } from "../lib/permission-modes";
import type { PosturePatch } from "./posture-warning";
import type { LaunchSelectionState } from "../hooks/use-launch-selection";
import {
  effectiveNative,
  nativeDimensions,
  type NativeDimension,
} from "../lib/runtime-native";
import {
  approvalCategories,
  approvalCategoryMode,
  normalizeToolMode,
  toolModeOptions,
  type RuntimeDescriptor,
} from "../lib/runtime-capability";

export interface AgentLaunchPostureRowsProps {
  /** The record at this scope, and the only writer of every field below. */
  selection: LaunchSelectionState;
  /** Routes the Messaging write through the channel's posture warning. Absent (defaults pane, no
   *  roster) ⇒ the write goes straight to the record. */
  onChangeMessages?: (patch: PosturePatch) => void;
}

/** The durable launch posture; the caller renders nothing without a bridge. Supervision, not
 *  containment: the channel's tool profile and `SESSION_HARD_DENY` still bound it. */
export function AgentLaunchPostureRows({
  selection,
  onChangeMessages,
}: AgentLaunchPostureRowsProps) {
  const { descriptor, record, busy } = selection;
  // With no catalog or model, `nativeDimensions` yields only the runtime's containment axis, or nothing.
  const dimensions = nativeDimensions(descriptor, null, null).filter((d) => d.kind === "containment");

  return (
    <>
      {selection.runtimeSupported && (
        <AgentRuntimeRow
          runtime={selection.runtime}
          runtimes={selection.runtimes}
          // Write `{runtime}` only: restating `tools` would file the old runtime's word under the new
          // one, and main's `patchRejections` refuses the write.
          onChange={(next) => void selection.update({ runtime: next })}
          busy={busy}
        />
      )}

      <AgentToolModeRows
        descriptor={selection.runtimeSupported ? descriptor : null}
        tools={record.tools ?? ""}
        onChange={(tools) => void selection.update({ tools })}
        dimensions={dimensions}
        native={record.native}
        onChangeNative={(native) => void selection.update({ native })}
        busy={busy}
      />

      {/* Dopl's axis: its vocabulary does not move with the runtime
          (`main/launch-selection.js › SELECTION_MESSAGE_MODES`). */}
      <SettingRow name="Messaging">
        <SelectMenu<MessageMode>
          variant="text"
          value={selection.messages as MessageMode}
          options={MESSAGE_OPTIONS}
          onChange={(messages) => {
            if (onChangeMessages) onChangeMessages({ messages });
            else void selection.update({ messages });
          }}
          ariaLabel="Messaging for agents you launch"
          disabled={busy}
        />
      </SettingRow>

      {/* Main's refusals, verbatim: the write failed closed before the store, so the rows alone
          would look unchanged. */}
      {selection.rejected.map((line) => (
        <p key={line} role="alert" className="text-caption text-danger">
          {line}
        </p>
      ))}

      {/* Review lines are notes (the settings are already the narrower ones), not failures. */}
      {selection.review.map((line) => (
        <p key={line} role="note" className="text-caption text-warning">
          {line}
        </p>
      ))}
    </>
  );
}

/** The default adapter. `''` is the wire's own spelling — main answers `''` for an absent, cleared
 *  or unregistered pick; never mint a `"default"` sentinel. */
const RUNTIME_DEFAULT = "";

/** Names the act, not the default vendor — that would read as a pick nobody made. */
const RUNTIME_DEFAULT_LABEL = "Default";

/** Absent with no registered runtimes (INVARIANTS §5): an older main drops the field on write. */
function AgentRuntimeRow({
  runtime,
  runtimes,
  onChange,
  busy,
}: {
  /** `''` = the default adapter. */
  runtime: string;
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  onChange: (next: string) => void;
  busy: boolean;
}) {
  if (!runtimes.length) return null;
  // Default first, then registry order (`runtime/index.js › all`): the registry's first entry IS
  // the default adapter, so never sort.
  const options: ReadonlyArray<SelectMenuOption<string>> = [
    { value: RUNTIME_DEFAULT, label: RUNTIME_DEFAULT_LABEL },
    ...runtimes.map((d) => ({ value: d.id, label: d.label })),
  ];
  return (
    <SettingRow name="Runtime">
      <SelectMenu<string>
        variant="text"
        value={runtime}
        options={options}
        onChange={onChange}
        ariaLabel="Runtime for agents you launch"
        disabled={busy}
      />
    </SettingRow>
  );
}

interface AgentToolModeRowsProps {
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
function AgentToolModeRows({
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
