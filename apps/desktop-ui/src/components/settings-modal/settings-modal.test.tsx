import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoney, TEAM_SEAT_PRICE } from "@/features/billing/prices";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { SEGMENT, WORKSPACE_ID, installBridge } from "#/test-utils/bridge";
import { AppShellLayout } from "#/components/app-shell";

/**
 * Settings MODAL driven through the real shell. Pins: gear + switcher open the
 * modal, never navigate to `/settings`.
 *
 * Mocked at `window.dopl.apiRequest` because the modal reads over BOTH clients
 * (SPA transport, reused WEB cores) and both funnel into that one bridge.
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

/** The sidebar's gear. */
const gear = () => screen.getByRole("button", { name: "Settings" });

/**
 * The rail, in order, AS THE DESKTOP DRAWS IT.
 *
 * ⚠ **FIVE ROWS HERE AND FOUR ON THE WEB, and that split is the contract, not a
 * fixture detail.** "Agents" is default agent settings, held in this machine's
 * own store, so `SettingsModalCore` draws it only when a binding passes
 * `agentsPane` — the desktop does, the web passes nothing. Flattening this list
 * to one shared set would pin a row the web is right not to have.
 */
const NAV_LABELS = [
  "Workspaces",
  "Connect",
  "Agents",
  "Account",
  "Plans & Billing",
];

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
    // Overlay, not a route: the page underneath stays put.
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/overview`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens on Workspaces from the workspace switcher", async () => {
    renderShell();
    await screen.findByText("page body");

    // `expanded` pins the query to the switcher pill — the account rail's
    // workspace tile carries the same accessible name but no aria-expanded.
    fireEvent.click(
      await screen.findByRole("button", { name: /Acme/, expanded: false })
    );
    fireEvent.click(await screen.findByText("Workspace settings"));

    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Workspaces" })
    ).toBeInTheDocument();
  });

  /**
   * 🔒 THE RAIL IS ONE FLAT LIST (Samuel, 2026-09-18). The uppercase
   * "WORKSPACE" / "ACCOUNT" group strips are DELETED and the four rows are
   * siblings — this is what pins the indent from coming back, and the rows are
   * asserted IN ORDER because the list is the shape, not a set.
   */
  it("shows the flat nav rows in order, and no group headers", async () => {
    renderShell();
    await screen.findByText("page body");
    fireEvent.click(gear());

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const rail = within(dialog).getAllByRole("button");
    expect(
      rail.map((b) => b.textContent).filter((t) => NAV_LABELS.includes(t ?? ""))
    ).toEqual(NAV_LABELS);
    expect(within(dialog).queryByText("WORKSPACE")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("ACCOUNT")).not.toBeInTheDocument();
  });

  /**
   * 🔒 THE WORKSPACES PANE LISTS THE HOME SPACE FIRST, then every workspace the
   * account is in. It EDITS none of them — the rename form lives on
   * `/{segment}/settings` since this overhaul, and its own suite covers it.
   */
  it("lists the home space and every workspace, editing none", async () => {
    renderShell();
    await screen.findByText("page body");
    fireEvent.click(gear());
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));

    // ⚠ Scoped to the DIALOG: the shell's own switcher pill names "Acme" too,
    // and an unscoped query would pass on the chrome behind the overlay.
    expect(await within(dialog).findByText("Home")).toBeInTheDocument();
    expect(await within(dialog).findByText("Acme")).toBeInTheDocument();
    // The General form is gone from this popup, so its field is too.
    expect(screen.queryByDisplayValue("Acme")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  /** Connect carries the MCP block and the account's grants — both MOVED here
   *  from the workspace settings page in the same change. */
  it("revokes a connected app from the Connect tab", async () => {
    apiRequest.mockImplementation((path: string) =>
      path === "/api/oauth/grants"
        ? Promise.resolve(
            ok({
              grants: [
                {
                  id: "grant-1",
                  client_name: "Claude Code",
                  scopes: ["dopl.write"],
                  last_used_at: null,
                  created_at: "2026-07-01T00:00:00Z",
                },
              ],
            })
          )
        : defaultBridge(path)
    );
    renderShell();
    await screen.findByText("page body");
    fireEvent.click(gear());
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Connect & log in")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) => c.path === "/api/oauth/grants/grant-1" && c.opts.method === "DELETE"
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

    expect(await screen.findByText("Starter plan")).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
    expect(screen.getByText("Ontology objects")).toBeInTheDocument();
    expect(screen.getByText("40 / 100")).toBeInTheDocument();

    // ⚠ TWO CARDS SINCE 2026-09-07, AND THE DESKTOP RENDERS THE SAME ONES —
    // the pane is `PlansBillingCore` over `plans.ts › plansForKind`, so this asserts
    // the shared list reached the packaged renderer intact, not a second copy
    // of it. Scoped to the dialog: the sidebar behind it carries plan words too.
    const pane = within(screen.getByRole("dialog", { name: "Settings" }));
    for (const name of ["Starter", "Team"]) {
      expect(pane.getByText(name)).toBeInTheDocument();
    }
    // Pro is retired from sale: no card, no flat price, no "solo only" CTA.
    expect(screen.queryByText("$5.99")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Single-member workspaces only")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Full chat history for everyone")).toBeInTheDocument();
    expect(
      screen.getByText("Seats sync automatically as members join or leave")
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an upgrade click to the web billing surface, not to Stripe", async () => {
    await openBilling();

    fireEvent.click(
      // ⚠ Built from `billing/prices.ts`, never a literal: the seat price is
      // one constant now and a suite that re-pins it goes red on a retune.
      await screen.findByRole("button", {
        name: `Upgrade — ${formatMoney(TEAM_SEAT_PRICE)}/seat`,
      })
    );

    // Standalone billing page, plan included (`lib/open-in-browser.ts`).
    expect(openExternal).toHaveBeenCalledWith(
      `https://www.usedopl.com/billing/${SEGMENT}?billing=upgrade&plan=team`
    );
    // No checkout inside the app — CSP refuses Stripe outright.
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
    // Portal URL fetched over the bridge, never navigated to here.
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
    // ⚠ This string is minted inside a shipped desktop build — a wrong one
    // cannot be fixed by a deploy.
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
