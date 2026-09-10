import { Navigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HOME_PATH } from "#/components/app-shell/account-rail";
import { seedBootAnswer } from "#/components/app-shell/use-workspace-route";
import { PageError, isUnauthorized } from "#/components/page-states";
import { HomePageSkeleton } from "#/pages/home/home-skeleton";
import { SignedOutScreen } from "./signed-out-screen";
import { bootQueryKey, fetchBoot, useAuthPhase } from "./use-boot-state";

/**
 * `/` — SPA boot route. Decides what a launch means, in order:
 *
 *   signed out                 → signed-out screen
 *   signed in, not onboarded   → `/onboarding` (`profiles.onboarded_at` gate)
 *   signed in, onboarded       → `/{segment}`
 *
 * Deleting the LAST workspace navigates here; boot provisions a fresh one
 * rather than stranding on a dead root.
 *
 * ONE ROUND TRIP: `POST /api/boot` answers onboarding-state + ensure-default +
 * resolve + me, and `seedBootAnswer` writes that answer into their cache keys,
 * so shell + first page mount warm.
 *
 * ⚠ `/api/boot` is POST (may provision) but idempotent and read-shaped, so it
 * is modelled as a query — boot must not fire it twice, retry = refetch.
 * Documented exception to CONVENTIONS' "writes use useMutation".
 */
export default function BootPage() {
  const auth = useAuthPhase();
  const signedIn = auth.phase === "signed-in";
  const queryClient = useQueryClient();

  const boot = useQuery({
    queryKey: bootQueryKey(null),
    queryFn: ({ signal }) => fetchBoot(null, signal),
    enabled: signedIn,
    // ⚠ NEVER replay a cached answer: after last-workspace delete or account
    // switch the cached segment is dead — every visit to "/" must re-resolve.
    // POST is idempotent server-side (advisory-lock RPC), so "always" is cheap.
    staleTime: 0,
    refetchOnMount: "always",
  });

  // ⚠ THIS MOUNT'S ANSWER, not disk's. `refetchOnMount: "always"` guarantees a
  // request but does NOT stop the IndexedDB-restored entry (lib/query-client.ts)
  // from rendering first; navigating on it is the replay staleTime prevents.
  // Whole render here is a loading cover, so waiting costs no visible state.
  const answered = boot.isFetchedAfterMount && boot.data !== undefined;

  // Seed every key the answer satisfies BEFORE navigating, so shell + first page
  // mount warm. ⚠ RENDER-PHASE: `<Navigate>` is a child and React runs child
  // effects first — seeded from an effect, shell would already have dispatched
  // its own boot request. Unguarded: `seedBootAnswer` writes only where nothing
  // is cached, so repeat calls are cache lookups and no state change.
  if (answered && boot.data) seedBootAnswer(queryClient, boot.data);

  // Boot states render OUTSIDE page chrome, on raw body carrying the dark
  // landing backdrop — pin to a light cover so text/buttons stay legible.
  if (auth.phase === "pending") return <BootCover label="Starting Dopl" />;
  if (auth.phase === "signed-out") return <SignedOutScreen />;

  // Browser dev mode has no bridge, so 401 is the only signed-out signal there;
  // in Electron it means session died between bridge answer and request.
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

  // ⚠ A COLD LAUNCH ANSWERS THE PERSONAL CONTAINER, AND THAT IS NOT A WORKSPACE
  // ROUTE (2026-09-08, Samuel: "a ghost overview page … the workspace is called
  // Home … none of the icons on the left are selected"). Since the personal-
  // container wave (`20260920120000`) `/api/boot` with no segment provisions and
  // returns the caller's `kind='personal'` container; routing to `/{segment}`
  // rendered the WORKSPACE overview for it. The personal container's surface is
  // /home. A standard workspace (a routed segment, or an older server that sends
  // no kind) still lands on its own route.
  if (boot.data.workspace?.kind === "personal") {
    return <Navigate to={HOME_PATH} replace />;
  }

  return <Navigate to={`/${boot.data.segment}`} replace />;
}

/**
 * The cover every pre-shell state renders on.
 *
 * ⚠ THE LOADING FACE IS /home's FRAME, NOT A WHITE BOX (Samuel, 2026-09-10:
 * *"the loading skeleton for when i first open the app … doesnt look at all like
 * the actual UI"*). This rendered `PageLoading` on `fixed inset-0 bg-white` —
 * a 52px bar over a centred `max-w-[960px]` column on WHITE, where a cold launch
 * resolves into a DARK frame holding the account rail, a gray panel, a 290px
 * relationship list and a bordered record pane. Nothing in that ghost survived
 * the swap, so the first paint of the app was a surface the app does not have.
 *
 * ⚠ /home's FRAME AND NOT THE WORKSPACE SHELL'S, because that is where a cold
 * launch lands: `/api/boot` with no segment answers the caller's `kind='personal'`
 * container and this page routes it to `HOME_PATH` (the 2026-09-08 ruling above).
 * `HomePageSkeleton` is that page's own shape, so the boot cover and /home's own
 * pending gate paint the SAME thing and the hand-off between them is invisible.
 *
 * ⚠ THE ERROR BRANCH KEEPS THE WHITE COVER. `PageError` is TEXT and a button;
 * a shimmering frame is a claim that something is still arriving. Boot states
 * render outside page chrome, on raw body carrying the dark landing backdrop, so
 * that branch still pins itself to a light ground for legibility.
 */
function BootCover({
  label,
  children,
}: {
  label?: string;
  children?: React.ReactNode;
}) {
  if (children) {
    return <div className="fixed inset-0 z-50 flex bg-white">{children}</div>;
  }
  // `shell.root` is already `position: fixed; inset: 0` above the landing
  // backdrop, so the ghost covers without a second fixed box around it.
  return <HomePageSkeleton label={label ?? "Starting Dopl"} />;
}
