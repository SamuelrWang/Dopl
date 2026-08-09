import { useEffect, useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider, createHashRouter } from "react-router";
import {
  createPersistOptions,
  createQueryClient,
  createQueryPersister,
} from "#/lib/query-client";
import { routes } from "#/routes";
import { getBridge } from "#/lib/dopl-bridge";
// The web app's toast surface — reused feature components (ChatsView,
// SkillsBrowser mutations) fire toast() and need a mounted host.
import { ToastHost } from "@/shared/ui/toast";

/**
 * The provider stack, mounted once by `main.tsx`.
 *
 * HASH ROUTER, not browser router — and this is not a preference. The packaged
 * renderer is loaded with `loadFile`, i.e. a `file://` document, where
 * `history.pushState` to a path the filesystem does not have is a security
 * error in Chromium and a reload lands on a 404. The hash is the one form that
 * works identically under `file://` and under the Vite dev server, so both
 * modes run the same router and a URL copied out of one works in the other.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createHashRouter(routes));
  // The cache's disk half (`#/lib/query-client`). A cold launch hydrates the
  // last dehydrated snapshot and paints it while every restored query
  // refetches behind it, instead of rendering the empty state and waiting.
  const [persister] = useState(createQueryPersister);

  // THE auth subscriber. It lives here, above the router, because main's
  // auth pushes have to reach the user on ANY route — and every other
  // listener in the SPA is mounted by one screen:
  //
  //   • Cache (fleet audit 2026-08-03, high): the query cache outlived the
  //     session, so an account switch replayed the previous user's answers.
  //   • Routing (fleet audit 2026-08-03, high): sign-out from the tray or
  //     the settings modal, and main's forced signed-out after a 401 that
  //     survived a token refresh, changed NOTHING on screen — `useAuthPhase`
  //     is mounted only by BootPage, so a workspace route kept rendering
  //     cached data over a dead session until some query happened to refetch.
  //   • Recovery (medium, "shell-rendered SignedOutScreen is a dead end"):
  //     the shell renders the sign-in screen on a 401 but owns no auth phase,
  //     so a SUCCESSFUL re-sign-in left the form sitting there. Boot is the
  //     one surface that owns the phase, so both directions route to it: it
  //     renders the signed-out screen, and on the next sign-in it re-resolves
  //     the workspace instead of stranding.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || typeof bridge.onAuthState !== "function") return;
    let last: { signedIn: boolean; userId: string | null } | undefined;
    const off = bridge.onAuthState((state) => {
      const userId = state.signedIn ? state.userId : null;
      const prev = last;
      last = { signedIn: state.signedIn, userId };
      // Main re-emits the CURRENT state on every proactive token refresh
      // (~80% of token life, and twice — "refreshing" then "signed-in").
      // Only a CHANGE is an auth event; without this a healthy session would
      // be thrown back to boot every 48 minutes.
      if (prev && prev.signedIn === state.signedIn && prev.userId === userId) {
        return;
      }
      queryClient.clear();
      // …and the DISK copy with it. Clearing only the in-memory cache would
      // leave the previous account's answers on disk for the next launch to
      // hydrate — the same leak the web provider closes on SIGNED_OUT
      // (2026-08-03 fleet audit, high).
      void persister.removeClient();
      void router.navigate("/", { replace: true });
    });
    // Seed the baseline with the session we launched into, so that refresh
    // emission is recognised as the no-op it is. A push that beats this read
    // is a genuine event and rightly wins (the read only seeds when unset).
    if (typeof bridge.getAuthState === "function") {
      void bridge.getAuthState().then(
        (state) => {
          last ??= {
            signedIn: state.signedIn,
            userId: state.signedIn ? state.userId : null,
          };
        },
        () => {
          // A bridge that cannot answer leaves the baseline unset; the next
          // push is then treated as a transition, which is the safe default.
        }
      );
    }
    return off;
  }, [queryClient, persister, router]);

  // Main-initiated navigation: a clicked channel notification / the tray's
  // "Pending" item (journey-audit GAP-16). Main sends a router PATH; in the
  // SPA there is no URL to load, so this is the only way in. Same reason it
  // sits here — the notification can land on any route, or on none.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || typeof bridge.onNavigate !== "function") return;
    const off = bridge.onNavigate(({ path }) => {
      void router.navigate(path);
    });
    return off;
  }, [router]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={createPersistOptions(persister)}
    >
      <RouterProvider router={router} />
      <ToastHost />
    </PersistQueryClientProvider>
  );
}
