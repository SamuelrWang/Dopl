"use client";

/**
 * Bridge-bound container for the Settings tab's agent half. Keep every hook here: the view
 * (`settings-agent.tsx`) must render without a bridge, because the settings suites drive it directly.
 */

import { useChannelAgentChain } from "../hooks/use-channel-agent-chain";
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

/** Bridge state → row prop for a per-machine consent; no bridge ⇒ null (row absent). */
function consentRow(state: {
  bridge: unknown; enabled: boolean; busy: boolean; update: (next: boolean) => Promise<void>;
}) {
  return state.bridge
    ? { on: state.enabled, busy: state.busy, onToggle: (n: boolean) => void state.update(n) }
    : null;
}

export function ChannelAgentSettings(props: ChannelAgentSettingsProps) {
  const launchSelection = useLaunchSelection({ kind: "channel", channelId: props.channelId });
  const folder = useChannelFolder(props.channelId);
  // Per channel; the two consents below are per machine (no `channelId`) and separate records.
  const agentChain = useChannelAgentChain(props.channelId);
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
      agentChain={
        agentChain.bridge
          ? {
              on: agentChain.on,
              busy: agentChain.busy,
              onToggle: (next) => void agentChain.update(next),
            }
          : null
      }
      orchestrator={consentRow(orchestrator)}
      orchestratorDirect={consentRow(orchestratorDirect)}
    />
  );
}


