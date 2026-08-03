import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { AppShellLayout } from "#/components/app-shell";

/**
 * Smoke test for the restored settings MODAL, driven through the real shell —
 * the regression it fixes was the shell navigating to `/settings` instead of
 * opening the modal, so both entry points (the sidebar's gear and the
 * switcher's "Workspace settings") are exercised where they actually live.
 *
 * Mocked at `window.dopl.apiRequest`, the Electron bridge: the modal reads over
 * BOTH clients (the SPA transport for `/api/workspaces/me`, the WEB
 * `apiRequest` for every reused core), and both funnel into that one bridge in
 * the packaged app. `fetch` is a never-resolving tripwire — nothing in this
 * tree may reach the network (`connect-src 'none'`).
 */

const apiRequest = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));

const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";
const SEGMENT = "acme-ab12cd";

const WORKSPACE = {
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

const BILLING_STATUS = {
  plan: "team",
  status: "active",
  memberCount: 3,
  seatCount: 3,
  objectCap: null,
  objectsUsed: 0,
  canCreateObjects: true,
  chatsWindowDays: null,
  subscription_period_end: null,
  has_stripe_customer: true,
};

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/** Routes every path the shell + modal read; anything else fails loudly. */
function defaultBridge(path: string): Promise<BridgeResponse> {
  if (path.startsWith("/api/workspaces/resolve")) {
    return Promise.resolve(
      ok({ workspace: WORKSPACE, canonical: SEGMENT, needsRedirect: false })
    );
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
    return Promise.resolve(
      ok({ display_name: "Ada", avatar_url: null, email: "ada@acme.test" })
    );
  }
  if (path === "/api/oauth/grants") return Promise.resolve(ok({ grants: [] }));
  if (path === `/api/workspaces/${SEGMENT}/my-access`) {
    return Promise.resolve(ok({ defaultLevel: "edit", overrides: [] }));
  }
  if (path.startsWith(`/api/workspaces/${SEGMENT}/`)) {
    // Members pane fan-out: roster, invitations, teams, access matrix…
    return Promise.resolve(
      ok({ members: [], invitations: [], teams: [], resources: [], requests: [] })
    );
  }
  if (path.startsWith("/api/channels/consent")) {
    return Promise.resolve(ok({ requests: [] }));
  }
  return Promise.resolve(ok({}));
}

const calls = () =>
  apiRequest.mock.calls.map((args) => ({
    path: (args as unknown[])[0] as string,
    opts: ((args as unknown[])[1] ?? {}) as BridgeRequestOpts,
  }));

function renderShell() {
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

/** The sidebar's gear — the entry point the port had turned into a navigate. */
const gear = () => screen.getByRole("button", { name: "Settings" });

describe("settings modal", () => {
  beforeEach(() => {
    apiRequest.mockImplementation((path: string) => defaultBridge(path));
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest, openExternal, appOrigin: "https://www.usedopl.com" },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("opens on Account from the sidebar gear, leaving the page mounted", async () => {
    const router = renderShell();
    await screen.findByText("page body");

    fireEvent.click(gear());

    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Account" })
    ).toBeInTheDocument();
    // The modal is an overlay, not a route: the page underneath stays put.
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/overview`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens on General from the workspace switcher", async () => {
    renderShell();
    await screen.findByText("page body");

    fireEvent.click(await screen.findByRole("button", { name: /Acme/ }));
    fireEvent.click(await screen.findByText("Workspace settings"));

    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Acme")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
  });

  it("renames the workspace with a PATCH over the bridge", async () => {
    renderShell();
    await screen.findByText("page body");

    fireEvent.click(gear());
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "General" }));

    const input = await screen.findByDisplayValue("Acme");
    fireEvent.change(input, { target: { value: "Acme Rebranded" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) => c.path === `/api/workspaces/${SEGMENT}` && c.opts.method === "PATCH"
        )
      ).toBe(true)
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders billing read-only and hands the plan change to the browser", async () => {
    renderShell();
    await screen.findByText("page body");

    fireEvent.click(gear());
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Plans & Billing" }));

    expect(await screen.findByText("Team plan")).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
    // No checkout inside the app — the CSP refuses Stripe outright.
    expect(screen.queryByText(/Upgrade —/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Manage billing in browser/ }));
    expect(openExternal).toHaveBeenCalledWith(
      `https://www.usedopl.com/${SEGMENT}/canvas?billing=upgrade`
    );
  });

  it("hides sign-out when main has no signOut op", async () => {
    renderShell();
    await screen.findByText("page body");

    fireEvent.click(gear());
    await screen.findByRole("heading", { name: "Account" });

    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete account in browser/ })
    ).toBeInTheDocument();
  });

  it("signs out through the bridge when the op exists", async () => {
    const signOut = vi.fn(() => Promise.resolve({ ok: true }));
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest, openExternal, signOut, appOrigin: "https://www.usedopl.com" },
    });
    renderShell();
    await screen.findByText("page body");

    fireEvent.click(gear());
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
