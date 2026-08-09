import { Navigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { seedBootAnswer } from "#/components/app-shell/use-workspace-route";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "./signed-out-screen";
import { bootQueryKey, fetchBoot, useAuthPhase } from "./use-boot-state";

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
 *   signed in, onboarded       → `/{segment}` (which the route table's index
 *                                redirect turns into the workspace home)
 *
 * This is also the terminal step of journey-audit **G2**: deleting the LAST
 * workspace navigates here, and boot provisions a fresh one rather than
 * leaving the user on a dead root — the same convergence the web app got from
 * pushing `/onboarding` and having the RSC bounce an already-onboarded user
 * to `/canvas`.
 *
 * ONE ROUND TRIP (launch-blocker P0-2). This used to be two serial requests
 * here — `onboarding-state`, then `ensure-default` gated on its answer — and
 * two more after the navigation, because the shell re-resolved the segment
 * and every page then asked `me`. `POST /api/boot` answers all four, and
 * `seedBootAnswer` writes that one answer into their cache keys, so the shell
 * mounts warm and no page's first data fetch waits on anything.
 *
 * `/api/boot` is a POST because it may provision, but it is idempotent and
 * read-shaped (`ensureDefaultWorkspace` returns the existing workspace
 * untouched and converges on the unique-violation race), so it is modelled as
 * a query: boot must not fire it twice, and a retry is a refetch. This is the
 * documented exception to CONVENTIONS' "writes use useMutation".
 */
export default function BootPage() {
  const auth = useAuthPhase();
  const signedIn = auth.phase === "signed-in";
  const queryClient = useQueryClient();

  const boot = useQuery({
    queryKey: bootQueryKey(null),
    queryFn: ({ signal }) => fetchBoot(null, signal),
    enabled: signedIn,
    // NEVER replay a cached answer: after a last-workspace delete (or a
    // different account signing in) the cached segment is a corpse — every
    // visit to "/" must re-resolve. The POST is idempotent server-side
    // (advisory-lock RPC), so "always" costs one cheap round trip. It is now
    // the ONLY round trip a launch costs, which is what makes that
    // affordable; the shell and the pages read this answer out of the cache.
    staleTime: 0,
    refetchOnMount: "always",
  });

  // THIS MOUNT'S ANSWER, not the disk's. `refetchOnMount: "always"` guarantees
  // a request; it does NOT stop the RESTORED entry from rendering first, and
  // now that the query cache is persisted to IndexedDB
  // (`lib/query-client.ts`) a relaunch has one. Navigating on it would be the
  // exact replay the staleTime above exists to prevent — routing into a
  // workspace a delete or an account switch has made a corpse, one frame
  // before the authoritative answer says so. Everywhere else in the app a
  // restored entry is a free first paint; here it is a routing decision, and
  // this route's whole render is a loading cover anyway, so waiting costs no
  // visible state.
  const answered = boot.isFetchedAfterMount && boot.data !== undefined;

  // Hand the answer to every key it satisfies BEFORE navigating, so the shell
  // and the first page mount against warm data instead of re-fetching it.
  // RENDER-PHASE, deliberately: `<Navigate>` is a child, and React runs child
  // effects first — seeded from an effect here, the shell would already have
  // dispatched its own boot request by the time the seed landed. Unguarded
  // because `seedBootAnswer` writes only where nothing is cached, so every
  // call after the first is a handful of cache lookups and no state change.
  if (answered && boot.data) seedBootAnswer(queryClient, boot.data);

  // Boot states render OUTSIDE any page chrome — on the raw body, which
  // carries the dark landing backdrop. Pin them to a light cover so text
  // and buttons are legible (the web equivalent was AuthSplitLayout).
  if (auth.phase === "pending") return <BootCover label="Starting Dopl" />;
  if (auth.phase === "signed-out") return <SignedOutScreen />;

  // The bridge is not consulted in browser dev mode, so a 401 is the only
  // signed-out signal there — and inside Electron it means the session died
  // between the bridge's answer and the request.
  if (isUnauthorized(boot.error)) return <SignedOutScreen />;

  if (boot.error) {
    return (
      <BootCover>
        <PageError
          error={boot.error}
          onRetry={() => {
            auth.refresh();
            void boot.refetch();
          }}
        />
      </BootCover>
    );
  }
  if (!answered || !boot.data) return <BootCover label="Starting Dopl" />;

  if (!boot.data.isOnboarded) return <Navigate to="/onboarding" replace />;
  if (!boot.data.segment) return <BootCover label="Opening workspace" />;

  return <Navigate to={`/${boot.data.segment}`} replace />;
}

/** The light cover every pre-shell state renders on. */
function BootCover({
  label,
  children,
}: {
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex bg-white">
      {children ?? <PageLoading label={label} />}
    </div>
  );
}
