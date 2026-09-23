import { useMemo, type ReactNode } from "react";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { authorMarker } from "@/features/agent-identities/components/identity-picker";
import {
  IdentityGrid,
  IdentityPanel,
} from "@/features/agent-identities/components/identity-section";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import type { IdentitySectionDef } from "@/features/agent-identities/lib/visibility";
import { EMPTY_PEERS } from "@/features/channels/types";
import type { Channel } from "@/features/channels/types";
import { channelPeople } from "./home-rows";

/**
 * The /home Identities sections `identity-panels.tsx` stacks, and the shared section's author
 * marker. Both are `identity-section.tsx`'s flat `IdentityPanel` + `IdentityGrid`, never
 * `SectionBox` (/home has no concave surface; swept by `identity-editor-surface.test.tsx`).
 */

/** The channel's shared identities — who else in this relationship can wear them. */
export function SharedIdentitySection({
  section,
  identities,
  markerFor,
  onOpen,
  action,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  markerFor: (identity: AgentIdentity) => string | null;
  /** Header-right control (the create button). */
  action?: ReactNode;
  /** Opens the editor against the channel's container. Openable on a peer's row too: the write
   *  floor is the server's (member+), and the marker says whose instructions these are. */
  onOpen: (identity: AgentIdentity) => void;
}) {
  return (
    <IdentityPanel id="home-agents-shared" label={section.label} action={action}>
      <IdentityGrid
        identities={identities}
        emptyLine={section.emptyLine}
        markerFor={markerFor}
        onOpen={onOpen}
      />
    </IdentityPanel>
  );
}

/**
 * The caller's own private identities. Five body states and only the grid may state an
 * emptiness: `unavailable` (no home workspace), `failure` (answered with an error — outranks
 * `pending`, since a failed read never resolves, F-339), `pending`, the empty line, the grid.
 */
export function PrivateIdentitySection({
  section,
  identities,
  action,
  unavailable,
  failure,
  pending,
  onOpen,
  cardActionFor,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  /** The create button. */
  action: ReactNode;
  /** There is nowhere to look — a sentence, not an empty list. */
  unavailable: string | null;
  /** The server's own wording plus a retry; `null` when the read did not fail. */
  failure: { message: string; onRetry: () => void } | null;
  pending: boolean;
  /** Opens the editor where the row lives (the home workspace). */
  onOpen: (identity: AgentIdentity) => void;
  /** The card's one action slot: the knowledge box and Launch travel together
   *  (`identity-section.tsx › IdentityCard` carries exactly one). */
  cardActionFor?: (identity: AgentIdentity) => ReactNode;
}) {
  return (
    <IdentityPanel
      id="home-agents-private"
      label={section.label}
      action={action}
    >
      {unavailable !== null ? (
        <p className="px-1 pb-1 text-caption text-text-muted">{unavailable}</p>
      ) : failure !== null ? (
        // Not `PageError`: that is a whole-pane state, and the other section loaded fine.
        <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
          <p className="text-caption text-text-muted">{failure.message}</p>
          <OpenScaleButton onClick={failure.onRetry}>
            Try again
          </OpenScaleButton>
        </div>
      ) : pending ? (
        <div className="h-10" />
      ) : (
        <IdentityGrid
          identities={identities}
          emptyLine={section.emptyLine}
          onOpen={onOpen}
          actionFor={cardActionFor}
        />
      )}
    </IdentityPanel>
  );
}

/**
 * `by <member>` for a shared row this operator did not write, else `null`. A security signal
 * (INVARIANTS §5A): an author the roster cannot name still reads "by another member", never mine.
 * The roster is `channel.peers` (every member but the caller, already on the payload), so it costs
 * no request.
 */
export function useContainerAuthorMarker(
  channel: Channel | null,
  currentUserId: string
): (identity: AgentIdentity) => string | null {
  // Keyed on `channel`, the stable object the cache hands back, not on the peer list.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    // A nameless peer is left out, not entered blank: `authorMarker` already answers
    // "by another member", where an empty entry would render "by ".
    for (const peer of channel ? channelPeople(channel) : EMPTY_PEERS) {
      if (peer.displayName) map.set(peer.userId, peer.displayName);
    }
    return map;
  }, [channel]);
  return useMemo(
    () => (identity: AgentIdentity) =>
      authorMarker(identity, currentUserId, names),
    [currentUserId, names]
  );
}
