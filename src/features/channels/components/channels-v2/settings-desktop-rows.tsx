"use client";

/**
 * The Settings tab's DESKTOP-ONLY groups, split out of `settings-agent.tsx` at
 * the 500-line cap — one file per reason to change: these rows exist only
 * inside the desktop shell (each gated on its own bridge upstream — no dead
 * rows), and both drive main-process launch state, never a server write.
 *
 * - **Agent folder** — where this channel's agent RUNS on the operator's Mac.
 *   ⚠ FOR DEVELOPERS, and no longer printed (Samuel, 2026-08-19): CONTEXT, NOT
 *   A SANDBOX. The tool profile applies on top whatever the cwd is
 *   (`main/tool-profiles.js`), so changing the folder never changes what the
 *   agent may do; an unset or vanished path falls back to the isolated sandbox.
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

import { Switch } from "@/shared/ui/switch";
import type { AgentFolderState } from "./settings-agent";

/** The desktop's own folder when the channel names none. */
const FOLDER_DEFAULT_LABEL = "Sandbox (default)";

export function AgentFolderRows({
  folder,
  SettingName,
}: {
  folder: AgentFolderState;
  SettingName: (props: { children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <>
      <SettingName>Agent folder</SettingName>
      <p className="truncate rounded-[8px] border border-border-subtle bg-bg-inset px-2.5 py-1.5 text-body text-text-primary">
        {folder.label ?? FOLDER_DEFAULT_LABEL}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={folder.onChoose}
          disabled={folder.busy}
          className="btn-light rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-primary disabled:opacity-60"
        >
          {folder.busy ? "Opening picker…" : "Change folder…"}
        </button>
        {folder.label && (
          <button
            type="button"
            onClick={folder.onClear}
            disabled={folder.busy}
            className="rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary disabled:opacity-60"
          >
            Use default
          </button>
        )}
      </div>
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
export function OrchestratorLaunchRows({
  orchestrator,
  GroupLabel,
}: {
  orchestrator: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
  GroupLabel: (props: { children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <>
      <GroupLabel>On this Mac, every channel</GroupLabel>
      <div className="flex h-[38px] items-center gap-2.5 rounded-[8px] px-2">
        <span className="min-w-0 flex-1 truncate text-body text-text-primary">
          Orchestrator launches
        </span>
        {orchestrator.busy && (
          <span className="text-caption text-text-muted">Saving…</span>
        )}
        <Switch
          checked={orchestrator.on}
          disabled={orchestrator.busy}
          onChange={(next) => orchestrator.onToggle(next)}
          aria-label="Orchestrator launches on this Mac"
        />
      </div>
    </>
  );
}

/**
 * AGENT CHAINING (Samuel, 2026-08-31) — may an agent launched in THIS channel
 * launch further agents? Default OFF, which is the one-generation bound that
 * shipped (`main/session-own-launch.js › MAX_LAUNCH_DEPTH`).
 *
 * ⚠ IT SITS IN THE PER-CHANNEL GROUP, NOT THE PER-MACHINE ONE ABOVE, and the
 * distinction is the one {@link OrchestratorLaunchRows} exists to protect: that
 * switch answers "on this Mac", this one answers "in this room". An operator who
 * read them the other way round would either arm a machine they meant to arm a
 * room, or wonder why the room they armed does nothing.
 *
 * ⚠ MINIMAL COPY (INVARIANTS §5): a NAME and a CONTROL. What it lifts, what it
 * does NOT grant, and what still bounds a chain with it on are all written where
 * they are enforced — `hooks/use-channel-agent-chain.ts` for the reader,
 * `main/channel-prefs.js` and `main/launch-budget.js` for the rules. **Do not put
 * a warning paragraph under this switch**; the `Note` recipe was deleted and this
 * is exactly the control that would tempt it back.
 */
export function AgentChainRows({
  agentChain,
  SettingName,
}: {
  agentChain: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
  SettingName: (props: { children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <>
      <SettingName>Agents</SettingName>
      <div className="flex h-[38px] items-center gap-2.5 rounded-[8px] px-2">
        <span className="min-w-0 flex-1 truncate text-body text-text-primary">
          May launch agents
        </span>
        {agentChain.busy && (
          <span className="text-caption text-text-muted">Saving…</span>
        )}
        <Switch
          checked={agentChain.on}
          disabled={agentChain.busy}
          onChange={(next) => agentChain.onToggle(next)}
          aria-label="Agents launched here may launch agents"
        />
      </div>
    </>
  );
}

export function AutoSendRows({
  autoSend,
  SettingName,
}: {
  autoSend: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
  SettingName: (props: { children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <>
      <SettingName>Replies</SettingName>
      <div className="flex h-[38px] items-center gap-2.5 rounded-[8px] px-2">
        <span className="min-w-0 flex-1 truncate text-body text-text-primary">
          Send automatically
        </span>
        {autoSend.busy && (
          <span className="text-caption text-text-muted">Saving…</span>
        )}
        <Switch
          checked={autoSend.on}
          disabled={autoSend.busy}
          onChange={(next) => autoSend.onToggle(next)}
          aria-label="Send replies automatically"
        />
      </div>
    </>
  );
}
