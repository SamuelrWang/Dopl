import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import { AppShellLayout, canonicalPath } from "./index";

/**
 * Shell smoke test: rail + sidebar nav render off `/api/workspaces`, and the
 * stale-segment rewrite that replaces the web app's 301 (web-pages.md §1.5)
 * actually lands on the canonical URL.
 */

const { sendRequest } = vi.hoisted(() => ({ sendRequest: vi.fn() }));
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

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

function ok(body: unknown) {
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

function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/:workspaceSegment",
        element: <AppShellLayout />,
        children: [{ path: "overview", element: <p>page body</p> }],
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
  beforeEach(mockApi);

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
  });

  it("rewrites a stale segment to the canonical one, keeping the page", async () => {
    const router = renderShell("/acme/overview");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/acme-ab12cd/overview")
    );
    expect(await screen.findByText("page body")).toBeInTheDocument();
  });

  it("keeps the deeper path when rewriting the segment", () => {
    expect(canonicalPath("/old-slug/skills/x", "acme-ab12cd")).toBe(
      "/acme-ab12cd/skills/x"
    );
  });
});
