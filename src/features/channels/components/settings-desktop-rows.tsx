"use client";

/**
 * The Settings tab's DESKTOP-ONLY rows, each gated on its own bridge upstream (no dead rows), all
 * driving main-process launch state, never a server write.
 *
 * - **Working folder** — where this channel's agent RUNS on the operator's Mac. CONTEXT, NOT A
 *   SANDBOX: the tool profile applies whatever the cwd is (`main/tool-profiles.js`). An unset or
 *   vanished path falls back to the desktop default.
 * - **Launch agents** — one pick over two records. See {@link LaunchAgentsRow}.
 * - **Direct agents** — may the operator's other sessions direct agents on this Mac. See
 *   {@link DirectAgentsRow}.
 * - **Use my tools** — a shared channel's opt-in to the operator's own tools. See
 *   {@link UseMyToolsRow}.
 */

import { cn } from "@/shared/lib/utils";
import { BARE_TRIGGER_FACE, SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { PILL_BUTTON } from "@/shared/ui/small-action-button";
import { SettingRow } from "./settings-agent-rows";
import type { AgentFolderState } from "./settings-agent";

/**
 * The path IS the control (a real `<button>` naming the act, since its text is a path) and wears
 * the dropdown values' face. The label is main's EFFECTIVE directory, never a default this file
 * spells; "Use default" gates on `custom`, because the label is always present.
 */
export function AgentFolderRows({ folder }: { folder: AgentFolderState }) {
  return (
    <SettingRow name="Working folder">
      <span className="inline-flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={folder.onChoose}
          disabled={folder.busy}
          aria-label="Change the working folder for this channel's agents"
          className={cn(BARE_TRIGGER_FACE, "min-w-0 truncate disabled:opacity-60")}
        >
          {folder.busy ? "Opening picker…" : folder.label}
        </button>
        {folder.custom && (
          <button
            type="button"
            onClick={folder.onClear}
            disabled={folder.busy}
            className={cn(PILL_BUTTON, "disabled:opacity-60")}
          >
            Use default
          </button>
        )}
      </span>
    </SettingRow>
  );
}

/**
 * "Launch agents": two records at two scopes, chaining `(this channel)` and orchestrator launches
 * `(this Mac)`, as one pick — the scope is the thing the operator picks.
 */
const LAUNCH_AGENTS_OFF = "off";
const LAUNCH_AGENTS_CHANNEL = "channel";
const LAUNCH_AGENTS_EVERY = "every";

/** The three picks, and what each one means on BOTH records. */
type LaunchAgentsValue =
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
function launchAgentsValue(chainOn: boolean, orchestratorOn: boolean): LaunchAgentsValue {
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
        variant="bare"
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

const DIRECT_AGENTS_OFF = "off";
const DIRECT_AGENTS_EVERY = "every";

/** The two picks. ⚠ There is no per-channel middle pick and there must not be one
 *  — the record is a single machine-wide boolean
 *  (`main/orchestrator-consent.js › ORCHESTRATOR_DIRECT_KEY`), so a third option
 *  would be a label with no storage behind it. */
type DirectAgentsValue = typeof DIRECT_AGENTS_OFF | typeof DIRECT_AGENTS_EVERY;

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
 * 2026-09-16, off the `docs/traces/DIRECTION-DROP-TRACE.md` finding.)
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
        variant="bare"
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
        variant="bare"
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
