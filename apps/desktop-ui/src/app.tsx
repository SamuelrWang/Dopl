import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createHashRouter } from "react-router";
import { createQueryClient } from "@/lib/query-client";
import { routes } from "@/routes";

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

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
