import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess, type WorkspaceAccess } from "#/hooks/use-workspace-access";
import { useKnowledgeUrlSync } from "./use-knowledge-url-sync";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { KnowledgeV2PreviewCore } from "@/features/knowledge/components/knowledge-v2/landing-preview-core";
// Vite-bundled hero for the knowledge home banner — the shared tree takes it
// as a prop (it cannot import an SPA-local asset; WelcomePopup precedent).
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
 * `/:workspaceSegment/knowledge` AND `/:workspaceSegment/knowledge/:kbSlug` —
 * the port of `src/app/[workspaceSlug]/(app)/knowledge/{page,[kbSlug]/page}.tsx`.
 *
 * ONE component serves BOTH routes, and that is load-bearing rather than a
 * convenience. The view keeps every open tree and an unsaved editor body in
 * the controller's state, and the web app protected all of it by moving the
 * address bar with the raw History API instead of navigating. Registering
 * `knowledge` and `knowledge/:kbSlug` with the same component type gives the
 * hash router the same property: react-router reconciles the two matches, so
 * selecting a base changes the URL and the params without remounting
 * anything. `./detail.tsx` re-exports this for the second route row.
 *
 * TWO ROUTES, TWO MODES, still one component. The knowledge root renders a
 * card grid over the bases; a base's URL renders the two-pane tree+detail
 * view. `KnowledgeV2` picks between them off the CONTROLLER'S SELECTION, not
 * off `useParams` — the selection and the URL are already kept in agreement in
 * both directions, and a second reader of the route would run one render
 * behind that. Crossing between the modes is a real navigation, so the DETAIL
 * SUBTREE unmounts even though this component does not; that is safe because
 * `doc-pane.tsx` flushes a final PUT from its unmount cleanup, so an unsaved
 * body is written rather than dropped. What survives the crossing is
 * everything the controller owns: loaded trees, the search text, the scope
 * filter.
 *
 * What the two RSCs did before rendering, this does client-side:
 *   - `listBases` + `listBaseOwnerNames` → `GET /api/knowledge/bases`, which
 *     now answers both halves (`useKnowledgeBaseList`, one cache entry shared
 *     with the controller's own bases query).
 *   - `listTeams` → `GET /api/workspaces/{slug}/teams`, admin-gated exactly
 *     as the pages gate it, with the same 6-line grant→kbTeams fold.
 *   - `resolvePageKbWithWorkspace`'s slug resolution + 301 → `findBaseBySegment`
 *     against the loaded list, then a `replace` onto the canonical segment.
 *   - `getBaseTree` + the validated `?entryId=` `getEntry` → the existing
 *     knowledge query hooks, seeded into the controller as `initialTrees` /
 *     `initialSelection`.
 */
export default function KnowledgePage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();
  // The skeleton has to match the mode it is standing in for, and the route
  // already says which: no `:kbSlug` means the single-surface card grid, so a
  // two-pane ghost here would resolve into a shape the user never asked for.
  const { kbSlug } = useParams();
  const variant = kbSlug ? "two-pane" : "page";

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) {
    return <PageLoading label="Loading knowledge" variant={variant} />;
  }

  // Every knowledge query needs the resolved workspace id, and the knowledge
  // hooks have no `enabled` switch — so the data half only mounts once the
  // workspace is known.
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

  // The deep link is a MOUNT-TIME fact. Once the view is up the controller
  // owns the URL, so re-reading the params on every navigation would re-fetch
  // a tree it already has and fight it for the selection.
  const [deepLink] = useState(() => ({
    kbSlug,
    entryId: searchParams.get("entryId"),
  }));

  const baseList = useKnowledgeBaseList(workspaceId);
  const bases = baseList.data?.bases;

  const teams = useApiQuery<{ teams: TeamView[] }, TeamView[]>(
    // Members only ever see the scope label, so skip the query for them —
    // the same gate the RSCs apply before calling `listTeams`.
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

  // Did the deep link EVER have a target? Latched during render (the
  // sanctioned adjust-state-during-render pattern — no effect round trip),
  // because it is the only thing separating the two ways `deepLinkBase` can
  // be null: a segment that never named a base (the page's `notFound()`) from
  // one whose base has since been DELETED. Deleting is now permanent and is
  // the ordinary path here, and the frozen `deepLink` above outlives it —
  // this component serves both knowledge routes and deliberately never
  // remounts, so the delete handlers' navigate leaves `deepLink.kbSlug`
  // standing and the page would harden into a full-page error card that only
  // a reload clears.
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  if (deepLinkBase && !deepLinkResolved) setDeepLinkResolved(true);

  // The page's 301 on a stale/legacy KB segment. No server hop to carry it,
  // so replace the history entry — the shell does the same for a stale
  // workspace segment.
  const canonicalSegment = deepLinkBase ? knowledgeBaseSegment(deepLinkBase) : null;
  useEffect(() => {
    if (!canonicalSegment || canonicalSegment === deepLink.kbSlug) return;
    // Carry the query string across — the page's 301 preserved `?entryId=`,
    // and dropping it here would silently demote a deep link to the base.
    navigate(`/${workspaceSlug}/knowledge/${canonicalSegment}${location.search}`, {
      replace: true,
    });
  }, [canonicalSegment, deepLink.kbSlug, location.search, navigate, workspaceSlug]);

  const tree = useKnowledgeTree(deepLinkBase?.id, workspaceId);
  const treeEntries = tree.data?.entries;

  // Honor `?entryId=` only when it belongs to THIS base's already
  // visibility-filtered tree; otherwise fall back to the first entry, exactly
  // as `[kbSlug]/page.tsx` does before its `getEntry`.
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
      // The web app's six `router.refresh()` sites exist only to re-pull
      // `ownerNames` and `kbTeams`. Here those are queries, so this is the
      // targeted invalidation the playbook asks for instead.
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
    // `resolvePageKb` calls `notFound()` here; the SPA has no 404 route, so
    // the shared error card carries the same message. A base that resolved
    // once and is now gone falls through instead: a deleted deep-link target
    // is NO deep link, not an error, and the page renders the knowledge root
    // the delete already navigated to.
    return <PageError error={new Error("Knowledge base not found")} />;
  }

  // A deep link must resolve fully BEFORE the controller mounts — it reads
  // `initialSelection`/`initialTrees` in state initializers, so a later
  // arrival would be dropped on the floor.
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
    // The web app mounts this in the (app) layout; the SPA shell does not yet,
    // and without it `canEdit` falls open for everyone (the server still
    // enforces). One shared query key, so a shell-level provider later
    // collapses onto the same request rather than duplicating it.
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
