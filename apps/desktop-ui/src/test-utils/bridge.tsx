import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import type { RouteObject } from "react-router";
import { vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";

/**
 * THE bridge stub, canonical workspace fixtures, and render harness for this
 * renderer's tests. One module, one set of fixtures — do not re-declare the
 * resolve/me wire shapes per suite.
 *
 * ⚠ Stub at `window.dopl.apiRequest`, NOT at `#/lib/api-transport`:
 * workspace-scoped pages read over BOTH clients (the SPA's `apiRequest` and
 * reused WEB feature clients), and both funnel into this one bridge in the
 * packaged app. Stubbing here exercises the real topology once.
 */

export const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";
export const SEGMENT = "acme-ab12cd";
export const USER_ID = "user-1";

export const WORKSPACE = {
  id: WORKSPACE_ID,
  ownerId: USER_ID,
  name: "Acme",
  slug: "acme",
  publicId: "ab12cd",
  description: "The workspace",
  iconUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

export function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

export function noContent(): BridgeResponse {
  return { status: 204, statusText: "No Content", hasBody: false };
}

export function failure(status: number, code: string, message: string): BridgeResponse {
  return { status, statusText: message, hasBody: true, body: { error: { code, message } } };
}

/** `POST /api/boot` — the shell's and every page's ONE first read. Carries
 *  what `resolve`, `me` and `my-access` answer separately. */
export function bootBody(over: Record<string, unknown> = {}) {
  return {
    isOnboarded: true,
    surveyCompleted: true,
    userId: USER_ID,
    workspace: WORKSPACE,
    segment: SEGMENT,
    needsRedirect: false,
    role: "owner",
    myAccess: { defaultLevel: "edit", overrides: [] },
    ...over,
  };
}

/** `GET /api/workspaces/resolve?segment=` — live for the web app and the chats
 *  page; the SPA seeds this from the boot answer instead of fetching. */
export function resolveBody(over: Record<string, unknown> = {}) {
  return { workspace: WORKSPACE, canonical: SEGMENT, needsRedirect: false, ...over };
}

/** `GET /api/workspaces/me` — role + caller id for the resolved workspace. */
export function meBody(over: Record<string, unknown> = {}) {
  return { role: "owner", userId: USER_ID, ...over };
}

/** `GET /api/user/profile` — the caller's OWN row, bare (no envelope), as
 *  `src/app/api/user/profile/route.ts` answers it. Account-level, like
 *  `bootBody`: any surface that paints the operator's face reads it. */
export function profileBody(over: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    display_name: "Sam Operator",
    avatar_url: null,
    email: "sam@example.com",
    ...over,
  };
}

/**
 * The ACCOUNT-level reads — identity, and the caller's own profile row. Returns
 * `null` for anything else so a suite chains its own table after it, the same
 * shape `workspaceRoutes` has.
 *
 * ⚠ These are NOT workspace-scoped and that is why they are their own table:
 * /home has no workspace and opens with both of them.
 */
export function accountRoutes(path: string): Promise<BridgeResponse> | null {
  if (path === "/api/boot") return Promise.resolve(ok(bootBody()));
  if (path === "/api/user/profile") return Promise.resolve(ok(profileBody()));
  return null;
}

/**
 * The reads every workspace-scoped page opens with. Returns `null` for any
 * other path so a suite can chain its own table:
 *
 *     workspaceRoutes(path) ?? myPageRoutes(path)
 *
 * `resolve` and `me` stay in the table though the shell no longer calls them —
 * a suite rendering a page in isolation (or the components still reading them
 * directly) must still be answerable.
 */
export function workspaceRoutes(path: string): Promise<BridgeResponse> | null {
  if (path === "/api/boot") return Promise.resolve(ok(bootBody()));
  if (path.startsWith("/api/workspaces/resolve")) {
    return Promise.resolve(ok(resolveBody()));
  }
  if (path === "/api/workspaces/me") return Promise.resolve(ok(meBody()));
  if (path.endsWith("/my-access")) {
    return Promise.resolve(ok({ defaultLevel: "edit", overrides: [] }));
  }
  return null;
}

/**
 * Install `window.dopl` and arm the `fetch` tripwire.
 *
 * ⚠ `fetch` is a NEVER-RESOLVING spy on purpose: nothing in this renderer may
 * reach the network directly (`connect-src 'none'` in the packaged page), so a
 * suite asserts `expect(fetch).not.toHaveBeenCalled()` and a regression hangs
 * rather than silently succeeding.
 */
export function installBridge(surface: Record<string, unknown>): void {
  Object.defineProperty(window, "dopl", {
    configurable: true,
    writable: true,
    value: surface,
  });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<never>(() => {})));
}

/** The `(path, opts)` pairs a bridge mock was called with. */
export function bridgeCalls(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls.map((args) => ({
    path: args[0] as string,
    opts: (args[1] ?? {}) as BridgeRequestOpts,
  }));
}

/** Render `routes` under the app's query client and a memory router. */
export function renderWithProviders(
  routes: RouteObject[],
  initialEntries: string[]
) {
  const router = createMemoryRouter(routes, { initialEntries });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { router, view };
}
