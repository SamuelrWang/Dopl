"use client";

/**
 * The launch-posture group — one component for the channel Settings tab and the profile Agents pane,
 * over one record shape (`hooks/use-launch-selection.ts`). Rows: runtime → permissions → messaging.
 * Permissions is ONE control (Ask / Auto / Full) for every runtime; each runtime applies it in its
 * own settings, and Details shows that reading, in main's words (`permissionLevels`), never derived here.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { LEVEL_OPTIONS, MESSAGE_OPTIONS } from "./permission-preset-row";
import { SettingRow } from "./settings-agent-rows";
import type { MessageMode } from "../lib/permission-modes";
import type { PermissionLevel } from "../lib/launch-selection";
import type { PosturePatch } from "./posture-warning";
import type { LaunchSelectionState } from "../hooks/use-launch-selection";
import type { RuntimeDescriptor } from "../lib/runtime-capability";

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
  const { busy } = selection;

  return (
    <>
      {selection.runtimeSupported && (
        <AgentRuntimeRow
          runtime={selection.runtime}
          runtimes={selection.runtimes}
          onChange={(next) => void selection.update({ runtime: next })}
          busy={busy}
        />
      )}

      <SettingRow name="Permissions">
        <SelectMenu<PermissionLevel>
          variant="text"
          value={selection.level}
          options={LEVEL_OPTIONS}
          onChange={(level) => void selection.update({ level })}
          ariaLabel="Permissions for agents you launch"
          disabled={busy}
        />
      </SettingRow>
      {selection.runtimeSupported && <PermissionDetails selection={selection} />}

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

/** Each runtime's own reading of its level; collapsed, because the level is the setting. */
function PermissionDetails({ selection }: { selection: LaunchSelectionState }) {
  const [open, setOpen] = useState(false);
  const rows = selection.runtimes.flatMap((d) => {
    const s = selection.settingFor(d.id);
    return s ? [{ d, s }] : [];
  });
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 self-start text-caption text-text-muted hover:text-text-secondary"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Details
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5" aria-label="Permissions by runtime">
          {rows.map(({ d, s }) => (
            <li
              key={d.id}
              className="flex min-h-[24px] items-center justify-between gap-2 rounded-[8px] border border-border-subtle bg-bg-inset px-2.5 py-1 text-caption text-text-secondary"
            >
              <span>
                {d.label} · {s.label}
              </span>
              <span className="font-mono text-text-muted">{s.setting}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
