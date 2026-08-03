import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createHashRouter } from "react-router";
import { createQueryClient } from "#/lib/query-client";
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

  // Fleet audit 2026-08-03 (high): the query cache outlived the session —
  // an account switch replayed the previous user's cached answers. ANY auth
  // transition (signed-out, or a different user signing in) wipes the cache;
  // the next screens refetch under the new credential.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || typeof bridge.onAuthState !== "function") return;
    let lastUserId: string | null | undefined;
    const off = bridge.onAuthState((state) => {
      const userId = state.signedIn ? state.userId : null;
      if (lastUserId !== undefined && userId !== lastUserId) {
        queryClient.clear();
      }
      lastUserId = userId;
    });
    return off;
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ToastHost />
    </QueryClientProvider>
  );
}
