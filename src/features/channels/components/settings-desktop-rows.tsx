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
 * - **Launch agents** — one pick over two records: agent chaining `(this channel)`,
 *   default OFF = the one-generation bound (`main/session-own-launch.js`), and
 *   orchestrator launches `(this Mac)`. See {@link LaunchAgentsRow}.
 * - **Direct agents** — may the operator's other sessions direct agents running on
 *   this Mac. See {@link DirectAgentsRow}.
 * - **Use my tools** — a shared channel's opt-in to the operator's own tools. See
 *   {@link UseMyToolsRow}.
 */

// ⚠ `Switch` LEFT WITH THE TWO LAUNCH TOGGLES AND THE REPLIES ROW (2026-09-06,
// items 8 and 9). Nothing on this tab is a switch any more — every control is a
// `SelectMenu` or the folder button — and an import kept "in case" is how a deleted
// recipe comes back.
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
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
          PLAIN TEXT (underlined until 2026-09-10) and is itself the control, so the
          row is a NAME and a CONTROL on one line: exactly the shape `SettingRow`
          states for this tab.
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
          /* ⚠ KIT TOKENS ONLY — no hex, no raw px (docs/DESIGN-SYSTEM.md).
             ⚠ NO UNDERLINE, REGULAR WEIGHT (Samuel, 2026-09-10): "Working Folder
             ~/Downloads … also remove the underline." The path is a VALUE in the
             Agent Settings block, so it wears exactly what the block's dropdown
             values wear (`select-menu.tsx › TRIGGER_FACE.text`) — and it is a real
             `<button>` with an `aria-label`, which is what keeps it operable and
             announced.
             ⚠ THE GRAY HOVER IS THAT FACE'S, TO THE LETTER (Samuel, 2026-09-13:
             *"Anything that can be clicked"*) — same `--menu-item-hover-bg` token,
             same `rounded-md`, same `-mx-1.5 px-1.5` so the path does not shift when
             the highlight appears. This row is the one clickable VALUE on the tab
             that is not a `SelectMenu`, so it has to state the recipe rather than
             inherit it; if a third caller ever appears, promote the string. */
          className="-mx-1.5 min-w-0 truncate rounded-md px-1.5 text-body text-text-primary transition-colors hover:bg-menu-item-hover-bg hover:text-text-secondary disabled:opacity-60 disabled:hover:bg-transparent"
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
            /* ⚠ `--menu-item-hover-bg`, NOT A SECOND SPELLING OF `--surface-raised-1`
               (Samuel, 2026-09-13). Same pixels — the token IS `var(--surface-raised-1)`
               by reference — and one name for the hover gray is the point of the
               2026-09-10 ruling. */
            className="rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-secondary transition-colors hover:bg-menu-item-hover-bg hover:text-text-primary disabled:opacity-60"
          >
            Use default
          </button>
        </div>
      )}
    </>
  );
}

/**
 * "Launch agents": two records at two scopes, chaining `(this channel)` and orchestrator launches
 * `(this Mac)`, as one pick — the scope is the thing the operator picks.
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

export const DIRECT_AGENTS_OFF = "off";
export const DIRECT_AGENTS_EVERY = "every";

/** The two picks. ⚠ There is no per-channel middle pick and there must not be one
 *  — the record is a single machine-wide boolean
 *  (`main/orchestrator-consent.js › ORCHESTRATOR_DIRECT_KEY`), so a third option
 *  would be a label with no storage behind it. */
export type DirectAgentsValue = typeof DIRECT_AGENTS_OFF | typeof DIRECT_AGENTS_EVERY;

/**
 * ⚠ **THE OPTION TEXT IS "In every channel" ON PURPOSE, WORD FOR WORD FROM
 * {@link LAUNCH_AGENTS_OPTIONS}.** It is the phrase the row above already uses for
 * ITS machine-wide pick, and the two flags have the same scope — so the operator
 * learns "in every channel = this whole Mac" once and reads it correctly in both
 * rows. A second phrasing for one scope is how a control comes to look per-channel.
 */
const DIRECT_AGENTS_OPTIONS: ReadonlyArray<SelectMenuOption<DirectAgentsValue>> = [
  { value: DIRECT_AGENTS_OFF, label: "Cannot direct agents" },
  { value: DIRECT_AGENTS_EVERY, label: "In every channel" },
];

/**
 * DIRECT AGENTS — may an outside session of the operator's own send PRIVATE
 * instructions to agents already running on this Mac? (Samuel approved
 * 2026-09-16, off the `DIRECTION-DROP-TRACE.md` finding.)
 *
 * ⚠ **THIS ROW IS THE FIX FOR A FIFTEEN-DAY SILENT FAILURE, NOT A NEW FEATURE.**
 * The lane, its store key, its IPC pair and its preload bridge all shipped on
 * 2026-08-31; nothing ever rendered a control, so the flag was never written, so
 * every direction filed against this machine was dropped at
 * `main/agent-directions.js`'s first gate and expired unclaimed — 38 of 38. The
 * capability was unreachable, not broken.
 *
 * ⚠ **A SELECTMENU, NOT A SWITCH, AND THAT IS THIS TAB'S RULE NOT A PREFERENCE.**
 * This file's header records that `Switch` left with the two launch toggles on
 * 2026-09-06: every control here is a `SelectMenu` or the folder button. A switch
 * reintroduced for one row is how a deleted recipe comes back.
 *
 * ⚠ **NO SUB-LINE, NO NOTE, AND THE EXPLANATION LIVES IN THE EYE POPOVER.**
 * INVARIANTS §5: a row is a NAME and a CONTROL; the `Note` recipe was deleted and
 * must not come back for this. What the grant actually buys is spelled out in
 * `settings-help.tsx › SETTINGS_HELP["Direct agents"]`, which is where
 * {@link LaunchAgentsRow} puts the same kind of sentence.
 *
 * ⚠ **IT IS A SEPARATE ROW FROM "Launch agents" AND MAY NOT BE FOLDED INTO IT.**
 * Item 9 collapsed two LAUNCH records into one control because they answered one
 * question at two scopes. This answers a DIFFERENT question — launching buys
 * COMPUTE, directing starts a turn inside a session that already exists — and
 * `main/orchestrator-consent.js` holds the ruling that the two consents are never
 * one flag. A single control over both would make "In every channel" grant a
 * capability the operator did not ask about.
 *
 * ⚠ NO ROW WITHOUT THE BRIDGE — the caller passes `null` and this never renders
 * (no dead rows). ⚠ AND OFF IS THE FAILURE DIRECTION: the control mirrors a store
 * that reads `false` for every "cannot say" (`hooks/use-orchestrator-direct.ts`).
 */
export function DirectAgentsRow({
  orchestratorDirect,
}: {
  orchestratorDirect: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
}) {
  const value = orchestratorDirect.on ? DIRECT_AGENTS_EVERY : DIRECT_AGENTS_OFF;
  return (
    <SettingRow name="Direct agents">
      <SelectMenu<DirectAgentsValue>
        variant="text"
        value={value}
        options={DIRECT_AGENTS_OPTIONS}
        onChange={(next) => {
          if (next === value) return;
          orchestratorDirect.onToggle(next === DIRECT_AGENTS_EVERY);
        }}
        ariaLabel="Whether your other sessions may send private instructions to agents running on this Mac"
        disabled={orchestratorDirect.busy}
      />
    </SettingRow>
  );
}

type OnOff = "off" | "on";
const USE_MY_TOOLS_OPTIONS: ReadonlyArray<SelectMenuOption<OnOff>> = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

/**
 * USE MY TOOLS — a SHARED channel's opt-in to the operator's own tools (Samuel, 2026-09-25). The
 * caller renders it only in a shared channel: a private one always has them, so a control there
 * would set nothing. What it buys, and the operator-turn rule, live in the eye popover.
 */
export function UseMyToolsRow({
  useMyTools,
}: {
  useMyTools: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
}) {
  const value: OnOff = useMyTools.on ? "on" : "off";
  return (
    <SettingRow name="Use my tools">
      <SelectMenu<OnOff>
        variant="text"
        value={value}
        options={USE_MY_TOOLS_OPTIONS}
        onChange={(next) => {
          if (next !== value) useMyTools.onToggle(next === "on");
        }}
        ariaLabel="Whether agents here may use your own tools on turns you start"
        disabled={useMyTools.busy}
      />
    </SettingRow>
  );
}
