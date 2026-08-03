import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "#/lib/api";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { SignedOutScreen } from "./signed-out-screen";
import {
  ENSURE_DEFAULT_PATH,
  ONBOARDING_STATE_PATH,
  useAuthPhase,
} from "./use-boot-state";

/**
 * `/` — the SPA's boot route: the one place that decides what a launch means.
 * Replaces the placeholder that said "Workspace resolution is not ported yet",
 * and stands in for the web app's two server-side boot pages
 * (`src/app/page.tsx` and `src/app/canvas/page.tsx`).
 *
 * The decision, in order — each branch is one of the web app's server redirects:
 *
 *   signed out                 → the signed-out screen (journey-audit GAP-1;
 *                                the web app's `redirect("/login")`)
 *   signed in, not onboarded   → `/onboarding` (the `profiles.onboarded_at`
 *                                gate every RSC boot page checked)
 *   signed in, onboarded       → `POST /api/workspaces/ensure-default`, then
 *                                `/{segment}` (which the route table's index
 *                                redirect turns into the workspace home)
 *
 * This is also the terminal step of journey-audit **G2**: deleting the LAST
 * workspace navigates here, and `ensure-default` provisions a fresh one rather
 * than leaving the user on a dead root — the same convergence the web app got
 * from pushing `/onboarding` and having the RSC bounce an already-onboarded
 * user to `/canvas`.
 *
 * `ensure-default` is a POST because it may provision, but it is idempotent and
 * read-shaped (`ensureDefaultWorkspace` returns the existing workspace
 * untouched and converges on the unique-violation race), so it is modelled as a
 * query: boot must not fire it twice, and a retry is a refetch. This is the
 * documented exception to CONVENTIONS' "writes use useMutation".
 */
export default function BootPage() {
  const auth = useAuthPhase();
  const signedIn = auth.phase === "signed-in";

  const onboarding = useApiQuery<{ isOnboarded: boolean }>(
    signedIn ? ONBOARDING_STATE_PATH : null
  );
  const onboarded = onboarding.data?.isOnboarded === true;

  const workspace = useQuery({
    queryKey: [ENSURE_DEFAULT_PATH],
    queryFn: ({ signal }) =>
      apiRequest<{ segment: string }>(ENSURE_DEFAULT_PATH, {
        method: "POST",
        signal,
      }),
    enabled: signedIn && onboarded,
    staleTime: Infinity,
  });

  if (auth.phase === "pending") return <PageLoading label="Starting Dopl" />;
  if (auth.phase === "signed-out") return <SignedOutScreen />;

  // The bridge is not consulted in browser dev mode, so a 401 from either call
  // is the only signed-out signal there — and inside Electron it means the
  // session died between the bridge's answer and the request.
  if (isUnauthorized(onboarding.error) || isUnauthorized(workspace.error)) {
    return <SignedOutScreen />;
  }

  if (onboarding.error) {
    return (
      <PageError
        error={onboarding.error}
        onRetry={() => {
          auth.refresh();
          void onboarding.refetch();
        }}
      />
    );
  }
  if (onboarding.isPending) return <PageLoading label="Starting Dopl" />;

  if (!onboarded) return <Navigate to="/onboarding" replace />;

  if (workspace.error) {
    return <PageError error={workspace.error} onRetry={() => void workspace.refetch()} />;
  }
  if (workspace.isPending || !workspace.data) {
    return <PageLoading label="Opening workspace" />;
  }

  return <Navigate to={`/${workspace.data.segment}`} replace />;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
