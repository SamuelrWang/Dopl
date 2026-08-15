import { Navigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { seedBootAnswer } from "#/components/app-shell/use-workspace-route";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
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
