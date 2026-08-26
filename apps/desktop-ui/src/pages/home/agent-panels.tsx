import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
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
 * (`agent-panels.test.tsx › what this pane deliberately leaves out`).
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
  currentUserId,
}: {
  /** `null` when the selected row is a legacy unbound LINK, or when there is
   *  no row at all — both are "no container to read templates from". */
  channel: HomeChannel | null;
  /** ⚠ `POST /api/boot`'s `workspace`, which is NULL until the caller is
   *  onboarded. Scope C is UNAVAILABLE, not empty, when it is.
   *  ⚠ The same payload's `segment` and `role` ride this page's boot query too
   *  and are what the per-scope EDITOR mount will address (plan M3); they are
   *  not props yet because nothing on this face writes. */
  homeWorkspaceId: string | null;
  currentUserId: string;
}) {
  const [scope, setScope] = useState<PrivateScope>("channel");

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

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SharedAgentSection
        section={SECTIONS_CONTAINER[0]}
        templates={shared}
        markerFor={markerFor}
      />

      <PrivateAgentSection
        section={
          scope === "channel" ? SECTIONS_CONTAINER[1] : SECTION_PRIVATE_EVERYWHERE
        }
        templates={scope === "channel" ? privateHere : privateEverywhere}
        caption={CAPTIONS[scope]}
        unavailable={scopeUnavailable ? SCOPE_UNAVAILABLE : null}
        pending={scopePending}
        action={
          // ⚠ §8 rule 8 — `pendingRow` on the CONTROL, not on a row: it is what
          // stops a second click landing on a scope whose list has not arrived,
          // and it dims the pill to say so.
          <div {...pendingRow(scopePending)}>
            <SelectMenu<PrivateScope>
              value={scope}
              options={SCOPE_OPTIONS}
              onChange={setScope}
              ariaLabel="Which private agents"
            />
          </div>
        }
      />
    </div>
  );
}

/** Scope B and C ask the same question of two workspaces. */
function isMine(template: AgentTemplate, currentUserId: string): boolean {
  return template.createdBy === currentUserId;
}

/** Which shelf the private section is showing. */
type PrivateScope = "channel" | "all";

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
 * ⚠ THE SECOND ONE NAMES THE M4 CONTROL ("Use in this channel", plan §3) — it
 * is the plan's own wording and it ships with the pane, so **M4 is what makes
 * it true**. A scope-C template CANNOT launch into a container: `getTemplateById`
 * is workspace-filtered and resolve passes the LAUNCH workspace, so the id 404s
 * (plan §0.3). Copying is the answer, and this line is what says so.
 */
const CAPTIONS: Record<PrivateScope, string> = {
  channel: "Yours alone until you share it.",
  all: "Yours alone. Use one here to make a copy in this channel.",
};

/** Scope C has nowhere to look — a different sentence from "none here". */
const SCOPE_UNAVAILABLE = "Finish setting up your workspace to keep agents there.";
