import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { SEGMENT, WORKSPACE_ID, installBridge } from "#/test-utils/bridge";
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

/** Free workspace by default, so every upgrade CTA is on screen. */
const BILLING_STATUS = {
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

const PAID_STATUS = {
  ...BILLING_STATUS,
  plan: "team",
  status: "active",
  seatCount: 3,
  objectCap: null,
  chatsWindowDays: null,
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
    installBridge({ apiRequest, openExternal, appOrigin: "https://www.usedopl.com" });
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

  /** Open the modal on Plans & Billing. */
  async function openBilling() {
    renderShell();
    await screen.findByText("page body");
    fireEvent.click(gear());
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Plans & Billing" }));
  }

  it("renders the whole billing pane — status, plan cards, feature lists", async () => {
    await openBilling();

    // Current state summary.
    expect(await screen.findByText("Starter plan")).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
    expect(screen.getByText("Ontology objects")).toBeInTheDocument();
    expect(screen.getByText("40 / 100")).toBeInTheDocument();

    // All three plan cards, with prices and feature lists. Scoped to the
    // dialog: the sidebar behind it also advertises "Pro".
    const pane = within(screen.getByRole("dialog", { name: "Settings" }));
    for (const name of ["Starter", "Pro", "Team"]) {
      expect(pane.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText("$5.99")).toBeInTheDocument();
    expect(screen.getByText("$7.99")).toBeInTheDocument();
    expect(screen.getByText("Full chat history")).toBeInTheDocument();
    expect(
      screen.getByText("Seats sync automatically as members join or leave")
    ).toBeInTheDocument();
    // 3 members → Solo is not sellable, exactly as on the web.
    expect(screen.getByText("Single-member workspaces only")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an upgrade click to the web billing surface, not to Stripe", async () => {
    await openBilling();

    fireEvent.click(await screen.findByRole("button", { name: "Upgrade — $7.99/seat" }));

    // The standalone billing page, plan included — see `lib/open-in-browser.ts`.
    expect(openExternal).toHaveBeenCalledWith(
      `https://www.usedopl.com/billing/${SEGMENT}?billing=upgrade&plan=team`
    );
    // No checkout mounted inside the app — the CSP refuses Stripe outright.
    expect(screen.queryByText("Subscribe to Team")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens the Stripe-hosted portal externally for a paid workspace", async () => {
    apiRequest.mockImplementation((path: string, opts?: BridgeRequestOpts) => {
      if (path === "/api/billing/status") return Promise.resolve(ok(PAID_STATUS));
      if (path === "/api/billing/portal" && opts?.method === "POST") {
        return Promise.resolve(ok({ url: "https://billing.stripe.com/p/session_123" }));
      }
      return defaultBridge(path);
    });
    await openBilling();

    expect(await screen.findByText("Team plan")).toBeInTheDocument();
    expect(screen.getByText("Current plan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));

    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith(
        "https://billing.stripe.com/p/session_123"
      )
    );
    // The portal URL was fetched over the bridge, never navigated to here.
    expect(window.location.href).not.toContain("stripe.com");
    expect(fetch).not.toHaveBeenCalled();
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

  it("sends deletion to the standalone billing/account page, not the retiring canvas", async () => {
    // The web page that carries the account danger zone after the website
    // retirement (plan decision D4). This string is minted inside a shipped
    // desktop build, so a wrong one cannot be fixed by a deploy.
    renderShell();
    await screen.findByText("page body");

    fireEvent.click(gear());
    await screen.findByRole("heading", { name: "Account" });
    fireEvent.click(
      screen.getByRole("button", { name: /Delete account in browser/ })
    );

    expect(openExternal).toHaveBeenCalledWith(
      `https://www.usedopl.com/billing/${SEGMENT}`
    );
  });

  it("signs out through the bridge when the op exists", async () => {
    const signOut = vi.fn(() => Promise.resolve({ ok: true }));
    installBridge({ apiRequest, openExternal, signOut, appOrigin: "https://www.usedopl.com" });
    renderShell();
    await screen.findByText("page body");

    fireEvent.click(gear());
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
