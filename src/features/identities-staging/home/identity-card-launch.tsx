/**
 * STAGING COPY of `apps/desktop-ui/src/pages/home/identity-card-launch.tsx`. The button is
 * verbatim; `useCardLaunch` keeps its contract but SIMULATES the launch (no Electron bridge): a
 * busy beat, then the same success toast — or, for the rows in `../data.ts › REFUSED_LAUNCH`, the
 * refusal line on the card.
 */
import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { toast } from "@/shared/ui/toast";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { REFUSED_LAUNCH, channelTitle, type StagingChannel as Channel } from "../data";

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
      // Item 2b: FULL WIDTH at the foot of the card. Launch is the one thing a card is for, and a
      // small pill tucked to the right read like a secondary control. Layout stays with the caller
      // by `open-scale-button.tsx`'s own division, so the face is untouched.
      className="w-full justify-center gap-1.5 disabled:opacity-60"
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<CardLaunch["error"]>(null);

  const run = useCallback(
    async (identity: AgentIdentity) => {
      // One launch in flight across the pane — a double-submit guard, not a cap.
      if (!channel || busyId !== null) return;
      setBusyId(identity.id);
      setError(null);
      try {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const refusal = REFUSED_LAUNCH[identity.id];
        if (refusal) {
          setError({ identityId: identity.id, message: refusal });
          return;
        }
        toast({
          title: `"${identity.name}" launched into "${channelTitle(channel)}"`,
          variant: "invert",
        });
      } finally {
        setBusyId(null);
      }
    },
    [channel, busyId]
  );

  return {
    // The desktop build always has the launch op; staging shows the button.
    canLaunch: true,
    busyId,
    error,
    launch: (identity) => void run(identity),
  };
}
