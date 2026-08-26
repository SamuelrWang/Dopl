import { useMemo, useState } from "react";
import { Bot, Plus } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { pendingRow } from "@/shared/ui/pending";
import { useAgentTemplates } from "@/features/agent-templates/hooks/use-agent-templates";
import {
  SECTIONS_CONTAINER,
  SECTION_PRIVATE_EVERYWHERE,
  groupByVisibility,
} from "@/features/agent-templates/lib/visibility";
import type { AgentTemplate } from "@/features/agent-templates/client/types";
import type { HomeChannel } from "@/features/home/types";
import { PageError, PageLoading } from "#/components/page-states";
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
 * a lane that is already wired end to end: the Chat face's `TemplateLaunchPicker`
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
  const [scope, setScope] = useState<PrivateScope>("channel");
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  /** The scope-C row waiting on its confirm step (plan §3, M4). */
  const [copying, setCopying] = useState<AgentTemplate | null>(null);

  const containerList = useAgentTemplates(channel?.workspaceId ?? null);
  // Scope C is fetched only once it is ASKED FOR — a reader who never opens the
  // dropdown must not pay for a second workspace's template list. The pill
  // wears `pendingRow` for exactly that first fetch (INVARIANTS §8 rule 8).
  const homeList = useAgentTemplates(homeWorkspaceId, {
    enabled: scope === "all",
  });

  const containerGroups = useMemo(
    () => groupByVisibility(containerList.templates),
    [containerList.templates]
  );
  const homeGroups = useMemo(
    () => groupByVisibility(homeList.templates),
    [homeList.templates]
  );

  // ⚠ `groupByVisibility` DROPS a `team` row rather than filing it under one of
  // these two. In a container `team` is a DEAD value — there are no teams to
  // link (§4A) — and a surface that swept it into "Private" or "Shared in this
  // channel" would be inventing a sharing fact nobody stored (§11).
  const shared = containerGroups.workspace;
  const privateHere = useMemo(
    () => containerGroups.private.filter((t) => isMine(t, currentUserId)),
    [containerGroups.private, currentUserId]
  );
  const privateEverywhere = useMemo(
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
    return <PageLoading label="Loading agents" />;
  }

  const scopeUnavailable = scope === "all" && homeWorkspaceId === null;
  const scopePending =
    scope === "all" && homeWorkspaceId !== null && !homeList.resolved;

  // ⚠ WHICH WORKSPACE A NEW AGENT WOULD LAND IN — `null` = nowhere, which is
  // the "not onboarded yet" case and disables the button rather than writing
  // into the container the pill is not pointing at.
  const createTarget: EditorTarget | null =
    scope === "channel"
      ? { where: "container", template: null }
      : homeWorkspaceId !== null && homeWorkspaceSegment !== null
        ? { where: "home", template: null }
        : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SharedAgentSection
        section={SECTIONS_CONTAINER[0]}
        templates={shared}
        markerFor={markerFor}
        onOpen={(template) => setEditing({ where: "container", template })}
      />

      <PrivateAgentSection
        section={
          scope === "channel" ? SECTIONS_CONTAINER[1] : SECTION_PRIVATE_EVERYWHERE
        }
        templates={scope === "channel" ? privateHere : privateEverywhere}
        caption={CAPTIONS[scope]}
        unavailable={scopeUnavailable ? SCOPE_UNAVAILABLE : null}
        pending={scopePending}
        // ⚠ EDITED WHERE IT LIVES. A scope-C row is a HOME-workspace row, so its
        // editor addresses the home workspace — the same id its PATCH and its
        // cache entry take (F-331). Reading one list and writing another is
        // exactly the cross-workspace bug the entry key exists to prevent.
        onOpen={(template) =>
          setEditing({
            where: scope === "channel" ? "container" : "home",
            template,
          })
        }
        // ⚠ SCOPE C ONLY. A scope-B row is already in this container; "use it
        // here" would be a copy of a thing into the place it already is.
        cardActionFor={
          scope === "all"
            ? (template) => (
                <UseInThisChannelButton
                  disabled={copying !== null}
                  onClick={() => setCopying(template)}
                />
              )
            : undefined
        }
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-light flex h-6 items-center gap-1 rounded-full px-2.5 text-caption font-medium disabled:opacity-60"
              disabled={createTarget === null}
              onClick={() => setEditing(createTarget)}
            >
              <Plus size={12} aria-hidden="true" />
              New agent
            </button>
            {/* ⚠ §8 rule 8 — `pendingRow` on the CONTROL, not on a row: it is
                what stops a second click landing on a scope whose list has not
                arrived, and it dims the pill to say so. */}
            <div {...pendingRow(scopePending)}>
              <SelectMenu<PrivateScope>
                value={scope}
                options={SCOPE_OPTIONS}
                onChange={setScope}
                ariaLabel="Which private agents"
              />
            </div>
          </div>
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
          // ⚠ THE PILL FOLLOWS THE COPY HOME. The new row is a CONTAINER row and
          // the operator is looking at the home shelf, so leaving the scope
          // where it was would make a successful write look like nothing
          // happened — and the next thing they want is the row they just made.
          onCopied={() => {
            setCopying(null);
            setScope("channel");
          }}
        />
      )}
    </div>
  );
}

/** Scope B and C ask the same question of two workspaces. */
function isMine(template: AgentTemplate, currentUserId: string): boolean {
  return template.createdBy === currentUserId;
}

/** Which shelf the private section is showing. */
type PrivateScope = "channel" | "all";

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

const SCOPE_OPTIONS: ReadonlyArray<SelectMenuOption<PrivateScope>> = [
  {
    value: "channel",
    label: "in this channel",
    description: "Private agents you created inside this channel.",
  },
  {
    value: "all",
    label: "across all channels",
    description: "Private agents in your own workspace.",
  },
];

/**
 * ONE CAPTION LINE PER SCOPE, and each is a RULING rather than an explainer
 * (minimal UI copy; plan §4.4).
 *
 * ⚠ THE SECOND ONE NAMES A CONTROL, AND SINCE M4 THAT CONTROL EXISTS — "Use in
 * this channel" on every scope-C card (`agent-copy.tsx`). A scope-C template
 * CANNOT launch into a container: `getTemplateById` is workspace-filtered and
 * resolve passes the LAUNCH workspace, so the id 404s (plan §0.3). Copying is
 * the answer, and this line is what says so.
 */
const CAPTIONS: Record<PrivateScope, string> = {
  channel: "Yours alone until you share it.",
  all: "Yours alone. Use one here to make a copy in this channel.",
};

/** Scope C has nowhere to look — a different sentence from "none here". */
const SCOPE_UNAVAILABLE = "Finish setting up your workspace to keep agents there.";
