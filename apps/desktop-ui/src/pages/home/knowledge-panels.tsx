import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { SectionPanel } from "@/shared/ui/section-panel";
import { EMPTY_GRANTS, fetchBaseList } from "@/features/knowledge/client/api";
import {
  invalidateKnowledgeBaseLists,
  knowledgeBasesQueryKey,
} from "@/features/knowledge/client/hooks";
import { CreateBaseDialog } from "@/features/knowledge/components/create-base-dialog";
import type { KnowledgeBase } from "@/features/knowledge/types";
import type { HomeChannel } from "@/features/home/types";
import type { Role } from "@/features/workspaces/types";
import { PageError } from "#/components/page-states";
import { HomeKnowledgeBaseView } from "./knowledge-base-view";
import { HomeKnowledgePanelsSkeleton } from "./home-skeleton";
import { CreateButton } from "./panel-buttons";
import { PersonalArmingControl } from "./personal-arming-control";
import {
  BaseCell,
  EmptyLine,
  channelBasesQueryKey,
  useStarToggle,
} from "./knowledge-panel-cards";
import home from "./home.module.css";

/**
 * /home → Knowledge. TWO SECTIONS, NO SCOPE PILL (Samuel's ruling 2026-08-27,
 * superseding the three-scope shape of `docs/specs/home-knowledge-panels.plan.md`
 * §5.2):
 *
 *   SHARED IN THIS CHANNEL — bases in this channel's link CONTAINER carrying a
 *       `(kb, channel)` grant. `visible` renders plain; `agent_only` renders
 *       BADGED, because otherwise the operator cannot tell what the PEER sees
 *       from what only the AGENT reaches. Its create button makes both at once:
 *       a base in the container plus a `visible` grant on this channel.
 *   PERSONAL — the caller's own HOME SHELF, always. Bases created FROM THIS
 *       PANE, living in `POST /api/boot`'s `workspace` and carrying
 *       `home_scoped` (`20260831120000_knowledge_base_home_scoped.sql`).
 *
 * ⚠ THE PER-CHANNEL PRIVATE SCOPE IS GONE, AND WITH IT THE PILL. It used to be
 * the middle of three: container bases that were `private` + own + ungranted.
 * **The consequence is deliberate and is now a rule: a container base reaches
 * /home ONLY through a channel grant** (INVARIANTS §5A). An ungranted private
 * base sitting in a container workspace is unreachable from this surface — no
 * live rows are stranded (measured 2026-08-26: the operator's containers hold
 * zero bases), and the remedy for one that appears later is the sharing section
 * on the base itself, not a scope that made a private container shelf look like
 * a place to keep things.
 *
 * ⚠ "PERSONAL", NOT "PRIVATE" — UI COPY ONLY. `visibility: 'private'` is
 * unchanged and unrenamed everywhere it is stored, read or fenced; this is the
 * label above a section, and the two words must not be conflated in a predicate.
 *
 * ⚠ THE CHANNEL-SCOPED LIST IS ITS OWN CACHE ENTRY, and it has to be.
 * `GET /api/knowledge/bases?channelId=` folds in a sibling key (`channelGrants`,
 * INVARIANTS §9) that the plain read does not send, and
 * `HomeKnowledgeBaseView`'s controller mounts a list read of its own against the
 * same workspace. On one key the two fetchers would take turns and a refetch
 * driven by the detail view would blank the Shared section.
 * ⚠ THAT DETAIL MOUNT IS SHELF-KEYED TOO — it is handed the same `shelf` its
 * `list` prop came from, or the Personal grid behind the detail pane refills
 * with the workspace shelf. Three cache axes, one minter
 * (`knowledgeBasesQueryKey`), and a key off by one element is a SILENT no-op
 * (§8) — which is exactly how the grant write once reached nothing this pane
 * had mounted.
 *
 * ⚠ ONE LAYOUT FOR ALL THREE TABS (`index.tsx`): this renders INSIDE the record
 * pane. It never moves the conversation column and it never goes full-width.
 *
 * ⚠ **THE SECTIONS ARE FLAT (Samuel, 2026-08-27, over a screenshot of this
 * face).** They were the shared `SectionBox` — a `bg-card-surface-subtle`
 * header STRIP over a `bg-bg-inset` body carrying the concave inset shadow —
 * which read as a rectangle pressed INTO the record pane. They are
 * `shared/ui/section-panel.tsx › SectionPanel` now: no border line, no inset
 * shadow, the heading and the cards sitting DIRECTLY on one ground. **The cards
 * are unchanged and still raised** — raised-on-flat-gray is the point.
 * ⚠ **THE GROUND IS NOT STATED IN THIS FILE.** It comes from ONE rule that
 * grounds BOTH /home faces — `home.module.css › .frame
 * :global([data-section-panel])`, the page's own `--home-panel` gray, the fill
 * the relationship list stands on. The Agents tab reached the same rectangle
 * from the other side (a flat `bg-card-surface-subtle` card), and two faces
 * that merely look settled today drift the moment one is re-tuned; stating the
 * ground once means a change to it cannot land on one tab only. The drag-resize
 * grip went with `SectionBox` — it was furniture of the concave box, and the
 * Agents face never had one.
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
   *  onboarded (plan §0.1). Personal is unavailable, not empty, when it is. */
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
  const [openBase, setOpenBase] = useState<OpenBase | null>(null);
  /** Which create button is open, or `null`. ⚠ ONE dialog, two targets: the
   *  two creates differ only in where they land, and two mounted dialogs would
   *  be two copies of the same form drifting apart. */
  const [createOpen, setCreateOpen] = useState<PaneScope | null>(null);

  const containerList = useQuery({
    queryKey: channelBasesQueryKey(channel?.workspaceId, channel?.channelId),
    queryFn: () => fetchBaseList(channel?.workspaceId, channel?.channelId),
    enabled: channel !== null,
  });

  // ⚠ NO LONGER LAZY (2026-08-27). It was gated on the scope pill so a reader
  // who never opened the dropdown paid for one workspace, not two; with the
  // pill gone, Personal is ALWAYS on screen and a deferred read would just be a
  // guaranteed second round trip after first paint.
  const homeList = useQuery({
    queryKey: knowledgeBasesQueryKey(homeWorkspaceId ?? undefined, undefined, HOME_SHELF),
    queryFn: () => fetchBaseList(homeWorkspaceId ?? undefined, undefined, HOME_SHELF),
    enabled: homeWorkspaceId !== null,
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
  // ⚠ THE `createdBy` HALF IS NOT REDUNDANT WITH THE SERVER'S `?shelf=home`.
  // The shelf says WHICH SHELF; `canSeeBase` already drops other people's
  // private rows, but the home workspace can hold a member's PUBLIC base too,
  // and Personal is the caller's own things. Two questions, both asked.
  const personal = useMemo(
    () => homeBases.filter((base) => isOwnPrivate(base, currentUserId)),
    [homeBases, currentUserId]
  );

  const containerStar = useStarToggle(
    channelBasesQueryKey(channel?.workspaceId, channel?.channelId),
    channel?.workspaceId
  );
  const homeStar = useStarToggle(
    knowledgeBasesQueryKey(homeWorkspaceId ?? undefined, undefined, HOME_SHELF),
    homeWorkspaceId ?? undefined
  );

  const goToBase = useCallback(
    (next: KnowledgeBase | null, where: PaneScope) =>
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

  // Where a base opened from THIS section lives, and who the caller is there.
  // ⚠ The container mount takes `role="owner"`: a home container is the
  // caller's own (plan §5.3), and the settings modal is the only thing role
  // gates. The home mount takes boot's real membership role.
  const containerTarget: MountTarget = {
    workspaceId: channel.workspaceId,
    segment: channel.workspaceSegment,
    role: "owner",
    // ⚠ NO `my-access` READ AGAINST A CONTAINER: it has no teams, so the answer
    // is the plain role default and the request buys nothing. See
    // `knowledge-base-view.tsx`'s docblock for what that costs and why it is
    // acceptable HERE and not on the home mount.
    accessSegment: null,
  };
  const homeTarget: MountTarget | null =
    homeWorkspaceId && homeWorkspaceSegment && homeRole
      ? {
          workspaceId: homeWorkspaceId,
          segment: homeWorkspaceSegment,
          role: homeRole,
          // 🔒 THE HOME WORKSPACE IS A REAL STANDARD WORKSPACE and can be
          // teams-mode, and the mount is handed the WHOLE base list — so
          // without this the grid behind the detail pane shows every edit
          // control on team-visible bases the caller only has `view` on (F-330).
          accessSegment: homeWorkspaceSegment,
        }
      : null;
  const createTarget = createOpen === "channel" ? containerTarget : homeTarget;

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
          accessSegment={target.accessSegment}
          currentUserId={currentUserId}
          role={target.role}
          list={list}
          // ⚠ THE SHELF THE `list` ABOVE CAME FROM. The detail mount seeds a
          // LIVE query with it; a mismatch here re-opens the shelf bug one
          // layer down (see the prop's docblock).
          shelf={openBase.where === "channel" ? undefined : HOME_SHELF}
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
  // against an unresolved read, the empty sentences below are assertions about
  // a list nobody has seen — the same false-sentence trap `person-members.tsx`
  // turns `emptyLine` off for. The pane waits for the container read; Personal
  // waits separately for the home one, because they are two reads.
  if (containerList.data === undefined) {
    // ⚠ THIS FACE'S OWN SHAPE — two flat sections over `home.kbCards` — not the
    // shared page ghost, which painted a 52px bar and a three-up card row
    // inside a pane that has neither.
    return <HomeKnowledgePanelsSkeleton label="Loading knowledge" />;
  }

  const personalPending =
    homeWorkspaceId !== null && homeList.data === undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* ⚠ FLAT, AND THE GROUND IS NOT STATED HERE — see "THE SECTIONS ARE
          FLAT" in this file's docblock. */}
      <SectionPanel
        id="home-kb-shared"
        label="Shared in this channel"
        action={
          // ⚠ CREATES **AND SHARES**, in one server call — a base in this
          // channel's container plus a `visible` grant on this channel, rolled
          // back together if either half fails (`createBase`). A create that
          // landed ungranted would be invisible on this very surface, which is
          // the rule the removed private scope used to hide.
          // 🔒 SERVER-FENCED ONLY, AND KNOWINGLY. `POST /api/knowledge/bases`
          // is `minRole: "member"`, so a GUEST peer standing in this channel is
          // refused with a 403 the dialog surfaces — but this pane cannot tell
          // a member from a guest (`HomeChannel` carries no viewer role, F-343),
          // so the button is shown to both. Do not "fix" that by guessing.
          <CreateButton onClick={() => setCreateOpen("channel")}>
            New shared base
          </CreateButton>
        }
      >
        {shared.length === 0 ? (
          <EmptyLine>Nothing is shared into this channel yet.</EmptyLine>
        ) : (
          // ⚠ NO `p-3` — the panel supplies the padding now. It was here
          // because `SectionBox`'s body was an edge-to-edge inset well.
          <div className={home.kbCards}>
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
      </SectionPanel>

      <SectionPanel
        id="home-kb-personal"
        label="Personal"
        action={
          // ⚠ TWO CONTROLS, ONE ROW — the create, and the switch that decides
          // whether this room's AGENT sessions can reach the shelf the create
          // writes to (task 11, `./personal-arming-control.tsx`). They sit
          // together because the second one explains an empty first one.
          <div className="flex items-center gap-3">
            <PersonalArmingControl
              channelId={channel.channelId}
              workspaceId={channel.workspaceId}
            />
            <CreateButton
              disabled={homeTarget === null}
              onClick={() => setCreateOpen("home")}
            >
              New knowledge base
            </CreateButton>
          </div>
        }
        // ⚠ ONE CAPTION LINE, and it is the RULING, not an explainer (minimal
        // UI copy). It says where this shelf is NOT: sharing happens in the
        // section above, by creating there. ⚠ It is the PANEL'S caption slot
        // now, so it sits under the heading on the same ground and aligns with
        // it — as a loose `<p>` on the old inset body it wore the body's own
        // `px-4` and lined up with nothing.
        caption="Yours alone. To share knowledge in a channel, create it there."
      >
        {homeWorkspaceId === null ? (
          <EmptyLine>Finish setting up your workspace to keep bases here.</EmptyLine>
        ) : personalPending ? (
          // Body stays bare while the home shelf is in flight — an empty
          // sentence here would be a claim about a list nobody has seen.
          <div className="h-10" />
        ) : personal.length === 0 ? (
          <EmptyLine>You haven&apos;t created a private base here yet.</EmptyLine>
        ) : (
          <div className={home.kbCards}>
            {personal.map((base) => (
              <BaseCell
                key={base.id}
                base={base}
                list={homeList.data}
                badge={null}
                currentUserId={currentUserId}
                onOpen={(next) => goToBase(next, "home")}
                onToggleStar={homeStar}
              />
            ))}
          </div>
        )}
      </SectionPanel>

      {createOpen !== null && createTarget && (
        <CreateBaseDialog
          open
          onOpenChange={(next) => {
            if (!next) setCreateOpen(null);
          }}
          workspaceId={createTarget.workspaceId}
          workspaceSlug={createTarget.segment}
          currentUserId={currentUserId}
          role={createTarget.role}
          // ⚠ THE TWO BUTTONS DIFFER IN EXACTLY THESE TWO PROPS, and each one
          // is silent when wrong: a home create that landed unmarked would
          // write into the workspace shelf this pane no longer reads (a base
          // that vanishes the moment it is made), and a shared create without
          // the channel would land ungranted and be equally invisible.
          shelf={createOpen === "home" ? HOME_SHELF : undefined}
          shareToChannelId={createOpen === "channel" ? channel.channelId : undefined}
          // ⚠ BOTH BUTTONS, NOT JUST THE SHARED ONE (Samuel, 2026-08-27). The
          // button that was pressed — Personal or Shared — IS the audience
          // answer here, so the dialog asks no second one. The shared path was
          // already picker-less via `shareToChannelId`; this is the other half.
          audienceFixed
          routing={{
            // ⚠ EVERY VARIANT, AND A PREFIX REACHES ONLY ONE (§8). The dialog
            // seeds ONE key; this invalidates the whole family, which is what
            // makes a shared create appear in the Shared section — its row is
            // only there once the CHANNEL-scoped read has re-run and brought
            // the new grant with it.
            refreshServerData: () => {
              invalidateKnowledgeBaseLists(queryClient, createTarget.workspaceId);
            },
            goToBase: (next) => {
              if (next) goToBase(next, createOpen);
            },
          }}
        />
      )}
    </div>
  );
}

/**
 * 🔒 PERSONAL READS ONE SHELF, NOT ONE WORKSPACE (Samuel's ruling 2026-08-26,
 * `20260831120000_knowledge_base_home_scoped.sql`).
 *
 * ⚠ IT USED TO READ THE WHOLE WORKSPACE, and that WAS the bug — not a leak.
 * Every gate held: the request carried `x-workspace-id: <home workspace>`, the
 * server's `.eq("workspace_id", …)` answered it exactly, and the rows really
 * did belong to the caller's own default standard workspace (measured against
 * production 2026-08-26). What was wrong was the RANGE: a pill labelled "across
 * all channels" delivered the operator's entire workspace KB shelf — bases
 * authored on the workspace Knowledge page months earlier that had never been
 * in any channel. **Do not go looking for a workspace-scoping defect here;
 * there was never one.** The fix was to give the shelf a noun.
 *
 * ⚠ AND IT IS A SERVER FILTER. `?shelf=home` is a `WHERE`, so the other shelf
 * never reaches the wire; there is no client-side `.filter()` to fall back on
 * and there must not be one (INVARIANTS §11 — viewer filtering is server-side
 * by principle). A forgotten `HOME_SHELF` argument therefore WIDENS, silently,
 * which is why it is a module constant threaded through all four call sites
 * (query key, fetch, star key, create) rather than a literal typed four times.
 *
 * ⚠ AN OLD SERVER IGNORES IT AND THE CLIENT CANNOT TELL. A bundled renderer
 * pointed at an API that predates the shelf gets the MIXED list back and has no
 * field to filter on — `home_scoped` is deliberately never projected. That is
 * not a hole to patch client-side (a filter here would be the §11 violation);
 * it is a DEPLOY ORDER fact: ship the API first. What is pinned instead is the
 * CONTRACT — that this pane always asks (`knowledge-panels-shelf.test.tsx`) and
 * that a new server never answers a shelf request with the mixed list
 * (`server/service-shelf.test.ts`).
 */
const HOME_SHELF = "home" as const;

/** Personal is the caller's OWN private things — see the `personal` memo. */
function isOwnPrivate(base: KnowledgeBase, currentUserId: string): boolean {
  return base.visibility === "private" && base.createdBy === currentUserId;
}

/** Which section a base was opened from, or a create is aimed at. ⚠ Decides
 *  the WORKSPACE (container vs home), which is why it outlived the scope pill
 *  that used to be its only reader. */
type PaneScope = "channel" | "home";

interface OpenBase {
  base: KnowledgeBase;
  /** Which workspace it was opened FROM — decides the mount's workspace id. */
  where: PaneScope;
}

interface MountTarget {
  workspaceId: string;
  segment: string;
  role: Role;
  /** Segment for the `my-access` read, or `null` for a workspace where the
   *  answer cannot differ from the role default (a link container). */
  accessSegment: string | null;
}

/** The caption an `agent_only` grant wears. */
const AGENT_ONLY = "Agent only";

/** Shared frozen empty list — a degraded or not-yet-arrived response falls back
 *  to THIS, so the `useMemo` filters below are not re-run on a fresh `[]`. */
const EMPTY_BASES: readonly KnowledgeBase[] = Object.freeze([]);
