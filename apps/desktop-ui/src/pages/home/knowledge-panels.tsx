import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { SectionBox } from "@/shared/ui/section-box";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { pendingRow } from "@/shared/ui/pending";
import { EMPTY_GRANTS, fetchBaseList } from "@/features/knowledge/client/api";
import { knowledgeBasesQueryKey } from "@/features/knowledge/client/hooks";
import { CreateBaseDialog } from "@/features/knowledge/components/create-base-dialog";
import type { KnowledgeBase } from "@/features/knowledge/types";
import type { HomeChannel } from "@/features/home/types";
import type { Role } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";
import { HomeKnowledgeBaseView } from "./knowledge-base-view";
import {
  BaseCell,
  EmptyLine,
  channelBasesQueryKey,
  useStarToggle,
} from "./knowledge-panel-cards";
import home from "./home.module.css";

/**
 * /home → Knowledge. THE THREE KB SCOPES OF ONE CHANNEL (Samuel's rulings,
 * 2026-08-26; `docs/specs/home-knowledge-panels.plan.md` §5.2):
 *
 *   A  SHARED    — bases in this channel's link CONTAINER carrying a
 *                  `(kb, channel)` grant. `visible` renders plain; `agent_only`
 *                  renders BADGED, because otherwise the operator cannot tell
 *                  what the peer sees from what only the agent reaches.
 *   B  PRIVATE, in this channel — container bases that are `private` + the
 *                  caller's own + carry NO grant.
 *   C  PRIVATE, across all channels — the same question asked of the caller's
 *                  HOME workspace, which is `POST /api/boot`'s `workspace` and
 *                  costs no extra request (plan §0.1).
 *
 * B and C are one section with a scope dropdown, because they are the same
 * shelf seen at two ranges; A is its own section because it is a different
 * QUESTION (who else can read this).
 *
 * ⚠ THE CHANNEL-SCOPED LIST IS ITS OWN CACHE ENTRY, and it has to be.
 * `GET /api/knowledge/bases?channelId=` folds in a sixth sibling key
 * (`channelGrants`, INVARIANTS §9) that the UNSCOPED read does not send, and
 * `HomeKnowledgeBaseView`'s controller mounts the unscoped read against the
 * same workspace. On one key the two fetchers would take turns and a refetch
 * driven by the detail view would blank the Shared section. The key is the
 * plain one plus a third element, so the `["knowledge", "bases:<ws>"]` PREFIX
 * that every knowledge writer invalidates still reaches both (§8).
 *
 * ⚠ ONE LAYOUT FOR ALL THREE TABS (`index.tsx`): this renders INSIDE the record
 * pane. It never moves the conversation column and it never goes full-width.
 */
export function HomeKnowledgePanels({
  channel,
  homeWorkspaceId,
  homeWorkspaceSegment,
  homeRole,
  currentUserId,
}: {
  /** `null` when the selected row is a legacy unbound LINK, or when there is
   *  no row at all — both are "no container to read knowledge from". */
  channel: HomeChannel | null;
  /** ⚠ `POST /api/boot`'s `workspace`, which is NULL until the caller is
   *  onboarded (plan §0.1). Scope C is unavailable, not empty, when it is. */
  homeWorkspaceId: string | null;
  /** Same payload's `segment` — what the home-workspace mount and the home
   *  create dialog address by. Null with `homeWorkspaceId`. */
  homeWorkspaceSegment: string | null;
  /** Same payload's `role` — the caller's membership role in the HOME
   *  workspace. Null with the other two. */
  homeRole: Role | null;
  currentUserId: string;
}) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<PrivateScope>("channel");
  const [openBase, setOpenBase] = useState<OpenBase | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const containerList = useQuery({
    queryKey: channelBasesQueryKey(channel?.workspaceId, channel?.channelId),
    queryFn: () =>
      fetchBaseList(channel?.workspaceId, channel?.channelId),
    enabled: channel !== null,
  });

  // Scope C is fetched only once it is ASKED FOR — a reader who never opens the
  // dropdown must not pay for a second workspace's base list. The pill wears
  // `pendingRow` for exactly that first fetch (§8 rule 8).
  const homeList = useQuery({
    queryKey: knowledgeBasesQueryKey(homeWorkspaceId ?? undefined),
    queryFn: () => fetchBaseList(homeWorkspaceId ?? undefined),
    enabled: scope === "all" && homeWorkspaceId !== null,
  });

  // ⚠ §8 STALE-CACHE, SPELLED INLINE. A base-list payload cached by a bundle
  // that predates M0 carries NO `channelGrants` key at all — `EMPTY_GRANTS` is
  // the shared frozen fallback, and it reads correctly as "no grants here"
  // rather than crashing the pane. Same reason `bases` gets `EMPTY_BASES`.
  const grants = containerList.data?.channelGrants ?? EMPTY_GRANTS;
  const containerBases = containerList.data?.bases ?? EMPTY_BASES;
  const homeBases = homeList.data?.bases ?? EMPTY_BASES;

  const shared = useMemo(
    () => containerBases.filter((base) => grants[base.id] !== undefined),
    [containerBases, grants]
  );
  const privateHere = useMemo(
    () =>
      containerBases.filter(
        (base) => isOwnPrivate(base, currentUserId) && grants[base.id] === undefined
      ),
    [containerBases, currentUserId, grants]
  );
  const privateEverywhere = useMemo(
    () => homeBases.filter((base) => isOwnPrivate(base, currentUserId)),
    [homeBases, currentUserId]
  );

  const containerStar = useStarToggle(
    channelBasesQueryKey(channel?.workspaceId, channel?.channelId),
    channel?.workspaceId
  );
  const homeStar = useStarToggle(
    knowledgeBasesQueryKey(homeWorkspaceId ?? undefined),
    homeWorkspaceId ?? undefined
  );

  const goToBase = useCallback(
    (next: KnowledgeBase | null, where: PrivateScope) =>
      setOpenBase(next ? { base: next, where } : null),
    []
  );

  if (channel === null) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No channel selected"
        description="Knowledge is per channel — pick one on the left."
      />
    );
  }

  // Where a base opened from THIS scope lives, and who the caller is there.
  // ⚠ The container mount takes `role="owner"`: a home container is the
  // caller's own (plan §5.3), and the settings modal is the only thing role
  // gates. The home mount takes boot's real membership role.
  const containerTarget: MountTarget = {
    workspaceId: channel.workspaceId,
    segment: channel.workspaceSegment,
    role: "owner",
  };
  const homeTarget: MountTarget | null =
    homeWorkspaceId && homeWorkspaceSegment && homeRole
      ? { workspaceId: homeWorkspaceId, segment: homeWorkspaceSegment, role: homeRole }
      : null;
  const createTarget = scope === "channel" ? containerTarget : homeTarget;

  if (openBase) {
    const target = openBase.where === "channel" ? containerTarget : homeTarget;
    const list = openBase.where === "channel" ? containerList.data : homeList.data;
    if (target && list) {
      return (
        <HomeKnowledgeBaseView
          key={openBase.base.id}
          base={openBase.base}
          workspaceId={target.workspaceId}
          workspaceSegment={target.segment}
          currentUserId={currentUserId}
          role={target.role}
          list={list}
          onGoToBase={(next) => goToBase(next, openBase.where)}
        />
      );
    }
  }

  if (containerList.error) {
    return (
      <PageError
        error={containerList.error}
        onRetry={() => void containerList.refetch()}
      />
    );
  }

  // ⚠ NEITHER SECTION MAY STATE AN EMPTINESS IT HAS NOT MEASURED. Rendered
  // against an unresolved read, all three empty sentences below are assertions
  // about a list nobody has seen — the same false-sentence trap
  // `person-members.tsx` turns `emptyLine` off for. The pane waits for the
  // container read; the private section waits separately for the home one,
  // because only that half of it moved.
  if (containerList.data === undefined) {
    return <PageLoading label="Loading knowledge" />;
  }

  const scopePending =
    scope === "all" && homeWorkspaceId !== null && homeList.data === undefined;
  const privateBases = scope === "channel" ? privateHere : privateEverywhere;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SectionBox label="Shared in this channel">
        {shared.length === 0 ? (
          <EmptyLine>Nothing is shared into this channel yet.</EmptyLine>
        ) : (
          <div className={cn(home.kbCards, "p-3")}>
            {shared.map((base) => (
              <BaseCell
                key={base.id}
                base={base}
                list={containerList.data}
                badge={grants[base.id]?.level === "agent_only" ? AGENT_ONLY : null}
                currentUserId={currentUserId}
                onOpen={(next) => goToBase(next, "channel")}
                onToggleStar={containerStar}
              />
            ))}
          </div>
        )}
      </SectionBox>

      <SectionBox
        label="Private"
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-light flex h-6 items-center gap-1 rounded-full px-2.5 text-caption font-medium disabled:opacity-60"
              disabled={createTarget === null}
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={12} aria-hidden="true" />
              New knowledge base
            </button>
            {/* ⚠ §8 rule 8 — `pendingRow` on the CONTROL, not on a row: it is
                what stops a second click landing on a scope whose list has not
                arrived, and it dims the pill to say so. */}
            <div {...pendingRow(scopePending)}>
              <SelectMenu<PrivateScope>
                value={scope}
                options={SCOPE_OPTIONS}
                onChange={setScope}
                ariaLabel="Which private knowledge bases"
              />
            </div>
          </div>
        }
      >
        {/* ⚠ ONE CAPTION LINE, and it is the RULING, not an explainer (minimal
            UI copy): a scope-B base is invisible to the operator's OWN agent in
            this channel until it is granted (plan RULING 2), and a scope-C base
            cannot be granted into a channel at all (RULING 1). */}
        <p className="px-4 pt-2.5 text-caption text-text-muted">
          {scope === "channel"
            ? "Yours alone until you share it — your agent here can't read these either."
            : "Yours alone. To share knowledge in a channel, create it there."}
        </p>
        {scope === "all" && homeWorkspaceId === null ? (
          <EmptyLine>Finish setting up your workspace to keep bases here.</EmptyLine>
        ) : scopePending ? (
          // Body stays bare while the other workspace's list is in flight — the
          // dimmed pill above already says the scope has not landed.
          <div className="h-10" />
        ) : privateBases.length === 0 ? (
          <EmptyLine>
            {scope === "channel"
              ? "You haven't created a private base in this channel."
              : "You have no private bases in your workspace."}
          </EmptyLine>
        ) : (
          <div className={cn(home.kbCards, "p-3")}>
            {privateBases.map((base) => (
              <BaseCell
                key={base.id}
                base={base}
                list={scope === "channel" ? containerList.data : homeList.data}
                badge={null}
                currentUserId={currentUserId}
                onOpen={(next) => goToBase(next, scope)}
                onToggleStar={scope === "channel" ? containerStar : homeStar}
              />
            ))}
          </div>
        )}
      </SectionBox>

      {/* ⚠ RULING 6 — THE CREATE AFFORDANCE FOLLOWS THE DROPDOWN. "in this
          channel" creates in the container, "across all channels" in the home
          workspace. It sits beside the pill it obeys, so the two cannot be read
          apart. */}
      {createTarget && (
        <CreateBaseDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          workspaceId={createTarget.workspaceId}
          workspaceSlug={createTarget.segment}
          currentUserId={currentUserId}
          role={createTarget.role}
          routing={{
            // ⚠ THE PREFIX. `create-base-dialog.tsx` seeds the PLAIN key
            // (`seedKnowledgeBase`) and this pane reads the channel-scoped one,
            // so without the two-element prefix a base created here would not
            // appear until the next cold read (§8: a key off by one element is
            // a silent no-op).
            refreshServerData: () => {
              void queryClient.invalidateQueries({
                queryKey: knowledgeBasesQueryKey(createTarget.workspaceId),
              });
            },
            goToBase: (next) => {
              if (next) goToBase(next, scope);
            },
          }}
        />
      )}
    </div>
  );
}

/** Scope B and C ask the same question of two workspaces. */
function isOwnPrivate(base: KnowledgeBase, currentUserId: string): boolean {
  return base.visibility === "private" && base.createdBy === currentUserId;
}

/** Which shelf the private section is showing. */
type PrivateScope = "channel" | "all";

interface OpenBase {
  base: KnowledgeBase;
  /** Which workspace it was opened FROM — decides the mount's workspace id. */
  where: PrivateScope;
}

interface MountTarget {
  workspaceId: string;
  segment: string;
  role: Role;
}

const SCOPE_OPTIONS: ReadonlyArray<SelectMenuOption<PrivateScope>> = [
  {
    value: "channel",
    label: "in this channel",
    description: "Private bases you created inside this channel.",
  },
  {
    value: "all",
    label: "across all channels",
    description: "Private bases in your own workspace.",
  },
];

/** The caption an `agent_only` grant wears. */
const AGENT_ONLY = "Agent only";

/** Shared frozen empty list — a degraded or not-yet-arrived response falls back
 *  to THIS, so the `useMemo` filters below are not re-run on a fresh `[]`. */
const EMPTY_BASES: readonly KnowledgeBase[] = Object.freeze([]);
