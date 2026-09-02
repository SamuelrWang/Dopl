import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { agentTemplateErrorMessage } from "@/features/agent-templates/client/api";
import { useAgentTemplates } from "@/features/agent-templates/hooks/use-agent-templates";
import {
  SECTIONS_CONTAINER,
  SECTION_PRIVATE_EVERYWHERE,
  groupByVisibility,
} from "@/features/agent-templates/lib/visibility";
import type { AgentTemplate } from "@/features/agent-templates/client/types";
import type { HomeChannel } from "@/features/home/types";
import { PageError } from "#/components/page-states";
import {
  PrivateAgentSection,
  SharedAgentSection,
  useContainerAuthorMarker,
} from "./agent-panel-cards";
import {
  ContainerTemplateEditor,
  HomeWorkspaceTemplateEditor,
} from "./agent-editor";
import { CopyToChannelDialog, UseInThisChannelButton } from "./agent-copy";
import { CreateButton } from "./panel-buttons";
import { HomeAgentPanelsSkeleton } from "./home-skeleton";

/**
 * /home → Agents. THE THREE TEMPLATE SCOPES OF ONE CHANNEL (Samuel's rulings,
 * 2026-08-26; `docs/specs/home-agents-tab.plan.md` §1):
 *
 *   A  SHARED, in this channel — templates in this channel's link CONTAINER
 *                  with `visibility === "workspace"`. Inside a container that
 *                  value means the OTHER PERSON in the relationship, so the
 *                  heading is **"Shared in this channel", never "Public"** —
 *                  and the label lives in `agent-templates/lib/visibility.ts ›
 *                  SECTIONS_CONTAINER`, never hand-typed here.
 *   B  PRIVATE, in this channel — container templates that are `private` and
 *                  the caller's own.
 *   C  PRIVATE, across all channels — the same question asked of the caller's
 *                  HOME workspace, which is `POST /api/boot`'s `workspace`.
 *
 * B and C are one section with a scope dropdown, because they are the same
 * shelf seen at two ranges; A is its own section because it is a different
 * QUESTION (who else can wear this identity).
 *
 * ⚠ "AGENTS" NAMES TWO DIFFERENT THINGS AND BOTH NAMES STAY (Samuel's ruling
 * Q6, 2026-08-26). THIS face lists template IDENTITIES — durable, authored,
 * launchable later. The channel info column's **Agents** tab
 * (`channels-v2/agents-tab.tsx`) lists RUNNING SESSIONS. §5's noun rule ("the
 * noun on both is the AGENT") has tests behind it, so a rename needs Samuel's
 * word; the collision is RECORDED (INVARIANTS §5A) rather than resolved.
 *
 * ⚠ NO LAUNCH CONTROL, DELIBERATELY (§4.6, §5A). This is the AUTHORING half of
 * a lane that is already wired end to end: the Channels face's `TemplateLaunchPicker`
 * reads THIS SAME container list and launches from it (plan §0.2). A second
 * launch surface fights `resolve`'s singularity, so the absence is tested
 * (`agent-panels.test.tsx › what this pane deliberately leaves out`). CREATE and
 * EDIT are the opposite case: they are what "the authoring half" MEANS, and they
 * arrived in M3.
 *
 * ⚠ THE CREATE AFFORDANCE FOLLOWS THE SCOPE PILL (RULING 6 of the Knowledge
 * wave, applied here): "in this channel" writes into the CONTAINER, "across all
 * channels" into the caller's home workspace. It sits beside the pill it obeys,
 * so the two cannot be read apart — and the pill is also what decides which
 * workspace's teams and knowledge bases the editor is even allowed to ask for
 * (`agent-editor.tsx`).
 *
 * ⚠ TWO READS, ONE PATH, TWO WORKSPACES — and that is exactly the shape F-331
 * was about: `GET /api/agent-templates` cached under `[path, workspaceId,
 * undefined]` twice, so the writes patch the ENTRY key rather than the path
 * PREFIX or a create in one workspace appears under the other (INVARIANTS §8).
 * No channel-scoped key is needed here (unlike Knowledge): the workspace
 * element already distinguishes them, and this path has no `query` variants.
 *
 * ⚠ ONE LAYOUT FOR ALL THREE TABS (`index.tsx`): this renders INSIDE the record
 * pane. It never moves the conversation column and it never goes full-width.
 */
export function HomeAgentPanels({
  channel,
  homeWorkspaceId,
  homeWorkspaceSegment,
  currentUserId,
}: {
  /** `null` when the selected row is a legacy unbound LINK, or when there is
   *  no row at all — both are "no container to read templates from". */
  channel: HomeChannel | null;
  /** ⚠ `POST /api/boot`'s `workspace`, which is NULL until the caller is
   *  onboarded. Scope C is UNAVAILABLE, not empty, when it is. */
  homeWorkspaceId: string | null;
  /** Same payload's `segment` — the canonical `{slug}-{publicId}` the home
   *  workspace's TEAMS read is keyed by, and the only reason this face needs it.
   *  Null with `homeWorkspaceId`.
   *  ⚠ Boot's `role` is deliberately NOT taken. Nothing on this face is
   *  role-gated: the template write floor is member+ and it is the SERVER's
   *  (§5A), so a role prop here could only grow a second, weaker copy of it. */
  homeWorkspaceSegment: string | null;
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  /** The PERSONAL row waiting on its confirm step (plan §3, M4). */
  const [copying, setCopying] = useState<AgentTemplate | null>(null);

  // ⚠ A CONTAINER READ IS UNFILTERED. Shelves exist only in a standard
  // workspace — `resolveTemplateHomeScope` fences the marker to the caller's
  // own default one — so `?shelf=` on a container would be a question with one
  // possible answer.
  const containerList = useAgentTemplates(channel?.workspaceId ?? null);
  // ⚠ NO LONGER LAZY (2026-08-27). It was gated on the scope pill; with the
  // pill gone Personal is ALWAYS on screen, so a deferred read would just be a
  // guaranteed second round trip after first paint.
  const homeList = useAgentTemplates(homeWorkspaceId, { shelf: HOME_SHELF });

  const containerGroups = useMemo(
    () => groupByVisibility(containerList.templates),
    [containerList.templates]
  );
  const homeGroups = useMemo(
    () => groupByVisibility(homeList.templates),
    [homeList.templates]
  );

  // ⚠ `groupByVisibility` DROPS a `team` row rather than filing it elsewhere. In
  // a container `team` is a DEAD value — there are no teams to link (§4A) — and
  // a surface that swept it into "Shared in this channel" would be inventing a
  // sharing fact nobody stored (§11). ⚠ SINCE 2026-08-27 A CONTAINER `private`
  // ROW IS DROPPED THE SAME WAY: the section that listed it is gone, and the
  // editor no longer offers the value (`lib/visibility.ts`).
  const shared = containerGroups.workspace;
  // ⚠ THE `isMine` HALF IS NOT REDUNDANT WITH `?shelf=home`. The shelf says
  // WHICH SHELF; `canSeeTemplate` already drops other people's private rows, but
  // the home workspace can hold a member's `workspace`-visible template too, and
  // Personal is the caller's own things. Two questions, both asked.
  const personal = useMemo(
    () => homeGroups.private.filter((t) => isMine(t, currentUserId)),
    [homeGroups.private, currentUserId]
  );

  const markerFor = useContainerAuthorMarker(channel, currentUserId);

  if (channel === null) {
    return (
      <EmptyState
        icon={Bot}
        title="No channel selected"
        description="Agents are per channel — pick one on the left."
      />
    );
  }

  if (containerList.error) {
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
  if (!containerList.resolved) {
    // ⚠ THIS FACE'S OWN SHAPE — two flat sections over `TemplateGrid`'s
    // auto-fill card grid — not the shared page ghost.
    return <HomeAgentPanelsSkeleton label="Loading agents" />;
  }

  const scopeUnavailable = homeWorkspaceId === null;
  // ⚠ A FAILED SCOPE-C READ IS A SETTLED ANSWER, NOT A PENDING ONE, AND THE
  // DIFFERENCE IS THE WHOLE OF F-339. `resolved` is
  // `data !== undefined`, so a 403/404/500 leaves it FALSE FOREVER — read as
  // "still pending" that painted a blank body with no sentence AND held the
  // pill in `pendingRow(true)` = `pointer-events-none`, so the operator could
  // not switch back to "in this channel". The only escape was leaving the tab.
  // M0's own argument is that a 403/404 on this face is an ORDINARY answer
  // (`use-agent-templates.ts`): an ordinary answer must be SAID, and it must
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
      ? { where: "home", template: null }
      : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SharedAgentSection
        section={SECTIONS_CONTAINER[0]}
        templates={shared}
        markerFor={markerFor}
        onOpen={(template) => setEditing({ where: "container", template })}
        // ⚠ CREATES DIRECTLY AT `visibility: 'workspace'` — there is no grant
        // table for templates, so "shared into this channel" IS that value, and
        // `ContainerTemplateEditor` now opens on it because
        // `SECTIONS_CONTAINER` offers nothing else (`lib/visibility.ts`).
        // 🔒 SERVER-FENCED ONLY, AND KNOWINGLY: `POST /api/agent-templates` is
        // `minRole: "member"`, so a GUEST peer is refused with a 403 the editor
        // surfaces — but this pane cannot tell a member from a guest
        // (`HomeChannel` carries no viewer role, F-343). Do not guess.
        action={
          <CreateButton onClick={() => setEditing({ where: "container", template: null })}>
            New shared agent
          </CreateButton>
        }
      />

      <PrivateAgentSection
        section={SECTION_PRIVATE_EVERYWHERE}
        templates={personal}
        caption={PERSONAL_CAPTION}
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
                message: agentTemplateErrorMessage(
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
        onOpen={(template) => setEditing({ where: "home", template })}
        // ⚠ EVERY PERSONAL ROW CARRIES IT. It used to be scope-C only because
        // scope B's rows were already in the container; there is no scope B any
        // more, so the condition has no second branch to guard against.
        cardActionFor={(template) => (
          <UseInThisChannelButton
            disabled={copying !== null}
            onClick={() => setCopying(template)}
          />
        )}
        action={
          <CreateButton
            disabled={personalCreateTarget === null}
            onClick={() => setEditing(personalCreateTarget)}
          >
            New agent
          </CreateButton>
        }
      />

      {/* ⚠ MOUNTED ONLY WHILE OPEN, and the two mounts are DIFFERENT COMPONENTS
          — see `agent-editor.tsx`: a container must not fetch teams, and that is
          a rule you cannot state with a conditional hook. */}
      {editing?.where === "container" && (
        <ContainerTemplateEditor
          workspaceId={channel.workspaceId}
          template={editing.template}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.where === "home" && homeWorkspaceId && homeWorkspaceSegment && (
        <HomeWorkspaceTemplateEditor
          workspaceId={homeWorkspaceId}
          workspaceSegment={homeWorkspaceSegment}
          template={editing.template}
          onClose={() => setEditing(null)}
        />
      )}

      {copying && (
        <CopyToChannelDialog
          source={copying}
          containerWorkspaceId={channel.workspaceId}
          onClose={() => setCopying(null)}
          // ⚠ NOTHING TO SWITCH ANY MORE. This used to point the scope pill
          // back at the channel so the new row was where the operator was
          // looking; with both sections on screen at once the copy simply
          // appears in Shared above, which is the outcome that argument wanted.
          onCopied={() => setCopying(null)}
        />
      )}
    </div>
  );
}

/** Scope B and C ask the same question of two workspaces. */
function isMine(template: AgentTemplate, currentUserId: string): boolean {
  return template.createdBy === currentUserId;
}

/**
 * 🔒 PERSONAL READS ONE SHELF, NOT ONE WORKSPACE (Samuel's ruling 2026-08-27,
 * `20260901120000_agent_template_home_scoped.sql`) — the sibling of the
 * Knowledge face's `HOME_SHELF`, and the same trap: `?shelf=home` is a server
 * `WHERE`, there is no client-side filter to fall back on, and a forgotten
 * argument WIDENS silently. It is a module constant threaded through the read
 * and (via `useAgentTemplateWrites`) the cache key, so it cannot be spelled two
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
  template: AgentTemplate | null;
}

/**
 * ONE CAPTION LINE, and it is a RULING rather than an explainer (minimal UI
 * copy; plan §4.4).
 *
 * ⚠ IT NAMES A CONTROL, AND THAT CONTROL EXISTS — "Use in this channel" on
 * every Personal card (`agent-copy.tsx`). ⚠ **THE JUSTIFICATION UNDER IT MOVED
 * ON 2026-09-02 (A12) AND THE CAPTION DID NOT.** It used to read: a home-shelf
 * template CANNOT launch into a container, because the read was workspace-
 * filtered and the id 404'd. Ids resolve their own container now
 * (`src/shared/tenancy/resolve-resource.ts`), so such a template DOES launch.
 * The caption still holds because it promises a SHARED COPY — a row the peer
 * can see and launch themselves — which launching still does not produce.
 */
const PERSONAL_CAPTION =
  "Yours alone. Use one here to make a shared copy in this channel.";

/** No home workspace yet — a different sentence from "none here". */
const SCOPE_UNAVAILABLE = "Finish setting up your workspace to keep agents there.";

