"use client";

/**
 * Bridge-bound container for the Settings tab's agent half. Keep every hook here: the view
 * (`settings-agent.tsx`) must render without a bridge, because the settings suites drive it directly.
 */

import { useChannelAgentChain, useChannelUseMyTools, type ChannelFlagState } from "../hooks/use-channel-flag";
import { useChannelFolder } from "../hooks/use-channel-folder";
import { useOrchestratorDirect } from "../hooks/use-orchestrator-direct";
import { useOrchestratorLaunch } from "../hooks/use-orchestrator-launch";
import { useLaunchSelection } from "../hooks/use-launch-selection";
import {
  ChannelAgentSettingsView,
} from "./settings-agent";
import type { AgentToolProfile, ChannelMember } from "../types";

export interface ChannelAgentSettingsProps {
  /** The channel's DB UUID — handed to the desktop bridges as-is. */
  channelId: string;
  /** The caller's own tool profile for this channel (never a teammate's). */
  profile: AgentToolProfile;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** True while the tool-profile write is in flight. */
  toolProfileBusy: boolean;
  /** Roster and caller for the posture warning's peer check (`posture-warning.tsx ›
   *  warrantsPostureWarning`). Absent = cannot say who is here, which warns about nothing. */
  roster?: readonly ChannelMember[];
  currentUserId?: string | null;
  /** The channel's member count, never the roster's length (`roster` may default to `[]`).
   *  Absent reads as shared, as in `targeting-window.js › isSharedChannel` (F-692). */
  memberCount?: number | null;
}

/** Bridge state → a toggle row's prop; no bridge ⇒ null (row absent). */
function toggleRow(
  state: { bridge: unknown; busy: boolean; update: (next: boolean) => Promise<void> },
  on: boolean
) {
  return state.bridge
    ? { on, busy: state.busy, onToggle: (n: boolean) => void state.update(n) }
    : null;
}
const flagRow = (state: ChannelFlagState) => toggleRow(state, state.on);
const consentRow = (state: Parameters<typeof toggleRow>[0] & { enabled: boolean }) =>
  toggleRow(state, state.enabled);

export function ChannelAgentSettings(props: ChannelAgentSettingsProps) {
  const launchSelection = useLaunchSelection({ kind: "channel", channelId: props.channelId });
  const folder = useChannelFolder(props.channelId);
  // Per channel; the two consents below are per machine (no `channelId`) and separate records.
  const agentChain = useChannelAgentChain(props.channelId);
  const useMyTools = useChannelUseMyTools(props.channelId);
  const orchestrator = useOrchestratorLaunch();
  const orchestratorDirect = useOrchestratorDirect();

  return (
    <ChannelAgentSettingsView
      profile={props.profile}
      onSetToolProfile={props.onSetToolProfile}
      toolProfileBusy={props.toolProfileBusy}
      roster={props.roster}
      currentUserId={props.currentUserId}
      memberCount={props.memberCount}
      selection={launchSelection}
      folder={
        folder.bridge
          ? {
              label: folder.label,
              custom: folder.custom,
              busy: folder.busy,
              onChoose: () => void folder.choose(),
              onClear: () => void folder.clear(),
            }
          : null
      }
      agentChain={flagRow(agentChain)}
      useMyTools={flagRow(useMyTools)}
      orchestrator={consentRow(orchestrator)}
      orchestratorDirect={consentRow(orchestratorDirect)}
    />
  );
}
