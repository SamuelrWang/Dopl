import { useParams } from "react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useApiQueryWith } from "@/shared/hooks/use-api-query-core";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import { workspaceSegment } from "@/features/workspaces/url";
import type { Role, Workspace } from "@/features/workspaces/types";
import {
  BOOT_PATH,
  ONBOARDING_STATE_PATH,
  bootQueryKey,
  fetchBoot,
  type BootPayload,
} from "#/pages/boot/use-boot-state";

/** `GET /api/workspaces/resolve?segment=` — the HTTP twin of the web app's
 *  `resolvePageWorkspace` (docs/migration-research/web-pages.md §1.5). Still
 *  live, still the web app's route, and still read directly by the chats page.
 *  The SPA gets the same answer — plus role, caller id and the access matrix —
 *  from `POST /api/boot`, and SEEDS this key from it so the callers that still
 *  ask never pay a request. */
export interface ResolvedWorkspace {
  workspace: Workspace;
  canonical: string;
  needsRedirect: boolean;
}

export const RESOLVE_PATH = "/api/workspaces/resolve";
export const ME_PATH = "/api/workspaces/me";

/**
 * EXPLICIT, and it stays explicit now that F-163 is fixed.
 *
 * It was originally a workaround: `use-api-query-core` forwarded
 * `staleTime: opts.staleTime` unconditionally and TanStack merges options by
 * spread, so an explicit `undefined` OVERRODE the client default and
 * `QUERY_DEFAULT_OPTIONS.staleTime` (30s) was inert for every query that named
 * none. That is fixed at the hook, so this could now be deleted and inherited.
 * It is not, because the requirement is this query's, not the app's: the boot
 * page SEEDS this key and navigates in the same tick, and a shell that treats
 * the seeded answer as stale refetches it on mount — the serial hop back, one
 * commit later. Naming the value here means a future change to the app-wide
 * default cannot silently undo the launch collapse.
 */
const BOOT_STALE_MS = 30_000;

export interface WorkspaceRoute {
  /** The segment as routed — a legacy slug until the canonical redirect lands. */
  routedSegment: string;
  /** Canonical `{slug}-{publicId}` segment; "" until the resolve returns. */
  segment: string;
  workspace: Workspace | null;
  /** The caller's role on it — free: the resolve proved membership to get it. */
  role: Role | null;
  /** The caller's own user id, from the same answer. */
  currentUserId: string | null;
  /** True while the resolve is in flight (the shell gates the page on it). */
  isPending: boolean;
  error: unknown;
  refetch: () => void;
  /** The routed segment is stale — the shell replaces the URL with `segment`. */
  needsRedirect: boolean;
}

/** `GET /api/workspaces/[segment]/my-access` — the shell's access matrix. */
export function myAccessPath(segment: string): string {
  return `/api/workspaces/${encodeURIComponent(segment)}/my-access`;
}

/**
 * Write ONE boot answer into every cache entry it can satisfy.
 *
 * The boot endpoint collapsed four round trips into one, but four endpoints
 * are still read by callers outside this module — the chats page reads
 * `resolve` + `me`, the settings modal reads `me`, `MyAccessProvider` reads
 * `my-access`, the onboarding page reads `onboarding-state`. Seeding is what
 * turns "one endpoint answers everything" into "nobody else fetches": each of
 * those queries mounts against a warm, fresh entry (staleTime 30s) and never
 * dispatches.
 *
 * A SEED, NOT AN OVERRIDE — `setQueryData` only where nothing is cached, so a
 * live answer is never clobbered by a boot payload that may be a moment older.
 */
export function seedBootAnswer(
  queryClient: QueryClient,
  boot: BootPayload,
  routedSegment?: string
): void {
  // DURING RENDER, NOT IN AN EFFECT — and the ordering is the whole reason
  // this is worth a note. React runs CHILD effects before parent ones, and
  // both the things that consume these seeds are children: `<Navigate>` on
  // the boot page (its effect performs the navigation) and the routed page
  // under the shell's `<Outlet/>` (its effects dispatch its queries). Seeded
  // from a parent effect, every one of them fires its own request first and
  // the seed lands a round trip too late — the exact hop this endpoint was
  // built to delete. Writing to the query cache is an external-store write,
  // idempotent here (see `seed` below), so a render-phase call is safe.
  const seed = (key: readonly unknown[], value: unknown) => {
    if (queryClient.getQueryData(key) === undefined) {
      queryClient.setQueryData(key, value);
    }
  };

  seed([ONBOARDING_STATE_PATH, undefined, undefined], {
    isOnboarded: boot.isOnboarded,
    surveyCompleted: boot.surveyCompleted,
  });

  const { workspace, segment } = boot;
  if (!workspace || !segment) return;

  // The SHELL's own key, so the boot page's launch answer already serves the
  // navigation into `/{segment}` that immediately follows it.
  seed(bootQueryKey(segment), { ...boot, needsRedirect: false });
  const resolved: ResolvedWorkspace = {
    workspace,
    canonical: segment,
    needsRedirect: false,
  };
  seed([RESOLVE_PATH, undefined, { segment }], resolved);
  // A stale routed segment answers for BOTH URLs, mirroring the web 301 where
  // one response serves the old path and the new one.
  if (routedSegment && routedSegment !== segment) {
    seed([RESOLVE_PATH, undefined, { segment: routedSegment }], {
      ...resolved,
      needsRedirect: true,
    });
  }
  if (boot.role !== null) {
    seed([ME_PATH, workspace.id, undefined], {
      role: boot.role,
      userId: boot.userId,
    });
  }
  if (boot.myAccess) {
    seed([myAccessPath(segment), undefined, undefined], boot.myAccess);
  }
}

/**
 * The transport `useApiQueryWith` calls. `/api/boot` is a POST (its
 * no-segment mode may provision), which `apiRequest`'s GET-shaped hook
 * contract does not express — so the method is bound here and the hook keeps
 * everything else it is hardened for: the `[path, workspaceId, query]` cache
 * key, the disabled-query refetch guard, and the pending+idle self-heal that
 * fixed the stale-segment navigation flake.
 */
function bootRequest<T>(
  _path: string,
  opts?: Pick<ApiRequestOpts, "workspaceId" | "query" | "signal">
): Promise<T> {
  const segment = opts?.query?.segment;
  return fetchBoot(
    typeof segment === "string" ? segment : null,
    opts?.signal
  ) as Promise<T>;
}

/**
 * Resolves `/:workspaceSegment` to a workspace, for the shell AND for pages.
 *
 * Both call it with the same query key, so the workspace costs ONE request per
 * segment no matter how many components need it — which is why pages read the
 * workspace through this hook instead of through router context.
 *
 * It reads `POST /api/boot`, not `GET /api/workspaces/resolve`, and that is
 * the point of P0-2: the same round trip that resolves the segment also
 * carries the caller's role, their user id, and the workspace access matrix.
 * Those were two further hops (`me`, then `my-access`) that could not start
 * until this one landed — and the shell gates `<Outlet/>` on this one, so
 * every page's own data queued behind all three. The endpoint accepts the
 * canonical `{slug}-{publicId}` form and legacy slug-only URLs, and reports
 * `needsRedirect` where the web app 301s.
 */
export function useWorkspaceRoute(): WorkspaceRoute {
  const { workspaceSegment: routedSegment = "" } = useParams();

  const query = useApiQueryWith<BootPayload>(
    bootRequest,
    routedSegment ? BOOT_PATH : null,
    { query: { segment: routedSegment }, staleTime: BOOT_STALE_MS }
  );

  const workspace = query.data?.workspace ?? null;

  // SEED THE OTHER KEYS from this answer, INCLUDING the canonical one on a
  // redirect: the stale-segment response already carries the whole workspace,
  // so the post-rewrite remount must not pay (or race) a second resolve.
  // Render-phase, before the `<Outlet/>` children render and dispatch their
  // own queries (see `seedBootAnswer`). Unguarded because that helper writes
  // only where nothing is cached — including this hook's OWN key, which
  // always holds `query.data` by the time we get here — so every call after
  // the first is a handful of cache lookups and no state change.
  const queryClient = useQueryClient();
  if (query.data) seedBootAnswer(queryClient, query.data, routedSegment);

  return {
    routedSegment,
    segment: workspace ? workspaceSegment(workspace) : "",
    workspace,
    role: query.data?.role ?? null,
    currentUserId: query.data?.userId ?? null,
    isPending: query.isPending,
    error: query.error,
    refetch: query.refetch,
    needsRedirect: query.data?.needsRedirect ?? false,
  };
}
