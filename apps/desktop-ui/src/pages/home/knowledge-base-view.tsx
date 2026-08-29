import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  invalidateKnowledgeBaseLists,
  useKnowledgeTree,
} from "@/features/knowledge/client/hooks";
import type { KnowledgeBaseList } from "@/features/knowledge/client/api";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { KnowledgeV2PreviewCore } from "@/features/knowledge/components/knowledge-v2/landing-preview-core";
import type {
  KnowledgeRouting,
  KnowledgeUrlSync,
} from "@/features/knowledge/components/knowledge-v2/routing";
import type { BaseTree } from "@/features/knowledge/components/knowledge-v2/types";
import type { KbShelf, KnowledgeBase } from "@/features/knowledge/types";
import type { Role } from "@/features/workspaces/types";
import { PageError } from "#/components/page-states";
import { KnowledgeBaseSkeleton } from "#/components/skeletons/knowledge-skeletons";

/**
 * ONE knowledge base, opened from /home's Knowledge panels.
 *
 * ⚠ THE SAME MOUNT THE KNOWLEDGE PAGE MAKES (`pages/knowledge/index.tsx`),
 * against a DIFFERENT workspace: a KB opened here belongs either to the link
 * CONTAINER behind the selected channel or to the caller's home workspace, and
 * the id passed in is always the base's OWN `workspaceId`. Nothing about this
 * view is channel-scoped — the channel decided WHICH bases the panels offered;
 * once one is open it is an ordinary workspace-scoped read.
 *
 * ⚠ THE TREE IS RESOLVED BEFORE THE CONTROLLER MOUNTS, for the reason
 * `pages/knowledge/index.tsx` gives: `initialSelection` and `initialTrees` are
 * read in STATE INITIALIZERS, and `useKnowledgeV2Controller › loadTree` fires
 * only from `handleSelectBase` (the home grid's card). A selection handed in
 * without its tree therefore never loads one — the detail pane would sit empty
 * forever, with no error and no spinner.
 *
 * 🔒 ⚠ `MyAccessProvider` IS MOUNTED, AND ITS SEGMENT IS THE CALLER'S TO CHOOSE
 * (corrected 2026-08-26). This said "NO `MyAccessProvider` (plan §5.3)" and
 * justified it with an argument about link CONTAINERS — true of containers,
 * FALSE of this component, because **this same view mounts for the HOME
 * workspace too** (`knowledge-panels.tsx › homeTarget`, scope C). That is an
 * ordinary standard workspace which CAN be teams-mode, and `list.bases` handed
 * in is the WHOLE base list, not the private subset the pane offered — so the
 * grid behind the detail pane renders team-visible bases and `canEdit` fell OPEN
 * on every one of them. F-330's *"not reachable-to-harm from the two hosts that
 * exist today"* did not survive this host, and the finding is re-scoped
 * accordingly rather than quietly narrowed.
 *
 * ⚠ `accessSegment` IS `null` FOR A CONTAINER, ON PURPOSE, and that is not the
 * same claim: a container carries no team grants, so `my-access` there answers
 * the plain role default and the request would buy nothing; a caller it would
 * refuse (a guest) never reaches a base to open, because
 * `GET /api/knowledge/bases` refuses them first. So `canEdit` still falls open
 * on the CONTAINER mount — the server is the gate there and this is a
 * one-person-plus-peer surface. **The shape defect is still F-330's**
 * (`use-knowledge-v2-trees.ts › canEdit` maps PROVIDERLESS and PENDING to the
 * same `null`); this change removes the one host where it was reachable, it does
 * not fix the default.
 *
 * ⚠ `kbTeams` is deliberately UNDEFINED and no teams query is mounted: a link
 * container has no teams, and the home-workspace mount would only spend a
 * request to render pills on a base that is private to the caller by
 * construction (scope C is `private` + own).
 */
export function HomeKnowledgeBaseView({
  base,
  workspaceId,
  workspaceSegment,
  accessSegment,
  currentUserId,
  role,
  list,
  shelf,
  onGoToBase,
}: {
  base: KnowledgeBase;
  /** The BASE's own workspace — container or home, never the other one. */
  workspaceId: string;
  workspaceSegment: string;
  /** Segment to resolve `my-access` against, or `null` to mount the provider
   *  inert. ⚠ A link CONTAINER passes `null` (no teams there, nothing to
   *  resolve); a STANDARD workspace passes its segment, because it can be
   *  teams-mode and `canEdit` would otherwise fall open. See the docblock. */
  accessSegment: string | null;
  currentUserId: string;
  /** Caller's role in `workspaceId` (container: owner; home: boot's role). */
  role: Role;
  /** The list response the panels already hold, so the grid behind the detail
   *  pane renders from real data instead of a one-base stub. */
  list: KnowledgeBaseList;
  /**
   * 🔒 WHICH SHELF `list` CAME FROM (`@/features/knowledge/types.ts › KbShelf`)
   * — `"home"` for a scope-C mount, `undefined` for a container one (a link
   * container has no shelves).
   *
   * ⚠ IT IS NOT DECORATION: the view below hands `list.bases` to
   * `KnowledgeV2PreviewCore` as `initialData` for a LIVE query, and that query
   * keys on the shelf. Omit it on a scope-C mount and the pane seeds a
   * home-shelf list into the UNFILTERED cache entry, refetches it unfiltered,
   * and the grid behind the detail quietly fills with the workspace shelf — the
   * reported bug, re-entering one layer down. The star write patches that same
   * entry, so it would go silently dead too (§8).
   */
  shelf?: KbShelf;
  /** `null` = leave this base (the crumb, and the delete handler). */
  onGoToBase: (next: KnowledgeBase | null) => void;
}) {
  const queryClient = useQueryClient();
  const tree = useKnowledgeTree(base.id, workspaceId);

  // 🔒 NO-OP URL SYNC, AND IT MUST BE REFERENTIALLY STABLE.
  // Two separate hazards, both real:
  //   1. The DEFAULT (`routing.ts › createHistoryUrlSync`) is the History API.
  //      /home is not under `/:workspaceSegment` and has no knowledge route, so
  //      the default would `pushState` to `/undefined/knowledge/<segment>` —
  //      an address nothing serves, stranding the Back button on a dead URL
  //      inside a page that never navigated.
  //   2. `routing.ts`'s own header: the controller's write effect DEPENDS on
  //      this object, so one rebuilt per render re-runs that effect with the
  //      pre-change selection. `useState`'s initializer form builds it exactly
  //      once for the life of the mount.
  // `urlFor` and `current` return the same constant, so the controller's
  // "does the address bar already say this?" comparison is always true and no
  // write is ever attempted.
  const [urlSync] = useState<KnowledgeUrlSync>(() => ({
    urlFor: () => NO_URL,
    current: () => NO_URL,
    write: () => {},
    read: () => ({ baseSegment: null, entryId: null }),
    subscribe: () => () => {},
  }));

  const routing = useMemo<KnowledgeRouting>(
    () => ({
      // ⚠ EVERY BASE-LIST VARIANT FOR THIS WORKSPACE, AND A PREFIX IS NOT THAT
      // (corrected 2026-08-26). The panels read the CHANNEL-SCOPED entry and
      // this view's own controller reads the plain one; the channel variant is a
      // STRING extension of the segment (`"bases:W:channel:C"`), so the
      // two-element prefix this used to pass matched the plain entry ALONE and
      // a rename here never reached the grid behind it. `invalidateKnowledgeBaseLists`
      // owns that predicate — see its docblock (INVARIANTS §8).
      refreshServerData: () => {
        invalidateKnowledgeBaseLists(queryClient, workspaceId);
      },
      // A base switch here is LOCAL STATE, not a navigation: there is no route
      // to move to. `null` arrives from the list pane's crumb and from
      // `detail-panel.tsx`'s delete handler; a base arrives from the create
      // dialog this view mounts.
      goToBase: (next) => onGoToBase(next),
    }),
    [onGoToBase, queryClient, workspaceId]
  );

  if (tree.error) {
    return <PageError error={tree.error} onRetry={tree.refetch} />;
  }
  if (!tree.data) {
    // ⚠ `embedded`, for the same reason the view below takes it: this mount
    // lives INSIDE /home's record pane, and a `.page-float` here would be a
    // panel on a panel — the exact defect Samuel ruled on (2026-08-28).
    return <KnowledgeBaseSkeleton label="Loading knowledge base" embedded />;
  }

  const initialTrees: Record<string, BaseTree> = {
    [base.id]: {
      status: "ready",
      folders: tree.data.folders,
      entries: tree.data.entries,
    },
  };

  return (
    <MyAccessProvider workspaceSegment={accessSegment}>
      <KnowledgeV2PreviewCore
        workspaceSegment={workspaceSegment}
        workspaceId={workspaceId}
        bases={list.bases}
        ownerNames={list.ownerNames}
        baseStats={list.baseStats}
        kbStorageLimit={list.kbStorageLimit}
        currentUserId={currentUserId}
        role={role}
        kbTeams={undefined}
        shelf={shelf}
        // ⚠ /home, so the audience is already decided by the section the
        // operator came from — no visibility picker in the create dialog
        // (`@/features/knowledge/components/create-base-dialog.tsx ›
        // Props.audienceFixed`). It also could not be answered honestly on a
        // container mount: a link container has no teams (§4A).
        audienceFixed
        // 🔒 ⚠ NO SECOND PANEL. This renders inside /home's record pane — the
        // `border-2 border-home-panel-line bg-home-card` card in
        // `pages/home/index.tsx` — and the knowledge view's own default is
        // `.page-float`, THE full-page surface, of which the kit allows one per
        // page. Without this the opened base was a panel on a panel, which is
        // the defect Samuel ruled on (2026-08-28). The workspace knowledge page
        // omits the prop and keeps its float.
        embedded
        initialSelection={{ kind: "base", base }}
        initialTrees={initialTrees}
        routing={routing}
        urlSync={urlSync}
      />
    </MyAccessProvider>
  );
}

/** The one address this mount ever reports. Never written anywhere — it exists
 *  so `urlFor` and `current` are comparable and always equal. */
const NO_URL = "";
