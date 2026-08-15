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
// Reused feature components (ChatsView, SkillsBrowser mutations) fire toast()
// and need a mounted host.
import { ToastHost } from "@/shared/ui/toast";

/**
 * The provider stack, mounted once by `main.tsx`.
 *
 * ⚠ HASH ROUTER, not browser router. The packaged renderer is a `file://`
 * document (`loadFile`), where `history.pushState` to a path the filesystem
 * lacks is a Chromium security error and a reload 404s. The hash works
 * identically under `file://` and the Vite dev server, so both modes run one
 * router and a URL copied out of one works in the other.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createHashRouter(routes));
  // Cache's disk half (`#/lib/query-client`): a cold launch hydrates the last
  // snapshot and paints it while restored queries refetch behind it.
  const [persister] = useState(createQueryPersister);

  // ⚠ THE auth subscriber, and it must stay ABOVE the router: main's auth
  // pushes have to reach the user on ANY route, and every other auth listener
  // in the SPA is mounted by a single screen. Three failures it closes:
  //   • Cache: the query cache outlived the session, so an account switch
  //     replayed the previous user's answers.
  //   • Routing: sign-out from the tray/settings modal, and main's forced
  //     signed-out after a 401 that survived a refresh, changed NOTHING on
  //     screen — `useAuthPhase` is mounted only by BootPage, so a workspace
  //     route kept rendering cached data over a dead session.
  //   • Recovery: the shell renders the sign-in screen on a 401 but owns no
  //     auth phase, so a SUCCESSFUL re-sign-in left the form sitting there.
  //     Boot owns the phase, so both directions route to it.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || typeof bridge.onAuthState !== "function") return;
    let last: { signedIn: boolean; userId: string | null } | undefined;
    const off = bridge.onAuthState((state) => {
      const userId = state.signedIn ? state.userId : null;
      const prev = last;
      last = { signedIn: state.signedIn, userId };
      // ⚠ Main re-emits the CURRENT state on every proactive token refresh
      // (~80% of token life, and twice: "refreshing" then "signed-in"). Only a
      // CHANGE is an auth event — without this a healthy session is thrown
      // back to boot every 48 minutes.
      if (prev && prev.signedIn === state.signedIn && prev.userId === userId) {
        return;
      }
      queryClient.clear();
      // ⚠ …and the DISK copy with it. Clearing only the in-memory cache leaves
      // the previous account's answers on disk for the next launch to hydrate.
      void persister.removeClient();
      void router.navigate("/", { replace: true });
    });
    // Seed the baseline with the session we launched into so the refresh
    // emission reads as the no-op it is. A push that beats this read is a
    // genuine event and wins (the read only seeds when unset).
    if (typeof bridge.getAuthState === "function") {
      void bridge.getAuthState().then(
        (state) => {
          last ??= {
            signedIn: state.signedIn,
            userId: state.signedIn ? state.userId : null,
          };
        },
        () => {
          // Baseline stays unset; the next push is then treated as a
          // transition, which is the safe default.
        }
      );
    }
    return off;
  }, [queryClient, persister, router]);

  // Main-initiated navigation (channel notification, tray "Pending"). Main
  // sends a router PATH; there is no URL to load in the SPA, so this is the
  // only way in, and it sits here because it can land on any route or none.
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
