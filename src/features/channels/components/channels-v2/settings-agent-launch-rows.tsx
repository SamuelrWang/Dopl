"use client";

/**
 * THE SETTINGS TAB'S "WHEN YOU LAUNCH AN AGENT" GROUP, WHOLE — the runtime, Axis
 * A in THAT runtime's own vocabulary, Axis B, and the model (2026-08-31, the
 * runtime-adapter port, design §3.1).
 *
 * ⚠ ITS OWN FILE FOR THE REASON `settings-agent-rows.tsx` IS (INVARIANTS §1).
 * `settings-agent.tsx` was at 485 of the 500 cap and changes when a SETTING is
 * added to the tab; this changes when the DESCRIPTOR's §3 surface changes — a
 * different clock, and one that will move again the day `secondaryAxis` or
 * `freeform` gains a write path.
 * ⚠ THE GROUP MOVED WHOLE RATHER THAN THE RUNTIME ROW ARRIVING ALONE, and that
 * is the §1 seam rather than a line-count dodge: the runtime DECIDES the Axis-A
 * vocabulary rendered under it, so a split that left the Permissions row behind
 * would put one decision in two files and guarantee they drift. Every row below
 * is the one `settings-agent.tsx` rendered, with its docblock, except where this
 * header says otherwise.
 *
 * ⚠ NOTHING HERE INTERPRETS A `null`. Every question is asked of
 * `lib/runtime-capability.ts`, the web's mirror of
 * `dopl-desktop-app/main/runtime/capability.js` and the only module on this side
 * allowed to read a descriptor's absences — because ABSENT hides a control almost
 * everywhere and REFUSES in three places, and a component that inlines the check
 * gets the common meaning and is silently wrong at the three that matter.
 *
 * ⚠ HIDE, NEVER GRAY (§3.2). Claude has no `secondaryAxis`, so the sandbox row
 * does not exist on Claude — not greyed, not a placeholder, and with no sentence
 * explaining a sandbox Claude does not have. `freeform` is `null` on all three
 * adapters today, so that branch renders nothing at all; it is written as data
 * anyway because §3.1 asks for it and because `transport` must be SHOWN rather
 * than hidden if it ever ships.
 *
 * ── ⚠ WHAT THE WIRE CARRIES, AND WHAT IT DOES NOT (F-390) ────────────────────
 *
 * `channels:setLaunchPosture` stores FOUR things: the two axes, the model, and —
 * since this port — the RUNTIME. It stores no sandbox mode and no per-category
 * approval, and `main/channel-prefs.js › normalizePreset` validates the TOOLS
 * axis against a frozen `['manual','accept_edits','auto','bypass']`, which is the
 * DEFAULT runtime's vocabulary (`main/session-profiles.js › TOOL_MODES` is
 * literally `cap.toolModes(descriptorFor(null))`). So:
 *
 *   · the RUNTIME row is a live control and persists — that is this port's field;
 *   · the PERMISSIONS row renders the effective runtime's own options, and its
 *     write is refused by main on any runtime whose vocabulary is not the
 *     default's. `main/session-profiles.js` names that as a later step in its own
 *     words ("a step-5 change, not a step-3 one"); F-390 records it.
 *   · SANDBOX and the APPROVAL CATEGORIES have no wire field at all, so they are
 *     rendered as DATA — the value the runtime will use, in the runtime's own
 *     word — and NOT as controls. A control that writes nowhere is the failure
 *     `settings-agent.tsx`'s docblock calls "the loud version": the operator
 *     picks, the write "succeeds", and every agent launches on something else.
 *
 * ⚠ MINIMAL COPY (Samuel, 2026-08-19; INVARIANTS §5). A row is a NAME and a
 * CONTROL. The per-option sentences live INSIDE the `SelectMenu` dropdown, where
 * a person reads them while choosing, and they are the PLATFORM's own words off
 * the descriptor — never Dopl's paraphrase of them.
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "../permission-preset-row";
import {
  AGENT_MODEL_DEFAULT,
  AGENT_MODEL_OPTIONS,
} from "../../lib/agent-models";
import type {
  MessageMode,
  PermissionPreset,
} from "../../lib/permission-modes";
import type { PosturePatch } from "./posture-warning";
import {
  approvalCategories,
  approvalCategoryMode,
  freeform,
  normalizeToolMode,
  secondaryAxis,
  toolModeOptions,
  type RuntimeDescriptor,
} from "../../lib/runtime-capability";
import { GroupLabel, LAUNCH_POSTURE_HEADING, SettingRow } from "./settings-agent-rows";

/** What the group needs, and every desktop-only half of it separately gated. */
export interface AgentLaunchPostureRowsProps {
  posture: PermissionPreset;
  /** True while a posture write is in flight — every select goes inert. */
  busy: boolean;
  onChange: (patch: PosturePatch) => void;
  /** This desktop understands the posture record's `model` field — see
   *  `settings-agent.tsx`, which states why FALSE renders no model row. */
  modelSupported: boolean;
  /**
   * THIS DESKTOP HAS A RUNTIME CONCEPT (`runtime-capability.ts › hasRuntimeKey`).
   * ⚠ FALSE RENDERS NO RUNTIME ROW AT ALL — `modelSupported`'s rule, for
   * `modelSupported`'s reason: an older main drops the field on write, so the
   * pick would appear to save and every launch would ignore it.
   */
  runtimeSupported: boolean;
  /** The channel's pick, `''` for the default adapter. */
  runtime: string;
  /** Every adapter this desktop registered, in registry order. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  /** The descriptor a launch here would use — the pick, else the default, else
   *  null. ⚠ ONE OBJECT, so no row can render one runtime's vocabulary against
   *  another's refusals. */
  descriptor: RuntimeDescriptor | null;
}

/**
 * THE DURABLE LAUNCH POSTURE — 2026-08-20, AND IT REPLACED THE ARM ON THIS TAB.
 * Absent entirely in a plain browser: the caller renders nothing without a
 * bridge, so there are no dead rows.
 *
 * ⚠ WHAT CHANGED AND WHY. These selects used to write the SINGLE-USE ARM, under
 * the launch panel's own heading, on the reasoning that one sentence must not
 * drift into two. The heading was carrying the entire distinction — and it could
 * not. The rows sat among the durable group below (tool profile, folder,
 * auto-send), so the operator read them as settings, picked Bypass, and got
 * manual/ask on every session after the first: the arm was spent by the launch
 * that consumed it and expired 30 minutes later, while this control went on
 * displaying the value they chose. A fuse drawn as a switch is worse than either.
 *
 * ⚠ AND THEN THE ARM WAS DELETED OUTRIGHT (2026-08-20, Samuel's ruling). When it
 * left this tab it was said to have "gone back to the request card" — and that
 * card's inbound branch had already stopped rendering at the 2026-08-18 consent
 * rewrite, so it went nowhere and nothing could arm it (F-233). THIS GROUP IS NOW
 * THE ONLY PERMISSION POSTURE IN THE PRODUCT, it is durable, and it is read at
 * exactly ONE call site: `session-ipc-ops.js › sessions:launch`, the Launch
 * button the operator is pressing on their own thread. H2 still holds and still
 * holds BY CONSUMER COUNT — an inbound request a peer triggered carries no tool
 * posture at all and starts at manual/ask. `main/channel-prefs.js` is the
 * statement of record.
 *
 * ⚠ THE RUNTIME ROW IS FIRST BECAUSE IT DECIDES WHAT THE ROW BELOW SAYS. Axis A
 * is rendered from `descriptor.toolMode.options`, so re-reading the group top to
 * bottom is "which runtime, then what it may do" rather than a vocabulary that
 * changes under a heading that does not.
 */
export function AgentLaunchPostureRows({
  posture,
  busy,
  onChange,
  modelSupported,
  runtimeSupported,
  runtime,
  runtimes,
  descriptor,
}: AgentLaunchPostureRowsProps) {
  return (
    <>
      <GroupLabel>{LAUNCH_POSTURE_HEADING}</GroupLabel>
      {runtimeSupported && (
        <AgentRuntimeRow
          runtime={runtime}
          runtimes={runtimes}
          onChange={(next) => onChange({ runtime: next })}
          busy={busy}
        />
      )}
      <AgentToolModeRows
        descriptor={runtimeSupported ? descriptor : null}
        tools={posture.tools}
        // ⚠ THE CAST IS THE BOUNDARY, AND IT IS DELIBERATE. `PermissionPreset.tools`
        // is Dopl's own closed enum, which main re-validates HARD; a runtime's own
        // Axis-A word is a wider string that main refuses today (F-390). Widening
        // `ToolMode` to `string` to avoid the cast would delete the only compile-time
        // statement that the DEFAULT lane has a closed vocabulary.
        onChange={(tools) =>
          onChange({ tools: tools as PermissionPreset["tools"] })
        }
        busy={busy}
      />
      <SettingRow name="Sends">
        <SelectMenu<MessageMode>
          value={posture.messages}
          options={MESSAGE_OPTIONS}
          onChange={(messages) => onChange({ messages })}
          ariaLabel="Sends for agents you launch"
          disabled={busy}
        />
      </SettingRow>
      {/* THE MODEL (Samuel, 2026-08-22) — durable, per channel, and read at the
          same one call site the two axes are.
          ⚠ IT SITS IN THIS GROUP AND NOT THE DURABLE ONE BELOW IT, and the
          heading is why: "When you launch an agent" governs the launches the
          OPERATOR starts, which is exactly the scope of this pick.
          ⚠ ABSENT ON A MAIN THAT HAS NO MODEL FIELD, never disabled — such a
          build DROPS the value on write, so a greyed row would be the mild
          version of the failure and a live one the loud version.
          ⚠ "Default" IS A REAL PICK and writes NO id. `lib/agent-models.ts` owns
          the roster and is the ONE place an id becomes a label. */}
      {modelSupported && (
        <SettingRow name="Model">
          <SelectMenu<string>
            value={posture.model ?? AGENT_MODEL_DEFAULT}
            options={AGENT_MODEL_OPTIONS}
            onChange={(model) => onChange({ model: model || null })}
            ariaLabel="Model for agents you launch"
            disabled={busy}
          />
        </SettingRow>
      )}
    </>
  );
}

/**
 * "No pick" — the DEFAULT adapter, and a REAL option rather than a placeholder.
 *
 * ⚠ `""` BECAUSE THAT IS THE WIRE'S OWN SPELLING, not because `SelectMenu` is
 * `<T extends string>`. `main/channel-runtime.js › normalizeRuntimeId` answers
 * `''` for an absent, cleared or unregistered pick, so a channel that never chose
 * and a channel whose pick was cleared are ONE record — and minting a `"default"`
 * sentinel here would put a value on the wire main has to special-case.
 */
export const RUNTIME_DEFAULT = "";

/** ⚠ It names the ACT, not a vendor: which adapter a launch lands on when the
 *  operator has expressed no preference. The default's own label is not used —
 *  that would read as a pick nobody made. */
const RUNTIME_DEFAULT_LABEL = "Default";

/** The value-only recipe this tab already uses for a fact the operator cannot
 *  set here (`settings-desktop-rows.tsx › AgentFolderRows`'s folder line). ⚠ Kit
 *  tokens only — no hex, no raw px (docs/DESIGN-SYSTEM.md). */
const VALUE_PILL =
  "truncate rounded-[8px] border border-border-subtle bg-bg-inset px-2.5 py-1 text-caption text-text-secondary";

/**
 * THE RUNTIME PICKER. Absent entirely on a desktop with no runtime concept and on
 * a build that registered no adapters — the no-dead-rows rule (INVARIANTS §5),
 * and here the stronger version of it: an older main DROPS the field on write, so
 * the pick would appear to save and every launch would ignore it.
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
  // ⚠ DEFAULT FIRST, AND THE REST IN REGISTRY ORDER — the order main enumerates
  // them in (`runtime/index.js › all`), never alphabetised. The registry's first
  // entry IS the default adapter, so re-sorting here would put the same runtime
  // in two places under two names.
  const options: ReadonlyArray<SelectMenuOption<string>> = [
    { value: RUNTIME_DEFAULT, label: RUNTIME_DEFAULT_LABEL },
    // ⚠ THE PLATFORM'S OWN LABEL, off the descriptor. Dopl does not rename a
    // vendor's product, and a second table of names here is the drift
    // `lib/agent-models.ts` states the rule against.
    ...runtimes.map((d) => ({ value: d.id, label: d.label })),
  ];
  return (
    <SettingRow name="Runtime">
      <SelectMenu<string>
        value={runtime}
        options={options}
        onChange={onChange}
        ariaLabel="Runtime for agents you launch"
        disabled={busy}
      />
    </SettingRow>
  );
}

/**
 * AXIS A, IN THE EFFECTIVE RUNTIME'S OWN VOCABULARY — plus the rows that exist
 * only on the runtimes that declare them.
 *
 * ⚠ THE VALUE IS COERCED, NOT ECHOED. The stored `tools` is Claude-shaped on
 * every channel written before a runtime was picked, and `manual` is not a word
 * Codex or Cursor speaks. `normalizeToolMode` lands an unrecognised value on the
 * NARROWEST member — index 0 of the declared ordering, which is the same
 * fail-closed answer main's own coercion gives it — so the row never names a mode
 * the runtime will not be asked for.
 * ⚠ NO DESCRIPTOR ⇒ DOPL'S OWN FOUR. That is the older-desktop and plain-browser
 * lane, and it must render exactly what it rendered before this port:
 * `permission-preset-row.tsx › TOOL_OPTIONS`, whose per-option copy a security
 * review bought.
 */
export function AgentToolModeRows({
  descriptor,
  tools,
  onChange,
  busy,
}: {
  /** The runtime a launch here would use, or null off-desktop / pre-runtime. */
  descriptor: RuntimeDescriptor | null;
  /** The stored Axis-A value, in whatever vocabulary it was written in. */
  tools: string;
  onChange: (next: string) => void;
  busy: boolean;
}) {
  const declared = toolModeOptions(descriptor);
  const options: ReadonlyArray<SelectMenuOption<string>> = declared.length
    ? declared.map((o) => ({
        value: o.value,
        label: o.label,
        // ⚠ `undefined`, NEVER `""` — an empty description renders an empty
        // second line under the row (`composer-launch-panel.tsx` states the same
        // rule over its template options).
        description: o.description ?? undefined,
      }))
    : TOOL_OPTIONS;
  const value = declared.length ? normalizeToolMode(descriptor, tools) : tools;
  const secondary = secondaryAxis(descriptor);
  const categories = approvalCategories(descriptor);
  const categoryMode = approvalCategoryMode(descriptor);
  const classifier = freeform(descriptor);

  return (
    <>
      <SettingRow name="Permissions">
        <SelectMenu<string>
          value={value ?? ""}
          options={options}
          onChange={onChange}
          ariaLabel="Permissions for agents you launch"
          disabled={busy}
        />
      </SettingRow>

      {/* THE SECOND AXIS — Codex's `sandbox_mode`, Cursor's `sandbox`.
          ⚠ IT DOES NOT EXIST ON CLAUDE (`secondaryAxis: null`) and this branch
          is the whole of that rule: no row, no placeholder, no greyed control.
          ⚠ AND IT IS DATA, NOT A CONTROL, TODAY — the wire has no field for it
          (F-390). The value shown is the runtime's own declared default, which
          is what `runtime/<id>/launch-spec.js › nativePair` reads when nothing
          has set one, so the row states what will actually happen. */}
      {secondary && (
        <SettingRow name={secondary.label}>
          <span className={VALUE_PILL}>{secondaryValueLabel(secondary)}</span>
        </SettingRow>
      )}

      {/* THE FIVE APPROVAL CATEGORIES — under the platform's own category-
          granularity mode ONLY, and in the platform's own words.
          ⚠ NO INVENTED NAMES. `sandbox_approval` / `rules` / `mcp_elicitations`
          / `request_permissions` / `skill_approval` are Codex's, off the
          descriptor, rendered verbatim. The design's first revision declared
          four words of its own that appear nowhere in the platform's docs; the
          descriptor exists to stop exactly that. */}
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

      {/* THE CLASSIFIER INSTRUCTIONS — `null` on all three adapters today, so
          this renders nothing. It is written as data anyway because §3.1 asks
          for it, and because `transport` must be SHOWN rather than hidden: the
          documented home is a file Dopl would share with the operator and with
          the platform itself, which is a fact about where the operator's words
          end up and not a implementation note. */}
      {classifier && (
        <SettingRow name={classifier.label}>
          <span className={VALUE_PILL}>
            {classifier.transport ?? "not stored"}
          </span>
        </SettingRow>
      )}
    </>
  );
}

/**
 * The secondary axis's effective value, in the runtime's own word.
 * ⚠ THE DECLARED DEFAULT, RESOLVED THROUGH THE OPTION LIST so the operator reads
 * the platform's LABEL rather than its wire value where the two differ (Cursor
 * declares `enabled` / `Enabled`; Codex spells both the same). A default naming
 * no declared option falls back to the first — the same fail-closed direction
 * every coercion in this family takes.
 */
function secondaryValueLabel(axis: {
  options: ReadonlyArray<{ value: string; label: string }>;
  default?: string | null;
}): string {
  const match = axis.options.find((o) => o.value === axis.default);
  return (match ?? axis.options[0])?.label ?? "";
}
