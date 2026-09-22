"use client";

/**
 * THE SETTINGS TAB'S "WHEN YOU LAUNCH AN AGENT" GROUP, WHOLE — the runtime, the model, the
 * runtime's own native settings, Axis A in that runtime's vocabulary, and Dopl's messaging axis.
 *
 * ⚠ **ONE COMPONENT, TWO SCOPES, AND THAT IS THE POINT (2026-09-21, U8).** The per-channel
 * Settings tab and the profile popup's Agents pane render THIS component over the SAME record
 * shape (`hooks/use-launch-selection.ts`, whose header carries the argument): a second copy of
 * these rows is how the two surfaces come to offer different vocabularies for one record. What
 * differs between them is PERSISTENCE, which lives in the hook, and the messaging warning, which
 * has nothing to measure at defaults scope — see {@link AgentLaunchPostureRowsProps.onChangeMessages}.
 *
 * ⚠ **THE ROWS ARE IN DEPENDENCY ORDER, AND THE ORDER IS LOAD-BEARING** (the plan's U8):
 * **runtime → model → reasoning effort → tool use → containment → messaging**. Each row decides
 * what the rows under it MEAN — the runtime decides the model roster and the Axis-A vocabulary,
 * the model decides which reasoning efforts exist — so reading the group top to bottom is
 * "which runtime, on which model, doing what" rather than a vocabulary that changes under a
 * heading that does not. ⚠ The model rows moved ABOVE Tool use in this wave for exactly that
 * reason; they were last before.
 *
 * ⚠ **AXIS A AND THE NATIVE ROWS MOVED TO `settings-agent-native-rows.tsx`** at the §1 cap, on a
 * real seam: that file changes when a RUNTIME'S VOCABULARY changes, this one when the GROUP
 * changes. F-390's whole account lives over there, beside the controls it is about.
 *
 * ⚠ **NOTHING HERE IS DISPLAY-ONLY ANY MORE.** Every control in this group has an exercised
 * write path, which is what INVARIANTS asks for (a control that writes nowhere must be ABSENT).
 * The two things that are still FACTS rather than controls — the approval categories and the
 * classifier transport — are rendered as facts, and `settings-agent-native-rows.tsx` says why
 * each one may not become a control yet.
 *
 * ⚠ **MINIMAL COPY** (Samuel, 2026-08-19; INVARIANTS §5). A row is a NAME and a CONTROL; the
 * per-option sentences live inside the dropdown, in the PLATFORM's own words.
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { MESSAGE_OPTIONS } from "./permission-preset-row";
import { SettingRow } from "./settings-agent-rows";
import { AgentToolModeRows } from "./settings-agent-native-rows";
import type { MessageMode, PermissionPreset } from "../lib/permission-modes";
import type { PosturePatch } from "./posture-warning";
import type { LaunchSelectionState } from "../hooks/use-launch-selection";
import {
  catalogReady,
  catalogReason,
  catalogSelection,
  modelLabel,
  modelOptionsFor,
  normalizeDimensionValue,
} from "../lib/model-catalog";
import { nativeDimensions, REASONING_EFFORT } from "../lib/runtime-native";
import type { RuntimeDescriptor } from "../lib/runtime-capability";

/** The value-only recipe this tab already uses for a fact the operator cannot set here. ⚠ Kit
 *  tokens only — no hex, no raw px (docs/DESIGN-SYSTEM.md). */
const VALUE_PILL =
  "truncate rounded-[8px] border border-border-subtle bg-bg-inset px-2.5 py-1 text-caption text-text-secondary";

/** ⚠ ONE SENTENCE, and it is a FACT rather than an apology (INVARIANTS §5). It is what an unset
 *  record actually does: no `model` on the wire, so the platform picks. */
export const PLATFORM_DEFAULT_LABEL = "Platform default";

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
  const catalog = selection.catalogFor(selection.runtime || selection.defaultRuntime);
  // ⚠ WHAT THE ROW SHOWS, WHICH IS NOT WHAT IS STORED. A record that never chose SHOWS the
  // runtime's declared default and STORES nothing until somebody touches the control — the
  // display-versus-wire discipline `model-catalog.ts › catalogSelection` carries.
  const shownModel = catalogSelection(catalog, record.model);
  const dimensions = nativeDimensions(descriptor, catalog, shownModel);
  const effortDimension = dimensions.find((d) => d.key === REASONING_EFFORT) ?? null;
  const rosterReason = catalogReason(catalog);

  /**
   * ⚠ **THE MODEL AND ITS EFFORT MOVE IN ONE WRITE.** The plan asks for the effort to be
   * "normalized when the selected model does not support the previous effort"; doing it as a
   * second write would leave a window in which the record names an effort the new model refuses,
   * and would make a rejected second write look like a successful first one.
   */
  const pickModel = (next: string) => {
    const effort = effortDimension
      ? normalizeDimensionValue(catalog, next, record.native?.[REASONING_EFFORT])
      : "";
    const native = { ...record.native };
    if (effortDimension) {
      if (effort) native[REASONING_EFFORT] = effort;
      else delete native[REASONING_EFFORT];
    }
    void selection.update(
      effortDimension ? { model: next, native } : { model: next }
    );
  };

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
          // and lands a patch's fields on the runtime the PATCH selects, so restating `tools` or
          // `model` here would file the OLD runtime's words under the NEW one — which
          // `patchRejections` refuses outright, because `accept_edits` is not a word Codex
          // speaks. A bare switch changes nothing else: both remembered sets survive, which is
          // Decision #1 and the whole reason the record is runtime-keyed.
          onChange={(next) => void selection.update({ runtime: next })}
          busy={busy}
        />
      )}

      {/* THE MODEL (Samuel, 2026-08-22) — durable, per scope, and READ FROM THE SELECTED
          RUNTIME'S OWN CATALOG since U6. A Codex surface can never render Fable, because
          `model-catalog.ts › catalogFor` has no fall-back arm to another runtime's list.
          ⚠ ABSENT ON A MAIN THAT HAS NO MODEL FIELD, never disabled — such a build DROPS the
          value on write, so a greyed row would be the mild version of the failure and a live one
          the loud version.
          ⚠ A ROSTER THAT IS NOT `ready` RENDERS A FACT, NOT A CONTROL. `loading`, `unavailable`
          and `stale` all offer nothing to pick: the first has not answered, the second measured a
          failure, and the third holds models it may still LABEL with but may not newly select.
          The sentence under the row is the desktop's own words. */}
      {selection.modelSupported && (
        <SettingRow name="Model">
          {catalogReady(catalog) ? (
            <SelectMenu<string>
              variant="text"
              value={shownModel}
              options={modelOptionsFor(catalog, shownModel)}
              onChange={pickModel}
              ariaLabel="Model for agents you launch"
              disabled={busy}
            />
          ) : (
            <span className={VALUE_PILL}>
              {shownModel ? modelLabel(catalog, shownModel) : PLATFORM_DEFAULT_LABEL}
            </span>
          )}
        </SettingRow>
      )}
      {selection.modelSupported && rosterReason && (
        <p role="note" className="text-caption text-text-secondary">
          {rosterReason}
        </p>
      )}

      {/* REASONING EFFORT — beside Model, because it is a property OF the selected model and its
          options change with it (`model-catalog.ts › dimensionOptionsFor` carries why it cannot
          be sourced from the runtime).
          ⚠ ABSENT ON EVERY RUNTIME THAT DECLARES NO SUCH DIMENSION, which is two of the three
          today — hide, never gray.
          ⚠ **AND IT WRITES.** Before U5 `launch-spec.js` read a `state.reasoningEffort` that had
          NO PRODUCER anywhere in the tree; declaring `models.dimensionOptions` is what turned it
          into a storable setting, and this is its one control. */}
      {effortDimension && (
        <SettingRow name={effortDimension.label}>
          <SelectMenu<string>
            variant="text"
            value={
              record.native?.[REASONING_EFFORT] ??
              effortDimension.default ??
              effortDimension.options[0]?.value ??
              ""
            }
            options={effortDimension.options.map((o) => ({
              value: o.value,
              label: o.label,
              description: o.description ?? undefined,
            }))}
            onChange={(next) =>
              void selection.update({
                native: { ...record.native, [REASONING_EFFORT]: next },
              })
            }
            ariaLabel={`${effortDimension.label} for agents you launch`}
            disabled={busy}
          />
        </SettingRow>
      )}

      <AgentToolModeRows
        descriptor={selection.runtimeSupported ? descriptor : null}
        tools={record.tools ?? ""}
        onChange={(tools) => void selection.update({ tools })}
        // ⚠ THE CONTAINMENT AXIS ONLY. The model dimension has its own row above, beside the
        // model it belongs to; rendering it twice would be two controls over one field.
        dimensions={dimensions.filter((d) => d.kind === "containment")}
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
export const RUNTIME_DEFAULT = "";

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
export function AgentRuntimeRow({
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

/** ⚠ RE-EXPORTED so `settings-agent-runtime.test.tsx` and any caller that imported it from here
 *  did not move with the §1 split. `settings-agent-native-rows.tsx` is the file. */
export { AgentToolModeRows } from "./settings-agent-native-rows";

/** ⚠ KEPT FOR THE TYPE'S CALLERS. The group no longer takes a `PermissionPreset` — it takes the
 *  versioned record — but `settings-agent.tsx` still reads the pair for the messaging warning. */
export type { PermissionPreset };
