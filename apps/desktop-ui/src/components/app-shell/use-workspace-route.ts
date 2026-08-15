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

/** `GET /api/workspaces/resolve?segment=` — HTTP twin of the server's
 *  `resolveWorkspaceSegmentForUser`. Still the web app's route, still read
 *  directly by the chats page. The SPA gets the same answer plus role, caller
 *  id and access matrix from `POST /api/boot`, and SEEDS this key from it so
 *  the callers that still ask never pay a request. */
export interface ResolvedWorkspace {
  workspace: Workspace;
  canonical: string;
  needsRedirect: boolean;
}

export const RESOLVE_PATH = "/api/workspaces/resolve";
export const ME_PATH = "/api/workspaces/me";

/**
 * ⚠ Named EXPLICITLY even though it now equals the app-wide default. The boot
 * page SEEDS this key and navigates in the same tick; a shell that treats the
 * seeded answer as stale refetches on mount — the serial hop back, one commit
 * later. Stating it here means a change to the app-wide default cannot silently
 * undo the launch collapse.
 */
const BOOT_STALE_MS = 30_000;

export interface WorkspaceRoute {
  /** The segment as routed — a legacy slug until the canonical redirect lands. */
  routedSegment: string;
  /** Canonical `{slug}-{publicId}` segment; "" until the resolve returns. */
  segment: string;
  workspace: Workspace | null;
  /** Caller's role — free: the resolve proved membership to get it. */
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
 * Write ONE boot answer into every cache entry it can satisfy. Callers outside
 * this module still read four endpoints (chats: `resolve` + `me`; settings
 * modal: `me`; `MyAccessProvider`: `my-access`; onboarding:
 * `onboarding-state`); seeding is what turns "one endpoint answers everything"
 * into "nobody else fetches".
 *
 * ⚠ A SEED, NOT AN OVERRIDE: `setQueryData` only where nothing is cached, so a
 * live answer is never clobbered by an older boot payload.
 */
export function seedBootAnswer(
  queryClient: QueryClient,
  boot: BootPayload,
  routedSegment?: string
): void {
  // ⚠ Called DURING RENDER, not in an effect. React runs CHILD effects before
  // parent ones, and both consumers of these seeds are children: `<Navigate>`
  // on the boot page and the routed page under the shell's `<Outlet/>`. Seeded
  // from a parent effect, each fires its own request first and the seed lands
  // a round trip too late — the exact hop this endpoint deletes. Safe because
  // a query-cache write is an external-store write, idempotent here.
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

  // SHELL's own key, so the boot page's launch answer already serves the
  // navigation into `/{segment}` that immediately follows it.
  seed(bootQueryKey(segment), { ...boot, needsRedirect: false });
  const resolved: ResolvedWorkspace = {
    workspace,
    canonical: segment,
    needsRedirect: false,
  };
  seed([RESOLVE_PATH, undefined, { segment }], resolved);
  // A stale routed segment answers for BOTH URLs, mirroring the web 301.
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
 * Transport `useApiQueryWith` calls. `/api/boot` is a POST (its no-segment mode
 * may provision), which `apiRequest`'s GET-shaped hook contract cannot express,
 * so the method is bound here and the hook keeps the rest: `[path, workspaceId,
 * query]` cache key, disabled-query refetch guard, pending+idle self-heal.
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
 * Resolves `/:workspaceSegment` for the shell AND for pages, on one query key,
 * so a workspace costs ONE request per segment — which is why pages read it
 * here, not from router context.
 *
 * ⚠ Reads `POST /api/boot`, not `GET /api/workspaces/resolve`: the same round
 * trip carries role, user id and the access matrix, which were two further
 * serial hops behind the `<Outlet/>` gate. Accepts canonical
 * `{slug}-{publicId}` and legacy slug-only URLs; reports `needsRedirect` where
 * the web app 301s.
 */
export function useWorkspaceRoute(): WorkspaceRoute {
  const { workspaceSegment: routedSegment = "" } = useParams();

  const query = useApiQueryWith<BootPayload>(
    bootRequest,
    routedSegment ? BOOT_PATH : null,
    { query: { segment: routedSegment }, staleTime: BOOT_STALE_MS }
  );

  const workspace = query.data?.workspace ?? null;

  // Seed the other keys, INCLUDING the canonical one on a redirect: the
  // stale-segment response already carries the whole workspace, so the
  // post-rewrite remount must not pay (or race) a second resolve. Render-phase,
  // before `<Outlet/>` children dispatch their own queries. Unguarded because
  // `seedBootAnswer` writes only where nothing is cached, so every call after
  // the first is cache lookups and no state change.
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
