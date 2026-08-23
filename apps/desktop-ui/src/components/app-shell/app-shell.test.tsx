import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import { AppShellLayout, canonicalPath } from "./index";

/**
 * Shell smoke test: sidebar nav renders off `/api/workspaces`, the
 * stale-segment rewrite lands on the canonical URL, and the guidance + notice
 * layer is mounted and wired to the SPA router.
 *
 * ⚠ TWO transports stubbed because the shell reads over both: `#/lib/api-
 * transport` and the WEB `apiRequest` via `window.dopl`. Both funnel into the
 * same bridge in the packaged app.
 */

const { sendRequest } = vi.hoisted(() => ({ sendRequest: vi.fn() }));
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

const bridgeRequest = vi.hoisted(() => vi.fn());

const WORKSPACE = {
  id: "ws-1",
  ownerId: "user-1",
  name: "Acme",
  slug: "acme",
  publicId: "ab12cd",
  description: null,
  iconUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function mockApi() {
  sendRequest.mockImplementation(
    ({ path, body }: { path: string; body?: unknown }) => {
      // ONE read for the shell: segment resolve + role + id + access matrix.
      if (path === "/api/boot") {
        const segment = (body as { segment?: string } | undefined)?.segment;
        return Promise.resolve(
          ok({
            isOnboarded: true,
            surveyCompleted: true,
            userId: "user-1",
            workspace: WORKSPACE,
            segment: "acme-ab12cd",
            needsRedirect: segment === "acme",
            role: "owner",
            myAccess: { defaultLevel: "edit", overrides: [] },
          })
        );
      }
      if (path === "/api/workspaces") {
        return Promise.resolve(ok({ workspaces: [{ ...WORKSPACE, role: "owner" }] }));
      }
      return Promise.resolve(ok({}));
    }
  );
}

/** Web-side reads. Overridden per test for the notice/banner cases. */
let joinNotices: unknown[] = [];
let mcpConnected = true;

function mockBridge() {
  bridgeRequest.mockImplementation((path: string) => {
    if (path === "/api/me/join-requests") {
      return Promise.resolve(ok({ notices: joinNotices }));
    }
    if (path.startsWith("/api/me/join-requests/")) return Promise.resolve(ok({}));
    if (path === "/api/onboarding/mcp-status") {
      return Promise.resolve(ok({ connected: mcpConnected }));
    }
    if (path === "/api/channels/consent") return Promise.resolve(ok({ requests: [] }));
    if (path.endsWith("/my-access")) {
      return Promise.resolve(ok({ defaultLevel: "edit", overrides: [] }));
    }
    return Promise.reject(new Error(`unexpected bridge request: ${path}`));
  });
  Object.defineProperty(window, "dopl", {
    configurable: true,
    writable: true,
    value: { apiRequest: bridgeRequest },
  });
}

function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/:workspaceSegment",
        element: <AppShellLayout />,
        children: [
          { path: "overview", element: <p>page body</p> },
          // Tour step 1's destination; the router needs it to exist.
          { path: "ontology", element: <p>ontology body</p> },
        ],
      },
    ],
    { initialEntries: [path] }
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe("app shell", () => {
  beforeEach(() => {
    joinNotices = [];
    mcpConnected = true;
    window.localStorage.clear();
    mockApi();
    mockBridge();
    // Nothing may reach the network directly (`connect-src 'none'`).
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("renders the section nav and the workspace switcher for the routed workspace", async () => {
    renderShell("/acme-ab12cd/overview");

    expect(await screen.findByText("page body")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute(
      "href",
      "/acme-ab12cd/knowledge"
    );
    expect(screen.getByRole("link", { name: "Channels" })).toHaveAttribute(
      "href",
      "/acme-ab12cd/channels"
    );
    // Brand pill names the open workspace; switching lives in its popover.
    // `expanded` pins the query to the popup trigger — the account rail's
    // workspace tile carries the same accessible name but no aria-expanded.
    expect(
      screen.getByRole("button", { name: /Acme/, expanded: false })
    ).toBeInTheDocument();
    // The account rail: Home pinned above this account's workspace tiles.
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  // ⚠ `GET /api/workspaces` is UNFILTERED and now answers with the account
  // surface's `kind='link'` CONTAINERS — one per relationship, and the caller is
  // a member of every one. A rail that showed them would list plumbing.
  it("keeps link containers out of the rail and the switcher", async () => {
    const inner = sendRequest.getMockImplementation()!;
    sendRequest.mockImplementation((req: { path: string; body?: unknown }) =>
      req.path === "/api/workspaces"
        ? Promise.resolve(
            ok({
              workspaces: [
                { ...WORKSPACE, role: "owner" },
                {
                  ...WORKSPACE,
                  id: "ws-link-1",
                  name: "Priya Shah",
                  slug: "link-priya",
                  publicId: "aa11bb",
                  kind: "link",
                  role: "member",
                },
              ],
            })
          )
        : inner(req)
    );

    renderShell("/acme-ab12cd/overview");

    await screen.findByText("page body");
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Priya Shah" })
    ).not.toBeInTheDocument();
  });

  it("rewrites a stale segment to the canonical one, keeping the page", async () => {
    const router = renderShell("/acme/overview");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/acme-ab12cd/overview")
    );
    // ⚠ Regression tripwire: the redirect key-switch once stranded the
    // canonical resolve at pending+idle.
    expect(await screen.findByText("page body")).toBeInTheDocument();
  });

  it("keeps the deeper path when rewriting the segment", () => {
    expect(canonicalPath("/old-slug/skills/x", "acme-ab12cd")).toBe(
      "/acme-ab12cd/skills/x"
    );
  });

  // Terminal step of the join-approval loop: without this mount an approved
  // requester is never told they're in.
  it("shows an approved join notice, acks it over the bridge and routes in", async () => {
    joinNotices = [
      {
        id: "jr-1",
        workspaceName: "Globex",
        workspaceSlug: "globex",
        workspacePublicId: "zz99",
        status: "approved",
        kind: "resolved",
      },
    ];
    const router = renderShell("/acme-ab12cd/overview");

    fireEvent.click(await screen.findByRole("button", { name: "Go to workspace" }));

    await waitFor(() =>
      expect(bridgeRequest).toHaveBeenCalledWith(
        "/api/me/join-requests/jr-1/ack",
        expect.objectContaining({ method: "POST", body: { kind: "resolved" } })
      )
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/globex-zz99")
    );
  });

  it("renders no join notice when the queue is empty", async () => {
    renderShell("/acme-ab12cd/overview");
    expect(await screen.findByText("page body")).toBeInTheDocument();
    await waitFor(() =>
      expect(bridgeRequest).toHaveBeenCalledWith(
        "/api/me/join-requests",
        expect.anything()
      )
    );
    expect(screen.queryByRole("button", { name: "Go to workspace" })).toBeNull();
  });

  // Banner appears only for a caller with NO active MCP token.
  it("nudges an unconnected caller to connect their agent", async () => {
    mcpConnected = false;
    renderShell("/acme-ab12cd/overview");

    expect(
      await screen.findByText("Connect your AI agent to build out your workspace")
    ).toBeInTheDocument();
  });

  it("hides the connect-agent nudge once the caller has an agent connected", async () => {
    renderShell("/acme-ab12cd/overview");
    expect(await screen.findByText("page body")).toBeInTheDocument();
    await waitFor(() =>
      expect(bridgeRequest).toHaveBeenCalledWith(
        "/api/onboarding/mcp-status",
        expect.anything()
      )
    );
    expect(
      screen.queryByText("Connect your AI agent to build out your workspace")
    ).toBeNull();
  });

  // Onboarding writes `dopl:welcome` right before redirecting in.
  it("shows the welcome popup after onboarding and starts the tour from it", async () => {
    window.localStorage.setItem("dopl:welcome", "1");
    const router = renderShell("/acme-ab12cd/overview");

    expect(await screen.findByText("Welcome to Dopl!")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Walk me through" }));

    // Tour mounted and listening: step 1 navigates to its section.
    expect(
      await screen.findByRole("dialog", { name: "Product tour" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/acme-ab12cd/ontology")
    );
    // Dismissal clears the flag: one-shot.
    expect(window.localStorage.getItem("dopl:welcome")).toBeNull();
  });

  it("stays silent when onboarding never set the welcome flag", async () => {
    renderShell("/acme-ab12cd/overview");
    expect(await screen.findByText("page body")).toBeInTheDocument();
    expect(screen.queryByText("Welcome to Dopl!")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Product tour" })).toBeNull();
  });
});
