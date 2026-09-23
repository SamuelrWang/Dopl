import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { agentIdentityErrorMessage } from "@/features/agent-identities/client/api";
import { useAgentIdentities } from "@/features/agent-identities/hooks/use-agent-identities";
import { EMPTY_KNOWLEDGE } from "@/features/agent-identities/lib/knowledge-scopes";
import {
  SECTIONS_CONTAINER,
  SECTION_PRIVATE_EVERYWHERE,
  groupByVisibility,
} from "@/features/agent-identities/lib/visibility";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import {
  EMPTY_WORKSPACE_ROLE,
  type Channel,
} from "@/features/channels/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError } from "#/components/page-states";
import {
  PrivateIdentitySection,
  SharedIdentitySection,
  useContainerAuthorMarker,
} from "./identity-panel-cards";
import {
  ContainerIdentityEditor,
  HomeWorkspaceIdentityEditor,
} from "./identity-editor";
import { LaunchIntoChannelButton, useCardLaunch } from "./identity-card-launch";
import { AddKnowledgeWell, IdentityKnowledgeDialog } from "./identity-card-knowledge";
import { CreateButton } from "./panel-buttons";
import { HomeIdentityPanelsSkeleton } from "./home-skeleton";

/**
 * /home → Agents. THE THREE IDENTITY SCOPES OF ONE CHANNEL (Samuel, 2026-08-26;
 * `docs/specs/home-agents-tab.plan.md` §1):
 *
 *   A  SHARED, in this channel — this channel's link CONTAINER, `visibility ===
 *                  "workspace"`. Inside a container that value means THE OTHER
 *                  PERSON, so the heading is **"Shared in this channel", never
 *                  "Public"** — and it lives in `agent-identities/lib/
 *                  visibility.ts › SECTIONS_CONTAINER`, never hand-typed here.
 *   B  PRIVATE, in this channel — container identities, `private`, the caller's.
 *   C  PRIVATE, across all channels — the same question of the caller's HOME
 *                  workspace (`POST /api/boot`'s `workspace`).
 *
 * B and C share one section with a scope dropdown (one shelf at two ranges); A
 * is its own because it answers a different QUESTION — who else may wear this
 * identity.
 *
 * ⚠ "AGENTS" NAMES TWO THINGS AND BOTH NAMES STAY (Samuel's ruling Q6,
 * 2026-08-26): THIS face lists AGENT IDENTITIES, the channel info column's
 * **Agents** tab (`channels/components/agents-tab.tsx`) lists RUNNING SESSIONS. The
 * collision is RECORDED (INVARIANTS §5A), not resolved; a rename needs his word.
 *
 * 🔒 **THE PERSONAL CARD LAUNCHES SINCE 2026-09-22 (Samuel), SUPERSEDING
 * "NO LAUNCH CONTROL, DELIBERATELY" (§4.6, §5A).** That rule was written against
 * a second launch FORM — the Channels face's popup reads this same list, and two
 * places to CHOOSE a model, a runtime and a colour is how the two come to
 * disagree. The card offers no choices: one click sends the identity id and
 * nothing else (`identity-card-launch.tsx`), so `resolve` is still resolved in one
 * place and the popup is still the only surface that can re-point a spawn.
 * ⚠ **THE SHARED SECTION HAS NO LAUNCH.** Its rows are the CONTAINER's, the
 * launch payload resolves an identity in ONE workspace, and Samuel's ruling names
 * the personal card. CREATE and EDIT are the authoring half and stay.
 *
 * ⚠ THE CREATE AFFORDANCE FOLLOWS THE SCOPE PILL (Knowledge-wave ruling 6): "in
 * this channel" writes into the CONTAINER, "across all channels" into the home
 * workspace. It sits beside the pill it obeys, and that pill also decides which
 * workspace's teams and bases the editor may ask for (`identity-editor.tsx`).
 *
 * ⚠ TWO READS, ONE PATH, TWO WORKSPACES — F-331's shape. `GET
 * /api/agent-identities` is cached under `[path, workspaceId, undefined]` twice,
 * so writes patch the ENTRY key, never the path PREFIX (INVARIANTS §8). No
 * channel-scoped key is needed: the workspace element distinguishes them.
 *
 * ⚠ ONE LAYOUT FOR ALL THREE TABS (`index.tsx`): this renders INSIDE the record
 * pane, never moving the conversation column and never going full-width.
 *
 * 🔒 **BOTH SECTION BUTTONS READ "+ Agent Identity" (Samuel, 2026-09-09; the word was
 * "template" until the 2026-09-22 rename — Samuel: *"it's going to say + Agent Identity"*), on the
 * page's black `h-9` pill** (`panel-buttons.tsx › CreateButton`) — the SECTION
 * names the destination, so the button says only what it makes. **The two
 * accessible names are identical on purpose**: reach them through their section
 * (`getByRole("region", { name: … })`), never by button name alone.
 */
export function HomeIdentityPanels({
  channel,
  homeWorkspaceId,
  homeWorkspaceSegment,
  currentUserId,
}: {
  /** `null` when the selected row is a legacy unbound LINK, or when there is
   *  no row at all — both are "no container to read identities from". */
  channel: Channel | null;
  /** ⚠ `POST /api/boot`'s `workspace`, which is NULL until the caller is
   *  onboarded. Scope C is UNAVAILABLE, not empty, when it is. */
  homeWorkspaceId: string | null;
  /** Same payload's `segment` — the canonical `{slug}-{publicId}` the home
   *  workspace's TEAMS read is keyed by, and the only reason this face needs it.
   *  Null with `homeWorkspaceId`.
   *  ⚠ Boot's `role` is STILL deliberately not taken, and the reason narrowed
   *  2026-09-17 (F-343): the PERSONAL section is the caller's own home shelf,
   *  where a role prop would be a second, weaker copy of the server's floor. The
   *  SHARED section is a different container and a different reader — its gate
   *  rides on `channel.myWorkspaceRole`, which is the row the server itself
   *  reads — NOT `channel.role`, which is the CHANNEL role. */
  homeWorkspaceSegment: string | null;
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  /**
   * The PERSONAL row whose knowledge popup is open (Samuel, 2026-09-22).
   *
   * ⚠ **IT REPLACED `sharing`**, which held the row waiting on the grant
   * dialog's confirm step — the card's second control is a LAUNCH now, and
   * `agent-share.tsx` is deleted with it (`dopl_agent(op="grant")` still writes
   * a grant). The state is kept in the PANE rather than in the card so a channel
   * switch tears it down: a dialog held across one would silently retarget.
   */
  const [attaching, setAttaching] = useState<AgentIdentity | null>(null);
  /** The card launch lane — one in flight, per-row spinner, per-row refusal. */
  const cardLaunch = useCardLaunch(channel);

  // ⚠ A CONTAINER READ IS UNFILTERED. A shelf is a TENANCY and this container is
  // not the caller's personal one, so `?shelf=` here would be a question with one
  // possible answer.
  // ⚠ **THE WORKSPACE ROLE (`myWorkspaceRole`), NOT `Channel.role`** — the
  // identity create is floored on `workspace_members.role`, the only ladder with
  // a `guest` rung; `Channel.role` is the channel's own `owner|member`.
  // ⚠ §8 STALE-CACHE, SPELLED INLINE: `EMPTY_WORKSPACE_ROLE` (rank 0) hides the
  // create for one paint rather than offering a write the server would refuse.
  const canCreateShared = meetsMinRole(
    channel?.myWorkspaceRole ?? EMPTY_WORKSPACE_ROLE,
    "member"
  );
  const containerList = useAgentIdentities(channel?.workspaceId ?? null);
  // ⚠ NO LONGER LAZY (2026-08-27). It was gated on the scope pill; with the
  // pill gone Personal is ALWAYS on screen, so a deferred read would just be a
  // guaranteed second round trip after first paint.
  const homeList = useAgentIdentities(homeWorkspaceId, { shelf: HOME_SHELF });

  const containerGroups = useMemo(
    () => groupByVisibility(containerList.identities),
    [containerList.identities]
  );
  const homeGroups = useMemo(
    () => groupByVisibility(homeList.identities),
    [homeList.identities]
  );

  // ⚠ `groupByVisibility` DROPS a `team` row rather than filing it elsewhere. In
  // a container `team` is a DEAD value — there are no teams to link (§4A) — and
  // a surface that swept it into "Shared in this channel" would be inventing a
  // sharing fact nobody stored (§11). ⚠ SINCE 2026-08-27 A CONTAINER `private`
  // ROW IS DROPPED THE SAME WAY: the section that listed it is gone, and the
  // editor no longer offers the value (`lib/visibility.ts`).
  const shared = containerGroups.workspace;
  // ⚠ THE `isMine` HALF IS NOT REDUNDANT WITH `?shelf=home`. The shelf says
  // WHICH SHELF; `canSeeIdentity` already drops other people's private rows, but
  // the home workspace can hold a member's `workspace`-visible identity too, and
  // Personal is the caller's own things. Two questions, both asked.
  const personal = useMemo(
    () => homeGroups.private.filter((t) => isMine(t, currentUserId)),
    [homeGroups.private, currentUserId]
  );

  const markerFor = useContainerAuthorMarker(channel, currentUserId);

  // 🔒 **NO CHANNEL REPLACES SECTION A, NOT THE WHOLE FACE (2026-09-10, the
  // new-user flow).** This used to return the empty state INSTEAD of the pane, so
  // a brand-new account — no channels yet, which is every account on its first
  // day — opened Agents and was told to "pick one on the left" beside an empty
  // list, with its own Personal identities (a HOME-workspace read that needs no
  // channel at all) nowhere on screen and no way to make one. The sentence is
  // true of section A and only of section A: `channel === null` means there is no
  // CONTAINER to read shared identities from, and says nothing about scope C.
  const hasChannel = channel !== null;

  if (hasChannel && containerList.error) {
    return (
      <PageError
        error={containerList.error}
        onRetry={() => containerList.refetch()}
      />
    );
  }

  // ⚠ NEITHER SECTION MAY STATE AN EMPTINESS IT HAS NOT MEASURED. The pane
  // waits for the CONTAINER read; the private section waits separately for the
  // HOME one, because only that half of it moved when the pill did.
  // ⚠ ONLY WHILE THERE IS A CONTAINER READ TO WAIT FOR. With no channel the
  // container read is never ENABLED (`use-agent-identities.ts`: `null` workspace
  // → disabled, `resolved` false forever), so gating on it here would hold the
  // skeleton up permanently — UNAVAILABLE read as PENDING, which is the exact
  // shape of F-339 one scope over.
  if (hasChannel && !containerList.resolved) {
    // ⚠ THIS FACE'S OWN SHAPE — two flat sections over `IdentityGrid`'s
    // auto-fill card grid — not the shared page ghost.
    return <HomeIdentityPanelsSkeleton label="Loading identities" />;
  }

  const scopeUnavailable = homeWorkspaceId === null;
  // ⚠ A FAILED SCOPE-C READ IS A SETTLED ANSWER, NOT A PENDING ONE, AND THE
  // DIFFERENCE IS THE WHOLE OF F-339. `resolved` is
  // `data !== undefined`, so a 403/404/500 leaves it FALSE FOREVER — read as
  // "still pending" that painted a blank body with no sentence AND held the
  // pill in `pendingRow(true)` = `pointer-events-none`, so the operator could
  // not switch back to "in this channel". The only escape was leaving the tab.
  // M0's own argument is that a 403/404 on this face is an ORDINARY answer
  // (`use-agent-identities.ts`): an ordinary answer must be SAID, and it must
  // never take the control that undoes it (§5A: UNKNOWN is not EMPTY, and it is
  // not a trap either).
  const scopeFailed = homeWorkspaceId !== null && homeList.error != null;
  const scopePending =
    homeWorkspaceId !== null && !homeList.resolved && !scopeFailed;

  // ⚠ WHICH WORKSPACE A NEW PERSONAL AGENT WOULD LAND IN — `null` = nowhere,
  // which is the "not onboarded yet" case and disables the button rather than
  // writing into the container the section is not about.
  const personalCreateTarget: EditorTarget | null =
    homeWorkspaceId !== null && homeWorkspaceSegment !== null
      ? { where: "home", identity: null }
      : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {channel === null ? (
        // ⚠ IN THE SECTION'S PLACE, not the pane's. Same sentence as before, now
        // scoped to the thing it is actually about.
        <EmptyState
          icon={Bot}
          title="No channel selected"
          description="Agents shared in a channel are per channel — pick one on the left."
        />
      ) : (
      <SharedIdentitySection
        section={SECTIONS_CONTAINER[0]}
        identities={shared}
        markerFor={markerFor}
        onOpen={(identity) => setEditing({ where: "container", identity })}
        // ⚠ CREATES DIRECTLY AT `visibility: 'workspace'` — there is no grant
        // table for identities, so "shared into this channel" IS that value, and
        // `ContainerIdentityEditor` now opens on it because
        // `SECTIONS_CONTAINER` offers nothing else (`lib/visibility.ts`).
        // 🔒 **GATED ON THE CALLER'S REAL ROLE (2026-09-17, F-343's consequence
        // 1b).** `POST /api/agent-identities` is `minRole: "member"`, so a GUEST
        // peer's click was a 403 the editor surfaced — a dead control (INVARIANTS
        // §5) shown because the pane could not tell a member from a guest. It can
        // now, and it asks the SAME ladder the server asks rather than restating
        // the floor. ⚠ **THE SERVER FENCE IS UNCHANGED AND IS STILL THE FENCE.**
        // ⚠ HIDDEN, NOT DISABLED — one fix, the same shape as the Knowledge face's
        // (`knowledge-panels.tsx`), because it is the same finding.
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
        // ⚠ THE SECTION'S OWN FAILURE, NOT THE PANE'S. The container read gets
        // `PageError` over the whole pane because without it there is no pane;
        // the home read is ONE SECTION's body, and blanking the pane for it
        // would take away the shared section too. Sentence + retry, in place.
        // 🔒 F-339: a FAILED read is a SETTLED answer, not a pending one —
        // `resolved` stays false forever on a 403/404/500, so without this the
        // body sat blank with no sentence. Keep the three states distinct.
        failure={
          scopeFailed
            ? {
                message: agentIdentityErrorMessage(
                  homeList.error,
                  "Couldn't load your own agents."
                ),
                onRetry: () => homeList.refetch(),
              }
            : null
        }
        // ⚠ EDITED WHERE IT LIVES. A Personal row is a HOME-workspace row, so
        // its editor addresses the home workspace — the same id its PATCH and
        // its cache entry take (F-331, now with the SHELF as a second axis).
        onOpen={(identity) => setEditing({ where: "home", identity })}
        // ⚠ EVERY PERSONAL ROW CARRIES IT. It used to be scope-C only because
        // scope B's rows were already in the container; there is no scope B any
        // more, so the condition has no second branch to guard against.
        // ⚠ AND NOT WITH NO CHANNEL TO LAUNCH INTO. The launch takes
        // `channel.id`; offering the button with nothing selected would be an
        // affordance whose only outcome is a crash. ⚠ THE KNOWLEDGE BOX GOES
        // WITH IT even though attaching needs no channel — the two are ONE
        // control slot (`identity-section.tsx › IdentityCard` carries exactly
        // one), and a card that showed half of it would be a second layout
        // nobody ruled on.
        cardActionFor={
          channel === null
            ? undefined
            : (identity) => (
                <div className="flex w-full flex-col gap-1.5">
                  <AddKnowledgeWell
                    // ⚠ §8's STALE-CACHE FALLBACK, SPELLED INLINE: `knowledge`
                    // was added to an already-persisted payload.
                    refs={identity.knowledge ?? EMPTY_KNOWLEDGE}
                    identityName={identity.name}
                    onClick={() => setAttaching(identity)}
                  />
                  {cardLaunch.error?.identityId === identity.id && (
                    <p role="alert" className="text-caption text-danger">
                      {cardLaunch.error.message}
                    </p>
                  )}
                  {/* ⚠ BOTTOM-RIGHT (Samuel, 2026-09-22). The row is what puts
                      it there; the slot itself is full-width and bottom-anchored
                      in `IdentityCard`. */}
                  <div className="flex justify-end">
                    <LaunchIntoChannelButton
                      busy={cardLaunch.busyId === identity.id}
                      // ⚠ EVERY OTHER ROW IS INERT WHILE ONE LAUNCHES — the
                      // double-submit guard is the pane's, so the cards say so.
                      disabled={
                        !cardLaunch.canLaunch || cardLaunch.busyId !== null
                      }
                      onClick={() => cardLaunch.launch(identity)}
                    />
                  </div>
                </div>
              )
        }
        action={
          <CreateButton
            disabled={personalCreateTarget === null}
            onClick={() => setEditing(personalCreateTarget)}
          >
            Agent Identity
          </CreateButton>
        }
      />

      {/* ⚠ MOUNTED ONLY WHILE OPEN, and the two mounts are DIFFERENT COMPONENTS
          — see `identity-editor.tsx`: a container must not fetch teams, and that is
          a rule you cannot state with a conditional hook. */}
      {editing?.where === "container" && channel !== null && (
        <ContainerIdentityEditor
          workspaceId={channel.workspaceId}
          identity={editing.identity}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.where === "home" && homeWorkspaceId && homeWorkspaceSegment && (
        <HomeWorkspaceIdentityEditor
          workspaceId={homeWorkspaceId}
          workspaceSegment={homeWorkspaceSegment}
          identity={editing.identity}
          onClose={() => setEditing(null)}
        />
      )}

      {/* ⚠ MOUNTED ONLY WHILE OPEN, and against the HOME workspace: a personal
          row's knowledge lives where the row does, and the patch must address
          the same shelf-keyed cache entry the section read
          (`HOME_SHELF`, F-331 with the shelf as the second axis). */}
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

/** Scope B and C ask the same question of two workspaces. */
function isMine(identity: AgentIdentity, currentUserId: string): boolean {
  return identity.createdBy === currentUserId;
}

/**
 * 🔒 PERSONAL READS ONE SHELF, NOT ONE WORKSPACE (Samuel's ruling 2026-08-27,
 * `20260901120000_agent_template_home_scoped.sql`) — the sibling of the
 * Knowledge face's `HOME_SHELF`, and the same trap: `?shelf=home` is a server
 * `WHERE`, there is no client-side filter to fall back on, and a forgotten
 * argument WIDENS silently. It is a module constant threaded through the read
 * and (via `useAgentIdentityWrites`) the cache key, so it cannot be spelled two
 * ways.
 */
const HOME_SHELF = "home" as const;

/**
 * What the editor is open ON.
 *
 * ⚠ `where` IS THE TARGET WORKSPACE, NOT THE PILL. Section A's rows are
 * container rows whatever the pill says, so the two cannot be one value — a
 * shared row opened while the pill reads "across all channels" is still edited
 * in the container it lives in.
 */
interface EditorTarget {
  where: "container" | "home";
  /** `null` = create. */
  identity: AgentIdentity | null;
}

/** No home workspace yet — a different sentence from "none here". */
const SCOPE_UNAVAILABLE = "Finish setting up your home space to keep agents there.";

