import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import { WORKSPACE_PAGES, routes } from "#/routes";

// The layout is now the real AppShellLayout, which fetches the workspace
// list + segment resolution on mount — same transport mock as its own test.
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
const ok = (body: unknown) => ({ status: 200, statusText: "OK", hasBody: true, body });

beforeEach(() => {
  sendRequest.mockImplementation(({ path }: { path: string }) => {
    if (path.startsWith("/api/workspaces/resolve")) {
      return Promise.resolve(
        ok({ workspace: WORKSPACE, canonical: "acme-ab12cd", needsRedirect: false })
      );
    }
    if (path === "/api/workspaces") {
      return Promise.resolve(ok({ workspaces: [{ ...WORKSPACE, role: "owner" }] }));
    }
    return Promise.resolve(ok({}));
  });
});

/**
 * The scaffold's smoke test: the REAL route table renders under the REAL
 * provider stack. A memory router stands in for the hash router only so the
 * initial URL can be set; every route object is the shipped one.
 */
function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("app routes", () => {
  it("renders a workspace page inside the app layout", async () => {
    renderAt("/acme-ab12cd/channels");

    expect(await screen.findByRole("heading", { name: "Channels" })).toBeInTheDocument();
    // The layout's nav is driven by the same table the routes are.
    expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute(
      "href",
      "/acme-ab12cd/knowledge"
    );
  });

  it("redirects the workspace root to the home page", async () => {
    renderAt("/acme-ab12cd");

    expect(await screen.findByRole("heading", { name: "Canvas" })).toBeInTheDocument();
  });

  it("resolves a detail route with its param", () => {
    // Every detail route is a real page now — its rendering is covered by
    // the page's own suite. What THIS table owes is the match: the param
    // row wins over the index row and delivers its param.
    const router = createMemoryRouter(routes, {
      initialEntries: ["/acme-ab12cd/knowledge/some-base-9f2a"],
    });
    const match = router.state.matches.at(-1);
    expect(match?.route.path).toBe("knowledge/:kbSlug");
    expect(match?.params.kbSlug).toBe("some-base-9f2a");
  });

  it("mirrors the web app's page list", () => {
    expect(WORKSPACE_PAGES.map((page) => page.path)).toEqual([
      "overview",
      "canvas",
      "ontology",
      "knowledge",
      "knowledge/:kbSlug",
      "skills",
      "skills/:skillSlug",
      "workflows",
      "workflows/:workflowSlug",
      "chats",
      "channels",
      "members",
      "settings",
      "configuration",
    ]);
  });
});
