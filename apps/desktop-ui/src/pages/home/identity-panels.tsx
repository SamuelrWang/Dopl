import { useMemo, useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { agentIdentityErrorMessage } from "@/features/agent-identities/client/api";
import { authorMarker } from "@/features/agent-identities/components/identity-picker";
import {
  IdentityGrid,
  IdentityPanel,
} from "@/features/agent-identities/components/identity-section";
import { useAgentIdentities } from "@/features/agent-identities/hooks/use-agent-identities";
import { EMPTY_KNOWLEDGE } from "@/features/agent-identities/lib/knowledge-scopes";
import {
  SECTIONS_CONTAINER,
  SECTION_PRIVATE_EVERYWHERE,
  groupByVisibility,
  type IdentitySectionDef,
} from "@/features/agent-identities/lib/visibility";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import {
  EMPTY_PEERS,
  EMPTY_WORKSPACE_ROLE,
  type Channel,
} from "@/features/channels/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError } from "#/components/page-states";
import {
  ContainerIdentityEditor,
  HOME_SHELF,
  HomeWorkspaceIdentityEditor,
} from "./identity-editor";
import { LaunchIntoChannelButton, useCardLaunch } from "./identity-card-launch";
import { AddKnowledgeWell, IdentityKnowledgeDialog } from "./identity-card-knowledge";
import { channelPeople } from "./home-rows";
import { CreateButton } from "./panel-buttons";
import { HomeIdentityPanelsSkeleton } from "./home-skeleton";

/**
 * /home → Identities: two sections for one channel. SHARED is the channel's link container at
 * `visibility: "workspace"` (heading from `SECTIONS_CONTAINER`, never "Public"); PERSONAL is the
 * caller's own private identities on the home shelf. Only a personal card launches: the shared
 * rows are the container's, and a launch resolves an identity in one workspace.
 * Two reads share one path in two workspaces, so writes patch the ENTRY key, never the path
 * prefix (F-331, INVARIANTS §8). Both create buttons read "+ Agent Identity"; reach them through
 * their section's region.
 */
export function HomeIdentityPanels({
  channel,
  homeWorkspaceId,
  currentUserId,
}: {
  /** `null` = no container to read shared identities from (no row, or an unbound link). */
  channel: Channel | null;
  /** `POST /api/boot`'s `workspace`; null until onboarded — Personal is then UNAVAILABLE, not empty. */
  homeWorkspaceId: string | null;
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  /** The personal row whose knowledge popup is open. Pane state, so a channel switch tears it
   *  down instead of retargeting it. */
  const [attaching, setAttaching] = useState<AgentIdentity | null>(null);
  const cardLaunch = useCardLaunch(channel);

  // The container read is unfiltered: `?shelf=` is a tenancy and the container is not the
  // caller's personal one. The create gate is the WORKSPACE role (has `guest`), not
  // `Channel.role`; `EMPTY_WORKSPACE_ROLE` hides it for one paint. The server floor is the fence.
  const canCreateShared = meetsMinRole(
    channel?.myWorkspaceRole ?? EMPTY_WORKSPACE_ROLE,
    "member"
  );
  const containerList = useAgentIdentities(channel?.workspaceId ?? null);
  const homeList = useAgentIdentities(homeWorkspaceId, { shelf: HOME_SHELF });

  const containerGroups = useMemo(
    () => groupByVisibility(containerList.identities),
    [containerList.identities]
  );
  const homeGroups = useMemo(
    () => groupByVisibility(homeList.identities),
    [homeList.identities]
  );

  // `groupByVisibility` drops container `team`/`private` rows: no section lists them.
  const shared = containerGroups.workspace;
  // `isMine` is not redundant with `?shelf=home`: the home workspace can hold another member's
  // workspace-visible row, and Personal is the caller's own.
  const personal = useMemo(
    () => homeGroups.private.filter((t) => isMine(t, currentUserId)),
    [homeGroups.private, currentUserId]
  );

  const markerFor = useContainerAuthorMarker(channel, currentUserId);

  // No channel replaces the SHARED section only; Personal needs no channel.
  const hasChannel = channel !== null;

  if (hasChannel && containerList.error) {
    return (
      <PageError
        error={containerList.error}
        onRetry={() => containerList.refetch()}
      />
    );
  }

  // With no channel the container read is disabled and never resolves, so the skeleton waits
  // only while there is a container read to wait for.
  if (hasChannel && !containerList.resolved) {
    return <HomeIdentityPanelsSkeleton />;
  }

  const scopeUnavailable = homeWorkspaceId === null;
  // A failed read is a settled answer, not a pending one: `resolved` stays false forever on a
  // 4xx/5xx, so failure must outrank pending (F-339).
  const scopeFailed = homeWorkspaceId !== null && homeList.error != null;
  const scopePending =
    homeWorkspaceId !== null && !homeList.resolved && !scopeFailed;

  // `null` = not onboarded: the button disables rather than writing into the container.
  const homeSpaceCreateTarget: EditorTarget | null =
    homeWorkspaceId !== null ? { where: "home", identity: null } : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {channel === null ? (
        <EmptyState
          icon={Bot}
          title="No channel selected"
        />
      ) : (
      <SharedIdentitySection
        section={SECTIONS_CONTAINER[0]}
        identities={shared}
        markerFor={markerFor}
        onOpen={(identity) => setEditing({ where: "container", identity })}
        // Creates at `visibility: 'workspace'`, which IS "shared into this channel". Hidden, not
        // disabled, below the POST floor (member) so a guest never meets a dead control.
        action={
          canCreateShared ? (
            <CreateButton onClick={() => setEditing({ where: "container", identity: null })}>
              Agent Identity
            </CreateButton>
          ) : null
        }
      />
      )}

      <PrivateIdentitySection
        section={SECTION_PRIVATE_EVERYWHERE}
        identities={personal}
        unavailable={scopeUnavailable ? SCOPE_UNAVAILABLE : null}
        pending={scopePending}
        // The section's own failure, sentence + retry in place: the shared section still loaded.
        failure={
          scopeFailed
            ? {
                message: agentIdentityErrorMessage(
                  homeList.error,
                  "Couldn't load your own identities."
                ),
                onRetry: () => homeList.refetch(),
              }
            : null
        }
        // A personal row is edited in the home workspace, the id its PATCH and cache entry take.
        onOpen={(identity) => setEditing({ where: "home", identity })}
        // No channel = no launch target, and the knowledge box shares the card's one action slot.
        cardActionFor={
          channel === null
            ? undefined
            : (identity) => (
                <div className="flex w-full flex-col gap-1.5">
                  <AddKnowledgeWell
                    // Stale-cache fallback: `knowledge` joined an already-persisted payload (INVARIANTS §8).
                    refs={identity.knowledge ?? EMPTY_KNOWLEDGE}
                    identityName={identity.name}
                    onClick={() => setAttaching(identity)}
                  />
                  {cardLaunch.error?.identityId === identity.id && (
                    <p role="alert" className="text-caption text-danger">
                      {cardLaunch.error.message}
                    </p>
                  )}
                  {/* No launch op on this build (a plain browser) = no button. */}
                  {cardLaunch.canLaunch && (
                    <div className="flex justify-end">
                      <LaunchIntoChannelButton
                        busy={cardLaunch.busyId === identity.id}
                        // The double-submit guard is the pane's, so every other row is inert.
                        disabled={cardLaunch.busyId !== null}
                        onClick={() => cardLaunch.launch(identity)}
                      />
                    </div>
                  )}
                </div>
              )
        }
        action={
          <CreateButton
            disabled={homeSpaceCreateTarget === null}
            onClick={() => setEditing(homeSpaceCreateTarget)}
          >
            Agent Identity
          </CreateButton>
        }
      />

      {/* Mounted only while open; two components because the two mounts differ (`identity-editor.tsx`). */}
      {editing?.where === "container" && channel !== null && (
        <ContainerIdentityEditor
          workspaceId={channel.workspaceId}
          identity={editing.identity}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.where === "home" && homeWorkspaceId && (
        <HomeWorkspaceIdentityEditor
          workspaceId={homeWorkspaceId}
          identity={editing.identity}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Against the HOME workspace: the patch must hit the shelf-keyed entry the section read. */}
      {attaching && homeWorkspaceId && (
        <IdentityKnowledgeDialog
          identity={attaching}
          workspaceId={homeWorkspaceId}
          onClose={() => setAttaching(null)}
        />
      )}
    </div>
  );
}

function isMine(identity: AgentIdentity, currentUserId: string): boolean {
  return identity.createdBy === currentUserId;
}

/** What the editor is open on. `where` is the row's own workspace, never the section's. */
interface EditorTarget {
  where: "container" | "home";
  /** `null` = create. */
  identity: AgentIdentity | null;
}

/** No home workspace yet — a different sentence from "none here". */
const SCOPE_UNAVAILABLE = "Finish setting up your home space to keep identities there.";

// ── The two sections: `identity-section.tsx`'s flat `IdentityPanel` + `IdentityGrid`, never
// `SectionBox` (/home has no concave surface; swept by `identity-editor-surface.test.tsx`).

/** The channel's shared identities — who else in this relationship can wear them. */
function SharedIdentitySection({
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
function PrivateIdentitySection({
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
function useContainerAuthorMarker(
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
