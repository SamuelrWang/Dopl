import { useMemo, useState } from "react";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import {
  IdentitiesHome,
  personalState,
  type IdentityHome,
} from "@/features/agent-identities/components/identities-home";
import { authorMarker } from "@/features/agent-identities/components/identity-picker";
import { useAgentIdentities } from "@/features/agent-identities/hooks/use-agent-identities";
import { groupByVisibility } from "@/features/agent-identities/lib/visibility";
import { AGENT_RUN_PRESENTER } from "@/features/channels/components/agent-run-presenter";
import { useDesktopSessions } from "@/features/channels/components/use-desktop-sessions";
import { signInToRuntime } from "@/features/channels/components/runtime-signin";
import { useLaunchSelection } from "@/features/channels/hooks/use-launch-selection";
import { signInFailedCopy } from "@/features/channels/lib/runtime-copy";
import { HOME_PREVIEW_PATH, type HomePreview } from "@/features/home/preview-types";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { toast } from "@/shared/ui/toast";
import { EMPTY_PEERS, EMPTY_WORKSPACE_ROLE, type Channel } from "@/features/channels/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError } from "#/components/page-states";
import { channelPeople } from "./home-rows";
import { HomeIdentityPanelsSkeleton } from "./home-skeleton";
import type { HomeViewer } from "./home-settings-control";
import { HomeKnowledgeDialog } from "./identity-card-knowledge";
import { useCardLaunch } from "./identity-card-launch";
import {
  ContainerIdentityEditor,
  HOME_SHELF,
  HomeWorkspaceIdentityEditor,
} from "./identity-editor";

/**
 * /home → Identities, wired. SHARED is the selected channel's link container at
 * `visibility: "workspace"`; PERSONAL is the caller's own private identities on the home shelf.
 * Only a personal card launches: a launch resolves an identity in one workspace. Two reads share
 * one path in two workspaces, so writes patch the ENTRY key, never the path prefix (F-331,
 * INVARIANTS §8). The face itself is `agent-identities/components/identities-home.tsx`.
 */
export function HomeIdentityPanels({
  channel,
  homeWorkspaceId,
  currentUserId,
  viewer,
}: {
  /** `null` = no container to read shared identities from (no row, or an unbound link). */
  channel: Channel | null;
  /** `POST /api/boot`'s `workspace`; null until onboarded — Personal is then UNAVAILABLE, not empty. */
  homeWorkspaceId: string | null;
  currentUserId: string;
  viewer: HomeViewer | null;
}) {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  /** The personal row whose knowledge popup is open. Pane state, so a channel switch tears it
   *  down instead of retargeting it. */
  const [attaching, setAttaching] = useState<AgentIdentity | null>(null);
  const cardLaunch = useCardLaunch(channel);
  const launch = useLaunchSelection({ kind: "defaults" });
  const { sessions } = useDesktopSessions();
  const roster = useRoster(channel, currentUserId, viewer);
  const preview = useApiQuery<HomePreview>(HOME_PREVIEW_PATH).data?.identities ?? null;

  // The container read is unfiltered: `?shelf=` is a tenancy and the container is not the
  // caller's personal one. The create gate is the WORKSPACE role (has `guest`), not
  // `Channel.role`; `EMPTY_WORKSPACE_ROLE` hides it for one paint. The server floor is the fence.
  const canCreateShared = meetsMinRole(channel?.myWorkspaceRole ?? EMPTY_WORKSPACE_ROLE, "member");
  const containerList = useAgentIdentities(channel?.workspaceId ?? null);
  const homeList = useAgentIdentities(homeWorkspaceId, { shelf: HOME_SHELF });

  // `groupByVisibility` drops container `team`/`private` rows: no section lists them.
  const shared = useMemo(
    () => groupByVisibility(containerList.identities).workspace,
    [containerList.identities]
  );
  // `isMine` is not redundant with `?shelf=home`: the home workspace can hold another member's
  // workspace-visible row, and Personal is the caller's own.
  const personal = useMemo(
    () =>
      groupByVisibility(homeList.identities).private.filter((t) => t.createdBy === currentUserId),
    [homeList.identities, currentUserId]
  );

  const runtimeLabel = (id: string) => launch.runtimes.find((r) => r.id === id)?.label || id;
  // The registered runtimes, plus any a row names that this desktop does not register.
  const runtimeIds = new Set(launch.runtimes.map((r) => r.id));
  for (const identity of [...shared, ...personal]) {
    if (identity.runtime) runtimeIds.add(identity.runtime);
  }
  const runtimes = [...runtimeIds].map((id) => ({ id, label: runtimeLabel(id) }));
  const fixRuntime = (id: string) =>
    void signInToRuntime(id).then((res) => {
      if (!res.ok) toast({ title: signInFailedCopy({ id, label: runtimeLabel(id) }) });
    });

  if (channel !== null && containerList.error) {
    return <PageError error={containerList.error} onRetry={() => containerList.refetch()} />;
  }
  // With no channel the container read is disabled and never resolves, so the skeleton waits
  // only while there is a container read to wait for.
  if (channel !== null && !containerList.resolved) return <HomeIdentityPanelsSkeleton />;

  return (
    <>
      <IdentitiesHome
        shared={
          channel === null
            ? null
            : {
                channelName: channel.name,
                identities: shared,
                markerFor: roster.markerFor,
                canCreate: canCreateShared,
                peers: roster.others,
              }
        }
        personal={{
          identities: personal,
          state: personalState(homeWorkspaceId, homeList),
          canCreate: homeWorkspaceId !== null,
          // No channel = no launch target, so a personal card has no footer.
          footer:
            channel === null ? undefined : { launch: cardLaunch, onAddKnowledge: setAttaching },
        }}
        card={{ photoFor: roster.photoFor, runtimeLabel, catalogs: launch.catalogs }}
        sessions={sessions}
        preview={preview}
        onFixRuntime={fixRuntime}
        agents={AGENT_RUN_PRESENTER}
        runtimes={runtimes}
        currentUserId={currentUserId}
        viewerPhoto={viewer?.avatarUrl ?? null}
        ownerName={roster.ownerName}
        onCreate={(where) => setEditing({ where, identity: null })}
        onEdit={(where, identity) => setEditing({ where, identity })}
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
        <HomeKnowledgeDialog
          identity={attaching}
          workspaceId={homeWorkspaceId}
          onClose={() => setAttaching(null)}
        />
      )}
    </>
  );
}

/** What the editor is open on. `where` is the row's own workspace, never the section's. */
interface EditorTarget {
  where: IdentityHome;
  /** `null` = create. */
  identity: AgentIdentity | null;
}

/**
 * Who the channel's people are, off the payload (no request): the authorship marker, owner
 * photos, names and the members who can wear a shared row. The marker is a security signal
 * (INVARIANTS §5A): an author the roster cannot name still reads "by another member".
 */
function useRoster(channel: Channel | null, currentUserId: string, viewer: HomeViewer | null) {
  // Keyed on `channel`, the stable object the cache hands back, not on the peer list.
  return useMemo(() => {
    const peers = channel ? channelPeople(channel) : EMPTY_PEERS;
    // A nameless peer is left out, not entered blank: `authorMarker` would render "by ".
    const names = new Map<string, string>();
    for (const peer of peers) if (peer.displayName) names.set(peer.userId, peer.displayName);
    return {
      markerFor: (identity: AgentIdentity) => authorMarker(identity, currentUserId, names),
      photoFor: (identity: AgentIdentity) =>
        identity.createdBy === currentUserId
          ? (viewer?.avatarUrl ?? null)
          : (peers.find((p) => p.userId === identity.createdBy)?.avatarUrl ?? null),
      ownerName: (userId: string) => names.get(userId) ?? null,
      others: peers.map((p) => ({
        userId: p.userId,
        displayName: p.displayName ?? p.email ?? "Member",
        avatarUrl: p.avatarUrl,
      })),
    };
  }, [channel, currentUserId, viewer]);
}
