import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useKnowledgeTree } from "@/features/knowledge/client/hooks";
import type { KnowledgeBaseList } from "@/features/knowledge/client/api";
import { KnowledgeV2PreviewCore } from "@/features/knowledge/components/knowledge-v2/landing-preview-core";
import type {
  KnowledgeRouting,
  KnowledgeUrlSync,
} from "@/features/knowledge/components/knowledge-v2/routing";
import type { BaseTree } from "@/features/knowledge/components/knowledge-v2/types";
import type { KnowledgeBase } from "@/features/knowledge/types";
import type { Role } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";

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
 * ⚠ NO `MyAccessProvider` (plan §5.3). Against a link container the provider
 * cannot change the answer: containers carry no team grants, so `my-access`
 * resolves to the plain role default, and a caller it would refuse (a guest)
 * has already been refused by `GET /api/knowledge/bases` and has no base to
 * open. `canEdit` consequently FALLS OPEN here — see
 * `use-knowledge-v2-trees.ts › canEdit`, REFACTOR-FINDINGS F-330. The server
 * is the gate; nothing on this surface relies on the client's answer.
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
  currentUserId,
  role,
  list,
  onGoToBase,
}: {
  base: KnowledgeBase;
  /** The BASE's own workspace — container or home, never the other one. */
  workspaceId: string;
  workspaceSegment: string;
  currentUserId: string;
  /** Caller's role in `workspaceId` (container: owner; home: boot's role). */
  role: Role;
  /** The list response the panels already hold, so the grid behind the detail
   *  pane renders from real data instead of a one-base stub. */
  list: KnowledgeBaseList;
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
      // ⚠ THE PREFIX, NOT AN EXACT KEY. The panels read the CHANNEL-SCOPED
      // entry (`["knowledge", "bases:<ws>", "channel:<id>"]`) and this view's
      // own controller reads the plain one; TanStack matches per element, so
      // the two-element prefix reaches both and an exact key would silently
      // refresh only one of them (INVARIANTS §8).
      refreshServerData: () => {
        void queryClient.invalidateQueries({
          queryKey: ["knowledge", `bases:${workspaceId}`],
        });
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
    return <PageLoading label="Loading knowledge base" variant="two-pane" />;
  }

  const initialTrees: Record<string, BaseTree> = {
    [base.id]: {
      status: "ready",
      folders: tree.data.folders,
      entries: tree.data.entries,
    },
  };

  return (
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
      initialSelection={{ kind: "base", base }}
      initialTrees={initialTrees}
      routing={routing}
      urlSync={urlSync}
    />
  );
}

/** The one address this mount ever reports. Never written anywhere — it exists
 *  so `urlFor` and `current` are comparable and always equal. */
const NO_URL = "";
