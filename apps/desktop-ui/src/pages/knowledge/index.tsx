import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess, type WorkspaceAccess } from "#/hooks/use-workspace-access";
import { useKnowledgeUrlSync } from "./use-knowledge-url-sync";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { KnowledgeV2PreviewCore } from "@/features/knowledge/components/knowledge-v2/landing-preview-core";
// Vite-bundled hero, passed as a prop: shared tree cannot import an SPA-local
// asset (WelcomePopup precedent).
import knowledgeHero from "#/assets/knowledge-hero.jpg";
import type { KnowledgeRouting } from "@/features/knowledge/components/knowledge-v2/routing";
import type {
  BaseTree,
  KbTeamRef,
  Selection,
} from "@/features/knowledge/components/knowledge-v2/types";
import {
  useKnowledgeBaseList,
  useKnowledgeEntry,
  useKnowledgeTree,
} from "@/features/knowledge/client/hooks";
import { findBaseBySegment, knowledgeBaseSegment } from "@/features/knowledge/url";
import type { TeamView } from "@/features/teams/types";

/**
 * `/:workspaceSegment/knowledge` AND `/:workspaceSegment/knowledge/:kbSlug`.
 *
 * ⚠ ONE component serves BOTH routes, and that is load-bearing: the controller
 * holds every open tree and an unsaved editor body in state. Registering both
 * paths with the same component type makes react-router reconcile the two
 * matches, so selecting a base changes URL + params without remounting.
 * `./detail.tsx` re-exports this for the second route row.
 *
 * TWO MODES: root = card grid over bases; base URL = two-pane tree+detail.
 * `KnowledgeV2` picks off the CONTROLLER'S SELECTION, not `useParams` — a
 * second reader of the route runs one render behind. Crossing modes IS a real
 * navigation, so the DETAIL SUBTREE unmounts even though this component does
 * not; safe because `doc-pane.tsx` flushes a final PUT from unmount cleanup.
 * Controller-owned state (loaded trees, search text, scope filter) survives.
 */
export default function KnowledgePage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();
  // Skeleton must match the mode it stands in for: no `:kbSlug` = card grid, so
  // a two-pane ghost would resolve into a shape the user never asked for.
  const { kbSlug } = useParams();
  const variant = kbSlug ? "two-pane" : "page";

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) {
    return <PageLoading label="Loading knowledge" variant={variant} />;
  }

  // ⚠ Knowledge hooks have no `enabled` switch and all need the resolved
  // workspace id, so the data half only mounts once the workspace is known.
  return <KnowledgeView access={access} />;
}

function KnowledgeView({ access }: { access: WorkspaceAccess }) {
  const { workspaceId, workspaceSlug, currentUserId, role, isAdmin } = access;
  const { kbSlug } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlSync = useKnowledgeUrlSync(workspaceSlug);

  // ⚠ Deep link is a MOUNT-TIME fact. Controller owns the URL once up, so
  // re-reading params per navigation re-fetches a tree it has and fights it for
  // the selection.
  const [deepLink] = useState(() => ({
    kbSlug,
    entryId: searchParams.get("entryId"),
  }));

  const baseList = useKnowledgeBaseList(workspaceId);
  const bases = baseList.data?.bases;

  const teams = useApiQuery<{ teams: TeamView[] }, TeamView[]>(
    // Members only see the scope label — skip the query for them.
    isAdmin ? `/api/workspaces/${workspaceSlug}/teams` : null,
    { select: (body) => body.teams ?? [] }
  );
  const kbTeams = useMemo(
    () => (teams.data ? foldKbTeams(teams.data) : undefined),
    [teams.data]
  );

  const deepLinkBase = useMemo(
    () => (deepLink.kbSlug && bases ? findBaseBySegment(bases, deepLink.kbSlug) : null),
    [bases, deepLink.kbSlug]
  );

  // ⚠ Did the deep link EVER have a target? Latched during render (sanctioned
  // adjust-state-during-render, no effect round trip). Only thing separating
  // the two ways `deepLinkBase` goes null: segment never named a base (404) vs
  // base DELETED since. Deletes are permanent and ordinary here, and this
  // component never remounts, so the delete handler's navigate leaves
  // `deepLink.kbSlug` standing — without the latch the page hardens into a
  // full-page error card only a reload clears.
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  if (deepLinkBase && !deepLinkResolved) setDeepLinkResolved(true);

  // 301 equivalent for a stale/legacy KB segment: no server hop, so replace the
  // history entry (shell does the same for a stale workspace segment).
  const canonicalSegment = deepLinkBase ? knowledgeBaseSegment(deepLinkBase) : null;
  useEffect(() => {
    if (!canonicalSegment || canonicalSegment === deepLink.kbSlug) return;
    // ⚠ Carry the query string across: dropping it silently demotes an
    // `?entryId=` deep link to the base.
    navigate(`/${workspaceSlug}/knowledge/${canonicalSegment}${location.search}`, {
      replace: true,
    });
  }, [canonicalSegment, deepLink.kbSlug, location.search, navigate, workspaceSlug]);

  const tree = useKnowledgeTree(deepLinkBase?.id, workspaceId);
  const treeEntries = tree.data?.entries;

  // ⚠ Honor `?entryId=` only when it belongs to THIS base's already
  // visibility-filtered tree; else fall back to the first entry.
  const selectedEntryId = treeEntries
    ? ((deepLink.entryId && treeEntries.some((e) => e.id === deepLink.entryId)
        ? deepLink.entryId
        : null) ??
      treeEntries[0]?.id ??
      null)
    : null;
  const initialEntry = useKnowledgeEntry(selectedEntryId, workspaceId);

  const routing = useMemo<KnowledgeRouting>(
    () => ({
      // Shared tree's `router.refresh()` sites only ever re-pull `ownerNames`
      // and `kbTeams`; here both are queries, so invalidate those two keys.
      refreshServerData: () => {
        void queryClient.invalidateQueries({
          queryKey: ["knowledge", `bases:${workspaceId}`],
        });
        void queryClient.invalidateQueries({
          queryKey: [`/api/workspaces/${workspaceSlug}/teams`],
        });
      },
      goToBase: (base, mode) => {
        const to = base
          ? `/${workspaceSlug}/knowledge/${knowledgeBaseSegment(base)}`
          : `/${workspaceSlug}/knowledge`;
        navigate(to, { replace: mode === "replace" });
      },
    }),
    [navigate, queryClient, workspaceId, workspaceSlug]
  );

  if (baseList.error) {
    return <PageError error={baseList.error} onRetry={baseList.refetch} />;
  }
  if (!bases) {
    return (
      <PageLoading
        label="Loading knowledge"
        variant={deepLink.kbSlug ? "two-pane" : "page"}
      />
    );
  }

  if (deepLink.kbSlug && !deepLinkBase && !deepLinkResolved) {
    // SPA has no 404 route, so the shared error card carries the message. ⚠ A
    // base that resolved once and is now gone falls THROUGH instead: a deleted
    // deep-link target is no deep link, not an error — render the knowledge
    // root the delete already navigated to.
    return <PageError error={new Error("Knowledge base not found")} />;
  }

  // ⚠ Deep link must resolve fully BEFORE the controller mounts: it reads
  // `initialSelection`/`initialTrees` in state initializers, so a later arrival
  // is dropped on the floor.
  if (deepLinkBase) {
    if (tree.error) return <PageError error={tree.error} onRetry={tree.refetch} />;
    if (!tree.data) return <PageLoading label="Loading knowledge base" variant="two-pane" />;
    if (selectedEntryId && !initialEntry.data && initialEntry.status !== "error") {
      return <PageLoading label="Loading knowledge base" variant="two-pane" />;
    }
  }

  const initialTrees: Record<string, BaseTree> | undefined =
    deepLinkBase && tree.data
      ? {
          [deepLinkBase.id]: {
            status: "ready",
            folders: tree.data.folders,
            entries: tree.data.entries,
          },
        }
      : undefined;
  const initialSelection: Selection | null = deepLinkBase
    ? initialEntry.data
      ? { kind: "entry", base: deepLinkBase, entry: initialEntry.data }
      : { kind: "base", base: deepLinkBase }
    : null;

  return (
    // ⚠ SPA shell does not mount this yet; without it `canEdit` falls open for
    // everyone (server still enforces). Same query key as a future shell-level
    // provider, so that one collapses onto this request rather than duplicating.
    <MyAccessProvider workspaceSegment={workspaceSlug}>
      <KnowledgeV2PreviewCore
        workspaceSegment={workspaceSlug}
        workspaceId={workspaceId}
        bases={bases}
        ownerNames={baseList.data?.ownerNames}
        baseStats={baseList.data?.baseStats}
        kbStorageLimit={baseList.data?.kbStorageLimit}
        currentUserId={currentUserId}
        role={role}
        kbTeams={kbTeams}
        initialSelection={initialSelection}
        initialTrees={initialTrees}
        heroImageSrc={knowledgeHero}
        routing={routing}
        urlSync={urlSync}
      />
    </MyAccessProvider>
  );
}

/** kbId → the teams holding a grant on it, for the base overview's pills. */
function foldKbTeams(teams: TeamView[]): Record<string, KbTeamRef[]> {
  const map: Record<string, KbTeamRef[]> = {};
  for (const team of teams) {
    for (const grant of team.grants) {
      if (grant.resourceType !== "knowledge_base") continue;
      (map[grant.resourceId] ??= []).push({
        teamId: team.id,
        name: team.name,
        color: team.color,
      });
    }
  }
  return map;
}
