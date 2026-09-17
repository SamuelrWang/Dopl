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
import { EMPTY_ROLE, type HomeChannel } from "@/features/home/types";
import { meetsMinRole } from "@/features/workspaces/types";
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
import { ShareIntoChannelButton, ShareIntoChannelDialog } from "./agent-share";
import { CreateButton } from "./panel-buttons";
import { HomeAgentPanelsSkeleton } from "./home-skeleton";

/**
 * /home → Agents. THE THREE TEMPLATE SCOPES OF ONE CHANNEL (Samuel, 2026-08-26;
 * `docs/specs/home-agents-tab.plan.md` §1):
 *
 *   A  SHARED, in this channel — this channel's link CONTAINER, `visibility ===
 *                  "workspace"`. Inside a container that value means THE OTHER
 *                  PERSON, so the heading is **"Shared in this channel", never
 *                  "Public"** — and it lives in `agent-templates/lib/
 *                  visibility.ts › SECTIONS_CONTAINER`, never hand-typed here.
 *   B  PRIVATE, in this channel — container templates, `private`, the caller's.
 *   C  PRIVATE, across all channels — the same question of the caller's HOME
 *                  workspace (`POST /api/boot`'s `workspace`).
 *
 * B and C share one section with a scope dropdown (one shelf at two ranges); A
 * is its own because it answers a different QUESTION — who else may wear this
 * identity.
 *
 * ⚠ "AGENTS" NAMES TWO THINGS AND BOTH NAMES STAY (Samuel's ruling Q6,
 * 2026-08-26): THIS face lists template IDENTITIES, the channel info column's
 * **Agents** tab (`channels/components/agents-tab.tsx`) lists RUNNING SESSIONS. The
 * collision is RECORDED (INVARIANTS §5A), not resolved; a rename needs his word.
 *
 * ⚠ NO LAUNCH CONTROL, DELIBERATELY (§4.6, §5A) — the Channels face's
 * `TemplateLaunchPicker` reads THIS SAME list and launches from it, and a second
 * launch surface fights `resolve`'s singularity. The absence is tested
 * (`agent-panels.test.tsx`). CREATE and EDIT are the authoring half and stay.
 *
 * ⚠ THE CREATE AFFORDANCE FOLLOWS THE SCOPE PILL (Knowledge-wave ruling 6): "in
 * this channel" writes into the CONTAINER, "across all channels" into the home
 * workspace. It sits beside the pill it obeys, and that pill also decides which
 * workspace's teams and bases the editor may ask for (`agent-editor.tsx`).
 *
 * ⚠ TWO READS, ONE PATH, TWO WORKSPACES — F-331's shape. `GET
 * /api/agent-templates` is cached under `[path, workspaceId, undefined]` twice,
 * so writes patch the ENTRY key, never the path PREFIX (INVARIANTS §8). No
 * channel-scoped key is needed: the workspace element distinguishes them.
 *
 * ⚠ ONE LAYOUT FOR ALL THREE TABS (`index.tsx`): this renders INSIDE the record
 * pane, never moving the conversation column and never going full-width.
 *
 * 🔒 **BOTH SECTION BUTTONS READ "+ Agent template" (Samuel, 2026-09-09), on the
 * page's black `h-9` pill** (`panel-buttons.tsx › CreateButton`) — the SECTION
 * names the destination, so the button says only what it makes. **The two
 * accessible names are identical on purpose**: reach them through their section
 * (`getByRole("region", { name: … })`), never by button name alone.
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
   *  ⚠ Boot's `role` is STILL deliberately not taken, and the reason narrowed
   *  2026-09-17 (F-343): the PERSONAL section is the caller's own home shelf,
   *  where a role prop would be a second, weaker copy of the server's floor. The
   *  SHARED section is a different container and a different reader — its gate
   *  rides on `channel.role`, which is the row the server itself reads. */
  homeWorkspaceSegment: string | null;
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  /** The PERSONAL row waiting on its confirm step. ⚠ **A GRANT SINCE
   *  2026-09-02 (slice B15), where it was a COPY** — see `agent-share.tsx`. */
  const [sharing, setSharing] = useState<AgentTemplate | null>(null);

  // ⚠ A CONTAINER READ IS UNFILTERED. A shelf is a TENANCY and this container is
  // not the caller's personal one, so `?shelf=` here would be a question with one
  // possible answer.
  // ⚠ §8 STALE-CACHE, SPELLED INLINE: a payload cached by the previous bundle
  // carries no `role` key, and `EMPTY_ROLE` (rank 0) hides the create for one
  // paint rather than offering a write the server would refuse.
  const canCreateShared = meetsMinRole(channel?.role ?? EMPTY_ROLE, "member");
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

  // 🔒 **NO CHANNEL REPLACES SECTION A, NOT THE WHOLE FACE (2026-09-10, the
  // new-user flow).** This used to return the empty state INSTEAD of the pane, so
  // a brand-new account — no channels yet, which is every account on its first
  // day — opened Agents and was told to "pick one on the left" beside an empty
  // list, with its own Personal templates (a HOME-workspace read that needs no
  // channel at all) nowhere on screen and no way to make one. The sentence is
  // true of section A and only of section A: `channel === null` means there is no
  // CONTAINER to read shared templates from, and says nothing about scope C.
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
  // container read is never ENABLED (`use-agent-templates.ts`: `null` workspace
  // → disabled, `resolved` false forever), so gating on it here would hold the
  // skeleton up permanently — UNAVAILABLE read as PENDING, which is the exact
  // shape of F-339 one scope over.
  if (hasChannel && !containerList.resolved) {
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
      {channel === null ? (
        // ⚠ IN THE SECTION'S PLACE, not the pane's. Same sentence as before, now
        // scoped to the thing it is actually about.
        <EmptyState
          icon={Bot}
          title="No channel selected"
          description="Agents shared in a channel are per channel — pick one on the left."
        />
      ) : (
      <SharedAgentSection
        section={SECTIONS_CONTAINER[0]}
        templates={shared}
        markerFor={markerFor}
        onOpen={(template) => setEditing({ where: "container", template })}
        // ⚠ CREATES DIRECTLY AT `visibility: 'workspace'` — there is no grant
        // table for templates, so "shared into this channel" IS that value, and
        // `ContainerTemplateEditor` now opens on it because
        // `SECTIONS_CONTAINER` offers nothing else (`lib/visibility.ts`).
        // 🔒 **GATED ON THE CALLER'S REAL ROLE (2026-09-17, F-343's consequence
        // 1b).** `POST /api/agent-templates` is `minRole: "member"`, so a GUEST
        // peer's click was a 403 the editor surfaced — a dead control (INVARIANTS
        // §5) shown because the pane could not tell a member from a guest. It can
        // now, and it asks the SAME ladder the server asks rather than restating
        // the floor. ⚠ **THE SERVER FENCE IS UNCHANGED AND IS STILL THE FENCE.**
        // ⚠ HIDDEN, NOT DISABLED — one fix, the same shape as the Knowledge face's
        // (`knowledge-panels.tsx`), because it is the same finding.
        action={
          canCreateShared ? (
            <CreateButton onClick={() => setEditing({ where: "container", template: null })}>
              Agent template
            </CreateButton>
          ) : null
        }
      />
      )}

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
        // ⚠ AND NOT WITH NO CHANNEL TO SHARE INTO. The dialog takes
        // `channel.channelId`; offering the button with nothing selected would be
        // an affordance whose only outcome is a crash.
        cardActionFor={
          channel === null
            ? undefined
            : (template) => (
                <ShareIntoChannelButton
                  disabled={sharing !== null}
                  onClick={() => setSharing(template)}
                />
              )
        }
        action={
          <CreateButton
            disabled={personalCreateTarget === null}
            onClick={() => setEditing(personalCreateTarget)}
          >
            Agent template
          </CreateButton>
        }
      />

      {/* ⚠ MOUNTED ONLY WHILE OPEN, and the two mounts are DIFFERENT COMPONENTS
          — see `agent-editor.tsx`: a container must not fetch teams, and that is
          a rule you cannot state with a conditional hook. */}
      {editing?.where === "container" && channel !== null && (
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

      {sharing && channel !== null && (
        <ShareIntoChannelDialog
          source={sharing}
          // ⚠ THE CHANNEL, NOT THE CONTAINER. A `channel` scope is what puts the
          // row in front of the people in the room; a `container` grant would
          // name the tenancy and no audience.
          channelId={channel.channelId}
          onClose={() => setSharing(null)}
          onShared={() => setSharing(null)}
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
 * ⚠ IT NAMES A CONTROL, AND THAT CONTROL EXISTS — "Share into this channel" on
 * every Personal card (`agent-share.tsx`).
 * ⚠ **IT SAID "make a shared COPY" UNTIL 2026-09-02, AND HAD BEEN STALE TWICE
 * OVER (F-471).** First the JUSTIFICATION under it moved (A12: a personal
 * template could not launch into a container, then it could) and the caption did
 * not; then B11 replaced the copy with a GRANT, which is what the word "copy"
 * was naming. **The caption and the control move together or neither is true** —
 * the sentence promises the peer can USE it, which launching your own agent in
 * the room still does not give them.
 */
const PERSONAL_CAPTION =
  "Yours alone. Share one into this channel to let everyone here use it.";

/** No home workspace yet — a different sentence from "none here". */
const SCOPE_UNAVAILABLE = "Finish setting up your home space to keep agents there.";

