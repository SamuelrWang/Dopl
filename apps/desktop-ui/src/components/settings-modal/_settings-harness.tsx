import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { SEGMENT, WORKSPACE_ID } from "#/test-utils/bridge";
import { AppShellLayout } from "#/components/app-shell";

/**
 * THE SETTINGS-MODAL TEST HARNESS, shared by `settings-modal.test.tsx` and
 * `settings-modal-notifications.test.tsx`.
 *
 * ⚠ SPLIT OUT, NOT A RAISED CAP (2026-10-09). The modal's suite hit the 500-line `max-lines`
 * cap when the Notifications pane got its own cases. The cap is the point — so the harness moved
 * here and the panes own their own files, rather than one file growing an exemption.
 *
 * Mocked at `window.dopl.apiRequest` because the modal reads over BOTH clients (SPA transport,
 * reused WEB cores) and both funnel into that one bridge. ⚠ Each test FILE gets its own module
 * instance, so these mocks are not shared across files.
 */

export const apiRequest = vi.fn();
export const openExternal = vi.fn(() => Promise.resolve({ ok: true }));

export const WORKSPACE = {
  id: WORKSPACE_ID,
  ownerId: "user-1",
  name: "Acme",
  slug: "acme",
  publicId: "ab12cd",
  description: "The workspace",
  iconUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** Free workspace by default, so every upgrade CTA is on screen. */
export const BILLING_STATUS = {
  plan: "free",
  status: "free",
  memberCount: 3,
  seatCount: null,
  objectCap: 100,
  objectsUsed: 40,
  canCreateObjects: true,
  chatsWindowDays: 90,
  subscription_period_end: null,
  has_stripe_customer: false,
};

export const PAID_STATUS = {
  ...BILLING_STATUS,
  plan: "team",
  status: "active",
  seatCount: 3,
  objectCap: null,
  chatsWindowDays: null,
  has_stripe_customer: true,
};

export function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/** Routes every path the shell + modal read; anything else answers an empty body. */
export function defaultBridge(path: string): Promise<BridgeResponse> {
  // Shell's single boot read. `me` stays below: the modal reads it directly.
  if (path === "/api/boot") {
    return Promise.resolve(
      ok({
        isOnboarded: true,
        surveyCompleted: true,
        userId: "user-1",
        workspace: WORKSPACE,
        segment: SEGMENT,
        needsRedirect: false,
        role: "owner",
        myAccess: { defaultLevel: "edit", overrides: [] },
      })
    );
  }
  if (path.startsWith("/api/workspaces/resolve")) {
    return Promise.resolve(ok({ workspace: WORKSPACE, canonical: SEGMENT, needsRedirect: false }));
  }
  if (path === "/api/workspaces") {
    return Promise.resolve(ok({ workspaces: [{ ...WORKSPACE, role: "owner" }] }));
  }
  if (path === "/api/workspaces/me") {
    return Promise.resolve(ok({ role: "owner", userId: "user-1" }));
  }
  if (path === `/api/workspaces/${SEGMENT}`) {
    return Promise.resolve(ok({ workspace: WORKSPACE, role: "owner" }));
  }
  if (path === "/api/billing/status") return Promise.resolve(ok(BILLING_STATUS));
  if (path === "/api/user/profile") {
    return Promise.resolve(ok({ display_name: "Ada", avatar_url: null, email: "ada@acme.test" }));
  }
  if (path === "/api/oauth/apps") return Promise.resolve(ok({ apps: [] }));
  if (path === "/api/devices") return Promise.resolve(ok({ devices: [] }));
  if (path === "/api/glasses/devices") return Promise.resolve(ok({ devices: [] }));
  if (path === `/api/workspaces/${SEGMENT}/my-access`) {
    return Promise.resolve(ok({ defaultLevel: "edit", overrides: [] }));
  }
  if (path.startsWith(`/api/workspaces/${SEGMENT}/`)) {
    return Promise.resolve(
      ok({ members: [], invitations: [], teams: [], resources: [], requests: [] })
    );
  }
  if (path.startsWith("/api/channels/consent")) {
    return Promise.resolve(ok({ requests: [] }));
  }
  return Promise.resolve(ok({}));
}

export const calls = () =>
  apiRequest.mock.calls.map((args) => ({
    path: (args as unknown[])[0] as string,
    opts: ((args as unknown[])[1] ?? {}) as BridgeRequestOpts,
  }));

export function renderShell() {
  const router = createMemoryRouter(
    [
      {
        path: "/:workspaceSegment",
        element: <AppShellLayout />,
        children: [{ path: "overview", element: <p>page body</p> }],
      },
    ],
    { initialEntries: [`/${SEGMENT}/overview`] }
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

/** The sidebar's gear. */
export const gear = () => screen.getByRole("button", { name: "Settings" });
