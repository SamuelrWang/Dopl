import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import { AppShellLayout, canonicalPath } from "./index";

/**
 * Shell smoke test: rail + sidebar nav render off `/api/workspaces`, the
 * stale-segment rewrite that replaces the web app's 301 (web-pages.md §1.5)
 * actually lands on the canonical URL, and the web layout's guidance + notice
 * layer (journey-audit GAP-3 / GAP-7) is mounted and wired to the SPA router.
 *
 * TWO transports are stubbed because the shell reads over both: the SPA's own
 * `#/lib/api-transport` (`#/hooks/use-api-query` — the workspace resolve +
 * list) and the WEB `apiRequest` via `window.dopl` (every reused feature hook:
 * consent inbox, access matrix, join notices, MCP status). Both funnel into
 * the same bridge in the packaged app.
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
  sendRequest.mockImplementation(({ path }: { path: string }) => {
    if (path.startsWith("/api/workspaces/resolve")) {
      const stale = path.endsWith("segment=acme");
      return Promise.resolve(
        ok({ workspace: WORKSPACE, canonical: "acme-ab12cd", needsRedirect: stale })
      );
    }
    if (path === "/api/workspaces") {
      return Promise.resolve(ok({ workspaces: [{ ...WORKSPACE, role: "owner" }] }));
    }
    return Promise.resolve(ok({}));
  });
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
          // Tour step 1's destination — the shell navigates here on "Walk me
          // through", so the router needs it to exist.
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
    // Nothing in the shell may reach the network directly (`connect-src
    // 'none'` in the packaged renderer).
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("renders the section nav and the workspace rail for the routed workspace", async () => {
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
    // The rail tile is the workspace from `GET /api/workspaces`.
    await waitFor(() =>
      expect(screen.getByTitle("Acme")).toHaveAttribute(
        "href",
        "/acme-ab12cd/knowledge"
      )
    );
    // The brand pill names the open workspace.
    expect(screen.getByRole("button", { name: /Acme/ })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rewrites a stale segment to the canonical one, keeping the page", async () => {
    const router = renderShell("/acme/overview");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/acme-ab12cd/overview")
    );
    // The redirect key-switch once stranded the canonical resolve at
    // pending+idle (fixed by the use-api-query-core self-heal) — this
    // findBy is the regression tripwire.
    expect(await screen.findByText("page body")).toBeInTheDocument();
  });

  it("keeps the deeper path when rewriting the segment", () => {
    expect(canonicalPath("/old-slug/skills/x", "acme-ab12cd")).toBe(
      "/acme-ab12cd/skills/x"
    );
  });

  // GAP-7: the terminal step of the join-approval loop. Without this mount an
  // approved requester is never told they're in.
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

  // GAP-3: first-run guidance. The banner only appears for a caller with no
  // active MCP token; a connected caller must never see it.
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

  // GAP-3: onboarding writes `dopl:welcome` right before redirecting into the
  // workspace; before this mount the SPA wrote the flag and never read it.
  it("shows the welcome popup after onboarding and starts the tour from it", async () => {
    window.localStorage.setItem("dopl:welcome", "1");
    const router = renderShell("/acme-ab12cd/overview");

    expect(await screen.findByText("Welcome to Dopl!")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Walk me through" }));

    // The tour is mounted and listening: step 1 navigates to its section.
    expect(
      await screen.findByRole("dialog", { name: "Product tour" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/acme-ab12cd/ontology")
    );
    // Dismissal clears the flag so it is a one-shot.
    expect(window.localStorage.getItem("dopl:welcome")).toBeNull();
  });

  it("stays silent when onboarding never set the welcome flag", async () => {
    renderShell("/acme-ab12cd/overview");
    expect(await screen.findByText("page body")).toBeInTheDocument();
    expect(screen.queryByText("Welcome to Dopl!")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Product tour" })).toBeNull();
  });
});
