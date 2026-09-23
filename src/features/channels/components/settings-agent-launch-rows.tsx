"use client";

/**
 * THE SETTINGS TAB'S "WHEN YOU LAUNCH AN AGENT" GROUP, WHOLE — the runtime, Axis A in that
 * runtime's vocabulary, the runtime's own CONTAINMENT setting, and Dopl's messaging axis.
 *
 * 🔓 **NO MODEL ROW AND NO REASONING-EFFORT ROW SINCE 2026-09-23 (Samuel, verbatim):** *"We don't
 * need a pin model in the settings. Basically, when an agent is created, either the agent will
 * choose it, or the agent is launched by another agent. That model will be chosen by the agent,
 * or you can just have it go to the default model. It's fine. We don't need this model, channel,
 * and profile settings."* A launch's model is the launcher's pick (the New Agent dialog, an MCP
 * `model`), else the identity's, else the runtime's own default — resolved in main
 * (`main/runtime/launch-default.js`). The effort row went with it: it is a property OF a model.
 * The desktop no longer stores either (`main/launch-selection.js › normalizeRuntimeRecord`).
 *
 * ⚠ **ONE COMPONENT, TWO SCOPES, AND THAT IS THE POINT (2026-09-21, U8).** The per-channel
 * Settings tab and the profile popup's Agents pane render THIS component over the SAME record
 * shape (`hooks/use-launch-selection.ts`, whose header carries the argument): a second copy of
 * these rows is how the two surfaces come to offer different vocabularies for one record. What
 * differs between them is PERSISTENCE, which lives in the hook, and the messaging warning, which
 * has nothing to measure at defaults scope — see {@link AgentLaunchPostureRowsProps.onChangeMessages}.
 *
 * ⚠ **THE ROWS ARE IN DEPENDENCY ORDER, AND THE ORDER IS LOAD-BEARING** (the plan's U8):
 * **runtime → tool use → containment → messaging**. The runtime decides the Axis-A vocabulary and
 * which containment axis exists, so reading the group top to bottom is "which runtime, doing
 * what" rather than a vocabulary that changes under a heading that does not.
 *
 * ⚠ **AXIS A AND THE NATIVE ROWS LIVE IN `settings-agent-native-rows.tsx`** at the §1 cap, on a
 * real seam: that file changes when a RUNTIME'S VOCABULARY changes, this one when the GROUP
 * changes. F-390's whole account lives over there, beside the controls it is about.
 *
 * ⚠ **NOTHING HERE IS DISPLAY-ONLY.** Every control in this group has an exercised write path,
 * which is what INVARIANTS asks for (a control that writes nowhere must be ABSENT).
 *
 * ⚠ **MINIMAL COPY** (Samuel, 2026-08-19; INVARIANTS §5). A row is a NAME and a CONTROL; the
 * per-option sentences live inside the dropdown, in the PLATFORM's own words.
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { MESSAGE_OPTIONS } from "./permission-preset-row";
import { SettingRow } from "./settings-agent-rows";
import { AgentToolModeRows } from "./settings-agent-native-rows";
import type { MessageMode } from "../lib/permission-modes";
import type { PosturePatch } from "./posture-warning";
import type { LaunchSelectionState } from "../hooks/use-launch-selection";
import { nativeDimensions } from "../lib/runtime-native";
import type { RuntimeDescriptor } from "../lib/runtime-capability";

export interface AgentLaunchPostureRowsProps {
  /** The record at THIS scope, and the only writer of every field below. */
  selection: LaunchSelectionState;
  /**
   * WHERE THE MESSAGING WRITE GOES.
   *
   * ⚠ **IT IS A SEPARATE CALLBACK BECAUSE ONE SCOPE GATES IT AND THE OTHER CANNOT.**
   * `posture-warning.tsx` fires on `auto_both` + `full` + **a peer in the room** — a statement
   * about a specific channel's roster. The profile-defaults pane has no channel and therefore no
   * roster, so it passes nothing and the write goes straight to the record. A warning shown over
   * "there might one day be someone in some room" is a dialog an operator learns to dismiss.
   */
  onChangeMessages?: (patch: PosturePatch) => void;
}

/**
 * THE DURABLE LAUNCH POSTURE — 2026-08-20, and it replaced the single-use ARM on this tab.
 * Absent entirely in a plain browser: the caller renders nothing without a bridge, so there are
 * no dead rows.
 *
 * ⚠ THIS GROUP IS THE ONLY PERMISSION POSTURE IN THE PRODUCT, it is DURABLE, and it is read at
 * exactly ONE call site: `session-ipc-ops.js › sessions:launch`, the Launch button the operator
 * is pressing on their own thread. H2 still holds and still holds BY CONSUMER COUNT — an inbound
 * request a peer triggered carries no tool posture at all and starts at the narrowest.
 * `main/channel-prefs.js` is the statement of record.
 *
 * ⚠ IT IS SUPERVISION, NEVER CONTAINMENT. The widest Axis-A mode stays bounded by the channel's
 * tool profile and by `main/session-profiles.js › SESSION_HARD_DENY`, and Axis B still refuses to
 * let any tool posture send a message.
 */
export function AgentLaunchPostureRows({
  selection,
  onChangeMessages,
}: AgentLaunchPostureRowsProps) {
  const { descriptor, record, busy } = selection;
  // ⚠ THE CONTAINMENT AXIS ONLY. `nativeDimensions` answers a MODEL dimension only when it is
  // handed a catalog and a model, and this group has neither since the Model row left — so what
  // comes back is exactly the runtime's containment setting (Codex's sandbox), or nothing.
  const dimensions = nativeDimensions(descriptor, null, null).filter((d) => d.kind === "containment");

  return (
    <>
      {/* ⚠ THE GROUP LABEL IS DELETED (2026-09-06, Samuel's settings overhaul, item 2).
          `LAUNCH_POSTURE_HEADING` — "When you launch an agent" — is retained as an EXPORTED
          CONSTANT with its argument intact, because that argument is still true and is what the
          eye popover for these rows says; what changed is that it is no longer RENDERED as a
          standing heading. Do not read the deleted heading as a changed scope. */}
      {selection.runtimeSupported && (
        <AgentRuntimeRow
          runtime={selection.runtime}
          runtimes={selection.runtimes}
          // ⚠ **THE PICK, AND NOTHING ELSE, ON THE `runtime` KEY ALONE.** Main's write is own-key
          // and lands a patch's fields on the runtime the PATCH selects, so restating `tools` here
          // would file the OLD runtime's words under the NEW one — which `patchRejections` refuses
          // outright, because `accept_edits` is not a word Codex speaks. A bare switch changes
          // nothing else: both remembered sets survive, which is Decision #1 and the whole reason
          // the record is runtime-keyed.
          onChange={(next) => void selection.update({ runtime: next })}
          busy={busy}
        />
      )}

      {/* ⚠ THE MODEL ROW, ITS ROSTER NOTE AND THE REASONING-EFFORT ROW STOOD HERE AND ARE DELETED
          (2026-09-23) — see the header. Do not put a model control back on either scope: the
          record behind it no longer exists, so it would be a control that writes nowhere. */}

      <AgentToolModeRows
        descriptor={selection.runtimeSupported ? descriptor : null}
        tools={record.tools ?? ""}
        onChange={(tools) => void selection.update({ tools })}
        dimensions={dimensions}
        native={record.native}
        onChangeNative={(native) => void selection.update({ native })}
        busy={busy}
      />

      {/* ⚠ "Sends" → "Messaging" (2026-09-06, Samuel's pick, item 7). A RENAME ONLY: the field,
          the enum and the write are the record's `messages` exactly as before. The new name is
          the axis's own — it covers BOTH directions, which "Sends" did not.
          ⚠ IT IS DOPL'S AXIS AND ITS VOCABULARY DOES NOT MOVE WITH THE RUNTIME: Dopl, not either
          vendor, gates channel delivery (`main/launch-selection.js › SELECTION_MESSAGE_MODES`). */}
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

      {/* ⚠ **A REFUSED WRITE IS SAID OUT LOUD, BECAUSE NOTHING ELSE WILL.** Main fails closed
          BEFORE the store, so the rows simply keep showing the stored values — which is correct
          and is also indistinguishable from a control that did nothing. These are main's own
          sentences, never a paraphrase. */}
      {selection.rejected.map((line) => (
        <p key={line} role="alert" className="text-caption text-danger">
          {line}
        </p>
      ))}

      {/* ⚠ **`needsReview` IS NEVER A FAILURE OF THE READ** (`channel-dir-ipc.js ›
          channels:getLaunchPosture` states the same rule from main's side): the settings it
          describes are already the NARROWER ones, so the operator is being told what changed
          under them rather than that something broke. A note, not an alert. */}
      {selection.review.map((line) => (
        <p key={line} role="note" className="text-caption text-warning">
          {line}
        </p>
      ))}
    </>
  );
}

/**
 * "No pick" — the DEFAULT adapter, and a REAL option rather than a placeholder.
 *
 * ⚠ `""` BECAUSE THAT IS THE WIRE'S OWN SPELLING, not because `SelectMenu` is `<T extends
 * string>`. `main/launch-selection.js › patchSelection` answers `''` for an absent, cleared or
 * unregistered pick, so a channel that never chose and a channel whose pick was cleared are ONE
 * record — and minting a `"default"` sentinel here would put a value on the wire main has to
 * special-case.
 */
const RUNTIME_DEFAULT = "";

/** ⚠ It names the ACT, not a vendor: which adapter a launch lands on when the operator has
 *  expressed no preference. The default's own label is not used — that would read as a pick
 *  nobody made. */
const RUNTIME_DEFAULT_LABEL = "Default";

/**
 * THE RUNTIME PICKER. Absent entirely on a desktop with no runtime concept and on a build that
 * registered no adapters — the no-dead-rows rule (INVARIANTS §5), and here the stronger version
 * of it: an older main DROPS the field on write, so the pick would appear to save and every
 * launch would ignore it.
 */
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
  // ⚠ DEFAULT FIRST, AND THE REST IN REGISTRY ORDER — the order main enumerates them in
  // (`runtime/index.js › all`), never alphabetised. The registry's first entry IS the default
  // adapter, so re-sorting here would put the same runtime in two places under two names.
  const options: ReadonlyArray<SelectMenuOption<string>> = [
    { value: RUNTIME_DEFAULT, label: RUNTIME_DEFAULT_LABEL },
    // ⚠ THE PLATFORM'S OWN LABEL, off the descriptor. Dopl does not rename a vendor's product,
    // and a second table of names here is the drift `lib/agent-models.ts` states the rule against.
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
