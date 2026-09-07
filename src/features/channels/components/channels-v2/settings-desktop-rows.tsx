"use client";

/**
 * The Settings tab's DESKTOP-ONLY groups, split out of `settings-agent.tsx` at
 * the 500-line cap — one file per reason to change: these rows exist only
 * inside the desktop shell (each gated on its own bridge upstream — no dead
 * rows), and both drive main-process launch state, never a server write.
 *
 * - **Working Folder** (named "Agent folder" until 2026-09-06) — where this
 *   channel's agent RUNS on the operator's Mac.
 *   ⚠ FOR DEVELOPERS, and no longer printed (Samuel, 2026-08-19): CONTEXT, NOT
 *   A SANDBOX. The tool profile applies on top whatever the cwd is
 *   (`main/tool-profiles.js`), so changing the folder never changes what the
 *   agent may do. ⚠ An unset or vanished path falls back to the DESKTOP DEFAULT —
 *   `~/Downloads`, or the homedir when that is missing — and this sentence said
 *   "the isolated sandbox" until 2026-09-05, which is the same fiction the row
 *   below was printing. There is no sandbox anywhere in this feature.
 * - **Auto-send** (Samuel, 2026-08-20; live since 2026-08-31) — the durable
 *   posture for this channel's OWN-agent replies. OFF: the draft waits in the
 *   thread view's send box; ON: it posts on its own. ⚠ Read LIVE at the gate
 *   (`main/session-private.js › effectiveMessageMode`), so flipping it applies
 *   to every agent in this channel immediately — running sessions, reopened
 *   shells, and panel-directed turns included; it is no longer frozen into a
 *   session at launch.
 * - **Orchestrator launches** (2026-08-22) — may the operator's own EXTERNAL
 *   Claude session start agents on THIS Mac. ⚠ **PER-MACHINE, not per-channel**,
 *   and the only control on this tab that is: see
 *   {@link OrchestratorLaunchRows}.
 * - **Agent chaining** (Samuel, 2026-08-31) — may an agent launched in THIS
 *   channel launch further agents? Default OFF = the one-generation bound
 *   (`main/session-own-launch.js`). Per channel, see {@link AgentChainRows}.
 */

// ⚠ `Switch` LEFT WITH THE TWO LAUNCH TOGGLES AND THE REPLIES ROW (2026-09-06,
// items 8 and 9). Nothing on this tab is a switch any more — every control is a
// `SelectMenu` or the folder button — and an import kept "in case" is how a deleted
// recipe comes back.
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
// ⚠ IMPORTED, NOT TAKEN AS A PROP (2026-09-06, item 4). `SettingName` / `GroupLabel`
// arrive as props for a historical reason this file's header records — they used to
// live in the host. `SettingRow` never did, and threading a fourth prop through to
// keep the pattern would be preserving an accident.
import { SettingRow } from "./settings-agent-rows";
import type { AgentFolderState } from "./settings-agent";

/**
 * ⚠ `FOLDER_DEFAULT_LABEL = "Sandbox (default)"` STOOD HERE AND IS DELETED
 * (2026-09-05, task 15; Samuel's ruling is the ABBREVIATED form).
 *
 * It was rendered whenever `folder.label` was null, and that null meant "no
 * per-channel folder is set" — not "no folder". So the one row on this tab that
 * claims to say where the operator's agent runs was naming **a place that does not
 * exist**: there is no sandbox, and the desktop's default is `~/Downloads`, or the
 * homedir when that is missing (`main/channel-dirs.js › defaultSessionDir`).
 *
 * The bridge now answers the EFFECTIVE directory always, derived through the same
 * function that produces the spawn cwd, so this file no longer invents a name for
 * anything — and the reset control reads `custom`, which is the question the null
 * was standing in for. Do not reintroduce a constant here: a label this file can
 * spell is a label main did not agree to.
 */

export function AgentFolderRows({
  folder,
}: {
  folder: AgentFolderState;
  // ⚠ `SettingName` IS GONE FROM THIS ROW'S PROPS (2026-09-06, item 4): the name is
  // the left column of `SettingRow` now, so there is no standalone name to render.
}) {
  return (
    <>
      {/* ⚠ "Agent folder" → "Working Folder", ONE LINE, AND THE NAME IS THE BUTTON
          (2026-09-06, Samuel's settings overhaul, item 4).

          ⚠ THE SEPARATE "Change folder…" BUTTON IS DELETED, NOT HIDDEN. The row was
          three stacked elements — a name, a value PILL, and a button whose only job
          was to open the picker the pill was already describing. The pill is now
          plain UNDERLINED TEXT and is itself the control, so the row is a NAME and a
          CONTROL on one line: exactly the shape `SettingRow` states for this tab.
          ⚠ IT IS A REAL `<button>`, not a styled span with a click handler. It opens
          a native picker, so it has to be reachable by keyboard and has to announce
          itself; `aria-label` names the ACT because the visible text is a path.
          ⚠ THE BUSY WORD STAYS ON THE CONTROL rather than beside it — with the
          separate button gone there is nowhere else for it, and a picker that is
          already open must not look clickable again.

          ⚠ "Use default" IS DELIBERATELY KEPT (2026-09-06, and flagged to Samuel
          rather than assumed): it is the only way back to the desktop default once a
          folder is set, and the overhaul did not mention it. It keeps gating on
          `custom`, NOT on the label — the label is always present, so gating on it
          would offer the reset on a channel already using the default. */}
      <SettingRow name="Working Folder">
        <button
          type="button"
          onClick={folder.onChoose}
          disabled={folder.busy}
          aria-label="Change the working folder for this channel's agents"
          /* ⚠ KIT TOKENS ONLY — no hex, no raw px (docs/DESIGN-SYSTEM.md). The
             underline is Tailwind's own utility rather than a `decoration-*` COLOR,
             which would be a token this kit does not declare. */
          className="min-w-0 truncate text-body text-text-primary underline underline-offset-2 transition-colors hover:text-text-secondary disabled:opacity-60"
        >
          {folder.busy ? "Opening picker…" : folder.label}
        </button>
      </SettingRow>
      {folder.custom && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={folder.onClear}
            disabled={folder.busy}
            className="rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary disabled:opacity-60"
          >
            Use default
          </button>
        </div>
      )}
    </>
  );
}

/**
 * ORCHESTRATOR LAUNCHES — the one PER-MACHINE control on a per-channel tab.
 *
 * ⚠ THE GROUP LABEL IS THE WHOLE SCOPE STATEMENT, AND IT IS NOT DECORATION.
 * Every other group here governs `(this channel, this Mac)`; this one governs
 * `(this Mac)`, so an operator who read it as per-channel would turn it on for
 * one room and hand an external session their whole machine. The tab's own
 * convention is that a `GroupLabel` "says what each group GOVERNS"
 * (`settings-agent.tsx › GroupLabel`), so the scope rides the heading rather
 * than a sentence under the switch — which is also what keeps this inside the
 * MINIMAL-COPY ruling (INVARIANTS §5: a row is a NAME and a CONTROL; the `Note`
 * recipe was deleted and must not come back for this).
 *
 * ⚠ IT TAKES `GroupLabel` RATHER THAN DRAWING ITS OWN. The two groups above are
 * unlabelled because their names carry them; this one cannot be, and a second
 * heading recipe in this file is how the tab ends up with two type scales.
 *
 * ⚠ NO ROW AT ALL WITHOUT THE BRIDGE — the caller passes `null` and this never
 * renders (no dead rows). ⚠ AND OFF IS THE FAILURE DIRECTION: the switch mirrors
 * a store that reads `false` for every "cannot say"
 * (`hooks/use-orchestrator-launch.ts`).
 */
/**
 * ⚠ `OrchestratorLaunchRows` AND `AgentChainRows` ARE BOTH DELETED AND REPLACED BY
 * {@link LaunchAgentsRow} (2026-09-06, Samuel's settings overhaul, item 9).
 *
 * They were two switches over two records with two scopes — `(this channel)` for
 * chaining, `(this Mac)` for the orchestrator — and an operator had to read a group
 * heading to tell which was which. Item 2 deleted those headings, so the pair could
 * not survive item 2 even if item 9 had not asked for it: two identical-looking
 * switches with no rendered scope statement is the misread the old
 * `OrchestratorLaunchRows` docblock was written to prevent.
 *
 * The scope distinction is NOT lost — it is now the thing the operator picks. It
 * moved from a heading nobody had to read into the option labels themselves.
 */
export const LAUNCH_AGENTS_OFF = "off";
export const LAUNCH_AGENTS_CHANNEL = "channel";
export const LAUNCH_AGENTS_EVERY = "every";

/** The three picks, and what each one means on BOTH records. */
export type LaunchAgentsValue =
  | typeof LAUNCH_AGENTS_OFF
  | typeof LAUNCH_AGENTS_CHANNEL
  | typeof LAUNCH_AGENTS_EVERY;

const LAUNCH_AGENTS_OPTIONS: ReadonlyArray<SelectMenuOption<LaunchAgentsValue>> = [
  { value: LAUNCH_AGENTS_OFF, label: "Cannot launch agents" },
  { value: LAUNCH_AGENTS_CHANNEL, label: "In this channel" },
  { value: LAUNCH_AGENTS_EVERY, label: "In every channel" },
];

/**
 * WHAT THE TWO RECORDS SAY, AS ONE PICK.
 *
 * ⚠ THE ORCHESTRATOR FLAG IS ASKED FIRST, AND THAT ORDER IS THE HONEST ONE. It is
 * machine-wide, so while it is ON an outside session can launch here whatever the
 * per-channel chain flag says — reporting "Cannot launch agents" over an armed
 * machine would be the control lying about the machine's actual state. The chain
 * flag is only decisive once the machine-wide one is off.
 */
export function launchAgentsValue(chainOn: boolean, orchestratorOn: boolean): LaunchAgentsValue {
  if (orchestratorOn) return LAUNCH_AGENTS_EVERY;
  return chainOn ? LAUNCH_AGENTS_CHANNEL : LAUNCH_AGENTS_OFF;
}

/**
 * ONE DROPDOWN, TWO RECORDS, NO SCHEMA CHANGE (item 9, storage shape approved).
 *
 * ⚠ THE RECORDS ARE NOT COLLAPSED, DELIBERATELY. The chain flag is per-CHANNEL and
 * the orchestrator flag is per-MACHINE. A single per-channel field could not express
 * "in every channel"; a single per-machine field would silently rewrite every other
 * room. So the CONTROL is one and the storage stays two, and this function is the
 * only place the mapping is written.
 *
 * ⚠ **EVERY PICK WRITES BOTH RECORDS.** An earlier draft left the orchestrator flag
 * untouched on "Cannot launch agents", which is incoherent with the label it renders:
 * an operator picking "Cannot" over an armed machine would still have an outside
 * session able to launch. A control that does not fully determine what it claims to
 * set is the illegibility defect item 8 was about, in the other lane.
 *
 * ⚠ **"In every channel" ARMS A MACHINE-WIDE SWITCH FROM INSIDE ONE ROOM, AND SO
 * DOES LEAVING IT.** That fact is stated verbatim in this item's eye popover by
 * ruling (`settings-help.tsx › SETTINGS_HELP["Launch agents"]`), because the heading
 * that used to carry it is deleted. Do not remove it from either place.
 *
 * ⚠ NO ROW WITHOUT BOTH BRIDGES — the caller passes `null` and this never renders.
 * A dropdown that could set only one of the two would offer picks that silently do
 * half of what they say.
 */
export function LaunchAgentsRow({
  agentChain,
  orchestrator,
}: {
  agentChain: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
  orchestrator: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
}) {
  const value = launchAgentsValue(agentChain.on, orchestrator.on);
  return (
    <SettingRow name="Launch agents">
      <SelectMenu<LaunchAgentsValue>
        variant="text"
        value={value}
        options={LAUNCH_AGENTS_OPTIONS}
        onChange={(next) => {
          if (next === value) return;
          // ⚠ BOTH WRITES, EVERY TIME, AND EACH ONE GUARDED AGAINST A NO-OP. The two
          // records are separate stores with separate in-flight states, so writing a
          // value that is already set would spend a round-trip and flicker the row
          // busy for nothing.
          const wantChain = next !== LAUNCH_AGENTS_OFF;
          const wantOrchestrator = next === LAUNCH_AGENTS_EVERY;
          if (wantChain !== agentChain.on) agentChain.onToggle(wantChain);
          if (wantOrchestrator !== orchestrator.on) orchestrator.onToggle(wantOrchestrator);
        }}
        ariaLabel="Whether agents may launch further agents, and where"
        disabled={agentChain.busy || orchestrator.busy}
      />
    </SettingRow>
  );
}

// ⚠ `AgentChainRows` IS DELETED (2026-09-06, item 9). Its record is untouched and
// still per-channel; only the control moved, into {@link LaunchAgentsRow}'s "In this
// channel" pick. Its docblock's warning — that a reader must not confuse the
// per-channel switch with the per-machine one — is now answered by construction:
// there is one control, and the scope is the thing being picked rather than a
// heading the operator had to read first.
//
// ⚠ `AutoSendRows` IS DELETED (2026-09-06, item 8). It set the same axis as
// Messaging and disagreed with it by construction. `main/session-private.js ›
// effectiveMessageMode` is still the one gate read and still LIVE, sourced from
// Messaging now — so the property that mattered survives and the second control does
// not. ⚠ ITS RECORD AND BRIDGE ARE DELETED IN THE SAME CHANGE — the hook is a
// tombstone, and `channel-prefs.getAutoSend` / `setAutoSend`, both IPC handlers,
// their preload methods and their bridge declarations are gone.
