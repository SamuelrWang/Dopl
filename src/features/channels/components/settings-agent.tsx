"use client";

/**
 * The Settings tab's agent half — the VIEW. It renders without a bridge; hooks live in
 * `settings-agent-container.tsx`. Desktop-only rows are absent without their bridge (INVARIANTS §5).
 */

import { AgentFolderRows, DirectAgentsRow, LaunchAgentsRow } from "./settings-desktop-rows";
import { isSharedChannel } from "../lib/tool-profile-resolve";
import type { MessageMode } from "../lib/permission-modes";
import type { LaunchSelectionState } from "../hooks/use-launch-selection";
import { PanelHeading } from "./bits";
import { usePostureWarning } from "./posture-warning";
// Re-exported so callers and suites keep importing the container from here.
export { ChannelAgentSettings } from "./settings-agent-container";
export type { ChannelAgentSettingsProps } from "./settings-agent-container";
import { AgentLaunchPostureRows } from "./settings-agent-launch-rows";
import { ToolAccessRow } from "./settings-agent-rows";
import type { AgentToolProfile, ChannelMember } from "../types";

/** The desktop-only folder half, or null outside the desktop shell. */
export interface AgentFolderState {
  /** The effective working directory, abbreviated (the absolute path never reaches this page);
   *  null only before the first answer. Whether a custom folder is set is `custom`, not this. */
  label: string | null;
  /** A per-channel folder is set. Gates the reset control, and nothing else. */
  custom: boolean;
  /** True while the native picker (or a reset) is in flight. */
  busy: boolean;
  onChoose: () => void;
  onClear: () => void;
}

export interface ChannelAgentSettingsViewProps {
  profile: AgentToolProfile;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** True while the tool-profile write is in flight; the control goes inert. */
  toolProfileBusy: boolean;
  /** The posture warning's peer check — see `ChannelAgentSettingsProps`. */
  roster?: readonly ChannelMember[];
  currentUserId?: string | null;
  /** The channel's member count, not the roster's length; absent reads as shared. */
  memberCount?: number | null;
  /** The channel's durable launch record; without a bridge the launch group is absent. */
  selection?: LaunchSelectionState | null;
  /** The working folder, or null outside the desktop shell (row absent). */
  folder: AgentFolderState | null;
  /** Per channel: may an agent launched here launch further agents. Null without the bridge. */
  agentChain?: { on: boolean; busy: boolean; onToggle: (on: boolean) => void } | null;
  /** Per-machine orchestrator launch consent (`hooks/use-orchestrator-launch.ts`); null without
   *  its bridge. `LaunchAgentsRow` renders only with both this and `agentChain`. */
  orchestrator?: {
    on: boolean;
    busy: boolean;
    onToggle: (on: boolean) => void;
  } | null;
  /** Per-machine direct-agents consent — a separate grant from `orchestrator`, never a second
   *  spelling of it (`hooks/use-orchestrator-direct.ts`). Null without its bridge. */
  orchestratorDirect?: {
    on: boolean;
    busy: boolean;
    onToggle: (on: boolean) => void;
  } | null;
}

export function ChannelAgentSettingsView({
  profile,
  onSetToolProfile,
  toolProfileBusy,
  roster = EMPTY_ROSTER,
  currentUserId = null,
  memberCount = null,
  selection = null,
  folder,
  agentChain = null,
  orchestrator = null,
  orchestratorDirect = null,
}: ChannelAgentSettingsViewProps) {
  // Messaging and tool-profile writes go through `usePostureWarning`: `auto_both` + `full` + a peer
  // is the tab's one confirm dialog (cancel writes nothing). The defaults pane has none (no roster).
  const launch = selection?.bridge ? selection : null;
  const warning = usePostureWarning({
    messageMode: launch ? (launch.messages as MessageMode) : null,
    toolProfile: profile,
    roster,
    currentUserId,
    commitPosture: (patch) => void launch?.update(patch),
    commitToolProfile: onSetToolProfile,
  });

  return (
    <>
      <PanelHeading title="Agent Settings" />
      <div className="flex flex-col gap-1 px-3.5">
        {launch && (
          <AgentLaunchPostureRows
            selection={launch}
            // Only Messaging can flip the warning; the group's other writes reach the record directly.
            onChangeMessages={warning.changePosture}
          />
        )}

        <ToolAccessRow
          profile={profile}
          shared={isSharedChannel(memberCount)}
          busy={toolProfileBusy}
          onChange={warning.setToolProfile}
        />

        {folder && <AgentFolderRows folder={folder} />}
        {/* Needs both bridges: a row that could set only one of the two records would offer picks
            that do half of what they say. */}
        {agentChain && orchestrator && (
          <LaunchAgentsRow agentChain={agentChain} orchestrator={orchestrator} />
        )}
        {/* Independent of the launch row: gating it there would hide an armed lane. */}
        {orchestratorDirect && (
          <DirectAgentsRow orchestratorDirect={orchestratorDirect} />
        )}
      </div>
      {warning.dialog}
    </>
  );
}

/** Module-level, so an unpassed roster keeps one identity across renders. */
const EMPTY_ROSTER: readonly ChannelMember[] = [];
