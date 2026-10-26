/**
 * STAGING COPY of `apps/desktop-ui/src/pages/home/identity-panels.tsx` (the shipping desktop
 * /home → Identities face). Markup, classes and logic verbatim; the hooks underneath are the
 * staging in-memory ones. Only change: `Channel` is `StagingChannel`.
 */
import { useMemo, useState } from "react";
import { agentIdentityErrorMessage } from "@/features/agent-identities/client/api";
import { authorMarker } from "@/features/agent-identities/components/identity-picker";
import { useAgentIdentities } from "@/features/identities-staging/agent-identities/hooks/use-agent-identities";
import { EMPTY_KNOWLEDGE } from "@/features/agent-identities/lib/knowledge-scopes";
import {
  SECTIONS_CONTAINER,
  SECTION_PRIVATE_EVERYWHERE,
  groupByVisibility,
} from "@/features/agent-identities/lib/visibility";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { EMPTY_PEERS, EMPTY_WORKSPACE_ROLE } from "@/features/channels/types";
// STAGING: the channel is the staged subset of `Channel`, and `home-rows.ts`'s helper is ported
// over it (`../data.ts`).
import {
  CONTAINER_WORKSPACE_ID,
  STAGING_CATALOGS,
  channelPeople,
  identityCardFace,
  identityCardStats,
  type StagingChannel as Channel,
} from "../data";
import { IdentityActivityPanel } from "../page/identity-activity-panel";
import { IdentityControls } from "../page/identity-controls";
import { IdentityPageHead } from "../page/identity-page-head";
import {
  activeEverywhere,
  arrangeIdentities,
  pageFeed,
  reachLabel,
  runtimeReadiness,
  type ChannelScope,
  type ReadinessScenario,
  type SortKey,
} from "../page/identity-page-data";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError } from "@/features/identities-staging/desktop/components/page-states";
import {
  ContainerIdentityEditor,
  HOME_SHELF,
  HomeWorkspaceIdentityEditor,
} from "./identity-editor";
import { LaunchIntoChannelButton, useCardLaunch } from "./identity-card-launch";
import { AddKnowledgeWell, IdentityKnowledgeDialog } from "./identity-card-knowledge";
import { CreateButton } from "./panel-buttons";
import {
  PrivateIdentitySection,
  SCOPE_UNAVAILABLE,
  SharedIdentitySection,
} from "./identity-sections";
import { IdentityViewDialog } from "../view/identity-view-dialog";
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
  readiness,
}: {
  /** `null` = no container to read shared identities from (no row, or an unbound link). */
  channel: Channel | null;
  /** `POST /api/boot`'s `workspace`; null until onboarded — Personal is then UNAVAILABLE, not empty. */
  homeWorkspaceId: string | null;
  currentUserId: string;
  /** STAGING ONLY: which runtime-readiness world to draw (the page's States pill). */
  readiness: ReadinessScenario;
}) {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  /** Item 2d: a card click OPENS THE VIEW, never the form. `where` rides along so the view's Edit
   *  button can hand the row to the editor that writes into its own workspace. */
  const [viewing, setViewing] = useState<ViewTarget | null>(null);
  /** The personal row whose knowledge popup is open. Pane state, so a channel switch tears it
   *  down instead of retargeting it. */
  const [attaching, setAttaching] = useState<AgentIdentity | null>(null);
  const cardLaunch = useCardLaunch(channel);
  /** The page's own state (item 3c): what it is scoped to, and how the grid is arranged. */
  const [scope, setScope] = useState<ChannelScope>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [runtimeFilter, setRuntimeFilter] = useState("all");

  // The container read is unfiltered: `?shelf=` is a tenancy and the container is not the
  // caller's personal one. The create gate is the WORKSPACE role (has `guest`), not
  // `Channel.role`; `EMPTY_WORKSPACE_ROLE` hides it for one paint. The server floor is the fence.
  const canCreateShared = meetsMinRole(
    channel?.myWorkspaceRole ?? EMPTY_WORKSPACE_ROLE,
    "member"
  );
  // ⚠ ITEM 3C: NOT `channel?.workspaceId`. The page shows every channel's shared identities by
  // default and the scope control narrows them, so the read no longer depends on which channel is
  // selected (Samuel: *"what is shown is basically tied to which channel is actually selected,
  // which I'm now thinking about is actually not necessarily the best"*). In the product this is a
  // new server read across the caller's channels — PORTING.md.
  const containerList = useAgentIdentities(CONTAINER_WORKSPACE_ID);
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

  // ⚠ The shared read no longer waits on a channel (item 3c), so its error and its skeleton no
  // longer do either.
  if (containerList.error) {
    return (
      <PageError
        error={containerList.error}
        onRetry={() => containerList.refetch()}
      />
    );
  }

  if (!containerList.resolved) {
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

  // ── The page's own three surfaces (item 3c) ──
  const arrange = { query, runtime: runtimeFilter, sort, scope };
  const sharedShown = arrangeIdentities(shared, arrange);
  const personalShown = arrangeIdentities(personal, arrange);
  const everything = [...shared, ...personal];
  const active = activeEverywhere(everything);
  const feed = pageFeed(everything);
  // A shared row is created INTO one channel, so the create button needs the page scoped to one.
  const scopedToChannel = scope !== "all";

  return (
    // ITEM 8 (2026-10-24): two columns, identities 3/4 left, Activity 1/4 right, each scrolling on
    // its own; one column on a narrow pane. Hand-written CSS (`staging.css › THE IDENTITIES PAGE
    // RAIL`), not Tailwind — see that block's 🔒.
    <div className="uis-idp-layout">
      <div className="uis-idp-cols">
        <div className="uis-idp-main">
          {/* ITEM 9: the head and the grid controls are ONE group (12px apart); the column gap
              (28px, `staging.css › ITEM 9`) is what separates the sections now the wells are gone. */}
          <div className="flex flex-col gap-3">
            {/* ── 1. What you are looking at, and whether it can run ── */}
            <IdentityPageHead
              scope={scope}
              onScope={setScope}
              runtimes={runtimeReadiness(readiness)}
              sharedCount={sharedShown.length}
              personalCount={personalShown.length}
            />

            {/* ── 2. The grid's own controls, directly above the grid ── */}
            <IdentityControls
              query={query}
              onQuery={setQuery}
              sort={sort}
              onSort={setSort}
              runtime={runtimeFilter}
              onRuntime={setRuntimeFilter}
              showing={sharedShown.length + personalShown.length}
              total={shared.length + personal.length}
            />
          </div>

          <SharedIdentitySection
            // The heading says the scope, because at "all channels" the container's own label
            // ("Shared in this channel") would be a lie.
            label={scopedToChannel ? `Shared in ${scope}` : "Shared across your channels"}
            emptyLine={
              scopedToChannel
                ? `No identities shared in ${scope}.`
                : SECTIONS_CONTAINER[0].emptyLine
            }
            identities={sharedShown}
            markerFor={markerFor}
            scopeFor={(identity) => reachLabel(identity, scope)}
            onOpen={(identity) => setViewing({ where: "container", identity })}
            // A shared row is created into ONE channel, so this needs the page narrowed to one.
            // Hidden, not disabled, below the POST floor (member) so a guest never meets a dead control.
            caption={
              canCreateShared && !scopedToChannel
                ? "Pick one channel to add a shared identity."
                : undefined
            }
            action={
              canCreateShared && scopedToChannel ? (
                <CreateButton onClick={() => setEditing({ where: "container", identity: null })}>
                  Agent Identity
                </CreateButton>
              ) : null
            }
          />

          <PrivateIdentitySection
            section={SECTION_PRIVATE_EVERYWHERE}
            identities={personalShown}
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
            onOpen={(identity) => setViewing({ where: "home", identity })}
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
                        <LaunchIntoChannelButton
                          busy={cardLaunch.busyId === identity.id}
                          // The double-submit guard is the pane's, so every other row is inert.
                          disabled={cardLaunch.busyId !== null}
                          onClick={() => cardLaunch.launch(identity)}
                        />
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
        </div>

        {/* ── 3. What your roles are doing, present and past: the right rail ── */}
        <aside className="uis-idp-aside" aria-label="Activity">
          <IdentityActivityPanel
            active={active}
            feed={feed}
            onOpen={(identity) =>
              setViewing({
                where: identity.visibility === "workspace" ? "container" : "home",
                identity,
              })
            }
          />
        </aside>
      </div>

      {/* The read-only view. Edit closes it and opens the editor on the same row, in the same
          workspace the card was read from. */}
      {viewing && (
        <IdentityViewDialog
          identity={viewing.identity}
          face={identityCardFace(viewing.identity)}
          stats={identityCardStats(viewing.identity)}
          marker={viewing.where === "container" ? markerFor(viewing.identity) : null}
          scopeLabel={
            viewing.where === "container"
              ? reachLabel(viewing.identity, scope) ?? undefined
              : undefined
          }
          catalogs={STAGING_CATALOGS}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      )}

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

/** What the VIEW is open on. Always a row: there is nothing to view about a row that does not
 *  exist yet, so create still opens the editor straight away. */
interface ViewTarget {
  where: "container" | "home";
  identity: AgentIdentity;
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
