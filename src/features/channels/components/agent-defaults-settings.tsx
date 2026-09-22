"use client";

/**
 * THE PROFILE POPUP'S "Agents" PANE — the DEFAULT agent settings a channel created from now on
 * starts with (Samuel, 2026-09-18: *"a new Agents tab under Connect; the page is the default
 * agent settings, same shape as the per-channel one, and a new channel inherits them instead of
 * the hardcoded blanks"*).
 *
 * ⚠ **IT RENDERS THE PER-CHANNEL TAB'S OWN ROWS, BY IMPORT, AND THAT IS THE POINT.**
 * `AgentLaunchPostureRows` is the same component `settings-agent.tsx` mounts, so the runtime, Tool
 * use, Messaging and Model rows cannot drift between "what a channel is set to" and "what a new
 * channel starts on". A second copy of those four rows is how the two surfaces come to offer
 * different vocabularies for one record.
 *
 * ⚠ **NO POSTURE WARNING HERE, AND THAT IS DELIBERATE RATHER THAN AN OMISSION.**
 * `posture-warning.tsx`'s dialog fires on `auto_both` + `full` + **a peer in the room** — it is a
 * statement about a specific channel's roster. This pane has no channel and therefore no roster;
 * a warning shown over "there might one day be someone in some room" is a dialog an operator
 * learns to dismiss. The warning still fires, unchanged, on the channel's own Settings tab, which
 * is where the combination becomes real.
 *
 * ⚠ **NO "Tool access" ROW.** That one is `channel_members.agent_tool_profile` — a CLOUD column,
 * per member per channel, whose row does not exist until the channel does. Every other control
 * here is a local record with a value this machine can hold before any channel exists. Adding it
 * would need a server-side default; it is a separate change with its own review.
 *
 * ⚠ **NO WORKING FOLDER, NO ORCHESTRATOR, NO DIRECT-AGENTS ROW.** The folder is a path picked per
 * channel; the other two are ALREADY machine-wide, so a "default" for them would be a second
 * control over a value that has exactly one.
 *
 * ⚠ **NO INDENT** (Samuel's ruling for this tab): the rows sit flush in the pane's own padding.
 * The per-channel tab's `px-3.5` exists to line its hairlines up with the info card beside it;
 * there is no such neighbour here, so copying the padding would draw an inset nothing explains.
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { SectionShell } from "@/shared/layout/settings-modal/sections/section-shell";
import { useLaunchSelection } from "../hooks/use-launch-selection";
import { AgentLaunchPostureRows } from "./settings-agent-launch-rows";
import { SettingRow } from "./settings-agent-rows";

export const DEFAULT_CHAIN_OFF = "off";
export const DEFAULT_CHAIN_ON = "on";

/** The two picks. ⚠ THERE IS NO "In every channel" OPTION AND THERE MUST NOT BE ONE. On the
 *  per-channel tab that phrase writes the MACHINE-WIDE orchestrator consent
 *  (`settings-desktop-rows.tsx › LaunchAgentsRow`), which is not a default for anything — it is
 *  already in force everywhere. A third option here would arm the whole Mac from a row labelled
 *  as a default for rooms that do not exist yet. */
type DefaultChainValue = typeof DEFAULT_CHAIN_OFF | typeof DEFAULT_CHAIN_ON;

const CHAIN_OPTIONS: ReadonlyArray<SelectMenuOption<DefaultChainValue>> = [
  { value: DEFAULT_CHAIN_OFF, label: "Cannot launch agents" },
  { value: DEFAULT_CHAIN_ON, label: "Can launch agents" },
];

/**
 * ⚠ **THE PANE IS ABSENT WHOLE WITHOUT THE BRIDGE** — the no-dead-rows rule (INVARIANTS §5), and
 * here the strong version of it: the record lives in the desktop's own store, so a browser would
 * otherwise render four controls that persist nothing and a promise that new channels inherit
 * something they cannot.
 */
export function AgentDefaultsSettings() {
  // ⚠ **THE SAME HOOK THE PER-CHANNEL TAB MOUNTS, AT THE OTHER SCOPE (2026-09-21, U8).** The
  // defaults record and a channel's record are ONE SHAPE — `main/agent-defaults.js` says so in as
  // many words, and `seedChannel` copies one straight into the other — so two hooks over it is
  // how a field comes to be seeded on some channels and not others.
  // ⚠ **AND IT IS WHAT MAKES THE WRITE STOP ERASING THE OPERATOR'S OTHER RUNTIME.** The previous
  // hook sent `{tools, messages, model, agentChain, runtime}` — a record with no `v`, which
  // `normalizeDefaults` reads as a pre-U5 LEGACY one and migrates into the DEFAULT runtime's slot,
  // dropping every other runtime's model and native settings on every keystroke of this pane.
  const state = useLaunchSelection({ kind: "defaults" });

  if (!state.bridge) {
    return (
      <SectionShell title="Agents">
        <p className="text-caption text-text-secondary">
          Default agent settings live on the Dopl desktop app.
        </p>
      </SectionShell>
    );
  }

  const chain: DefaultChainValue = state.agentChain
    ? DEFAULT_CHAIN_ON
    : DEFAULT_CHAIN_OFF;

  return (
    // ⚠ THE SUBTITLE IS THE ONE SENTENCE ON THIS PANE, and it is the SCOPE statement rather than
    // an explainer: without it "Agents" in a profile popup reads as a control over the agents
    // running right now. The minimal-copy ruling (INVARIANTS §5) bars a paragraph under any ROW;
    // a pane still says what it governs, exactly as every other section here does.
    <SectionShell
      title="Agents"
      subtitle="What a new channel's agents start on. Channels you already have keep their own settings."
    >
      <div className="flex flex-col gap-1">
        {/* ⚠ NO `onChangeMessages`, AND THAT IS DELIBERATE RATHER THAN AN OMISSION — the
            messaging write goes STRAIGHT TO THE RECORD. `posture-warning.tsx`'s dialog fires on
            `auto_both` + `full` + **a peer in the room**, which is a statement about a specific
            channel's roster; this pane has no channel and therefore no roster. See the file
            docblock. */}
        <AgentLaunchPostureRows selection={state} />
        {/* ⚠ "Launch agents" IS THE PER-CHANNEL TAB'S OWN ROW NAME, kept word for word so the two
            surfaces read as one setting at two scopes. What differs is the OPTION list, and the
            reason is above {@link CHAIN_OPTIONS}. */}
        <SettingRow name="Launch agents">
          <SelectMenu<DefaultChainValue>
            variant="text"
            value={chain}
            options={CHAIN_OPTIONS}
            onChange={(next) => {
              if (next === chain) return;
              void state.update({ agentChain: next === DEFAULT_CHAIN_ON });
            }}
            ariaLabel="Whether agents in a new channel may launch further agents"
            disabled={state.busy}
          />
        </SettingRow>
      </div>
    </SectionShell>
  );
}
