import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { toast } from "@/shared/ui/toast";
import {
  canLaunchAgents,
  launchAgentOnThread,
} from "@/features/channels/components/agents-controls";
import {
  buildLaunchPayload,
  launchRefusalText,
} from "@/features/channels/components/use-launch-controls";
import {
  describeAgent,
  renameAgent,
} from "@/features/channels/components/use-agent-launch";
import { useChannelLaunchPosture } from "@/features/channels/hooks/use-channel-launch-posture";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import type { Channel } from "@/features/channels/types";
import { channelTitle } from "./home-rows";

/**
 * The personal card's one-click Launch: the identity as-is into the selected channel, no form.
 * The payload is `use-launch-controls.ts › buildLaunchPayload` with only the identity id, so it is
 * byte-for-byte the composer's one-click launch.
 */

/** The card control. A `<button>` inside the card's face, never over it
 *  (`identity-section.tsx › IdentityCard`). */
export function LaunchIntoChannelButton({
  onClick,
  busy,
  disabled,
}: {
  onClick: () => void;
  /** The launch in flight is on THIS row. */
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <OpenScaleButton
      onClick={onClick}
      disabled={disabled || busy}
      className="gap-1.5 disabled:opacity-60"
    >
      {busy && (
        <Loader2
          size={OPEN_SCALE_ICON}
          aria-hidden="true"
          className="animate-spin"
        />
      )}
      Launch
    </OpenScaleButton>
  );
}

/** Which row is launching, and the one line a refusal gets. */
export interface CardLaunch {
  /** The bridge op exists on this build; the caller renders no button otherwise. */
  canLaunch: boolean;
  /** The identity id with a launch in flight, or `null`. */
  busyId: string | null;
  /** The last refusal, on the row that earned it (a refusal is not a push). */
  error: { identityId: string; message: string } | null;
  launch: (identity: AgentIdentity) => void;
}

export function useCardLaunch(channel: Channel | null): CardLaunch {
  const posture = useChannelLaunchPosture(channel?.id ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<CardLaunch["error"]>(null);

  const run = useCallback(
    async (identity: AgentIdentity) => {
      // One launch in flight across the pane — a double-submit guard, not a cap.
      if (!channel || busyId !== null) return;
      setBusyId(identity.id);
      setError(null);
      try {
        const res = await launchAgentOnThread(
          buildLaunchPayload(
            {
              channelId: channel.id,
              // The IDENTITY's workspace: main resolves `(workspace_id, id)`; the channel's
              // container id would 404 every personal identity.
              workspaceId: identity.workspaceId,
              channelName: channel.name,
              direct: channel.isDirect,
              thread: () => null,
            },
            // `null` = a channel-level agent, never `""` (the legacy "thread never became
            // first-class" value).
            null,
            identity.id
          )
        );
        if (!res.ok) {
          // The launched runtime is the identity's, else the channel's (no per-spawn pick here).
          const descriptor = identity.runtime
            ? posture.descriptorOf(identity.runtime)
            : posture.descriptor;
          setError({
            identityId: identity.id,
            message:
              res.reason === "no-model" && res.detail
                ? res.detail
                : launchRefusalText(res.reason, descriptor),
          });
          return;
        }
        const address = res.agentId;
        if (address) {
          // A refused rename/describe is not a failed launch: the agent is already running.
          await renameAgent(address, identity.name);
          const described = identity.description?.trim();
          if (described) await describeAgent(address, described);
        }
        toast({
          title: `"${identity.name}" launched into "${channelTitle(channel)}"`,
          variant: "invert",
        });
      } finally {
        setBusyId(null);
      }
    },
    [channel, busyId, posture]
  );

  return {
    canLaunch: canLaunchAgents(),
    busyId,
    error,
    launch: (identity) => void run(identity),
  };
}
