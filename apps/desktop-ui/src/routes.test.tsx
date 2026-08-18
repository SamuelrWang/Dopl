import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import { WORKSPACE_HOME_PATH, WORKSPACE_PAGES, routes } from "#/routes";

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
    // The shell's one read (P0-2) — it carries what resolve/me/my-access
    // used to answer in three serial hops.
    if (path === "/api/boot") {
      return Promise.resolve(
        ok({
          isOnboarded: true,
          surveyCompleted: true,
          userId: "user-1",
          workspace: WORKSPACE,
          segment: "acme-ab12cd",
          needsRedirect: false,
          role: "owner",
          myAccess: { defaultLevel: "edit", overrides: [] },
        })
      );
    }
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
    // Every row is a real page now — the table's own job is mounting pages
    // inside the shell, so the shell's nav is the anchor.
    renderAt("/acme-ab12cd/channels");

    // The layout's nav is driven by the same table the routes are.
    expect(await screen.findByRole("link", { name: "Knowledge" })).toHaveAttribute(
      "href",
      "/acme-ab12cd/knowledge"
    );
  });

  it("redirects the workspace root to the home page", async () => {
    // What the root route owes is the redirect, and it owes it to whatever
    // `WORKSPACE_HOME_PATH` names — six funnels (index, boot, workspace
    // switch, workspace create, ⌘⇧H, auth change) land on it, so a wrong
    // value here is the app booting into "Not found".
    const router = createMemoryRouter(routes, { initialEntries: ["/acme-ab12cd"] });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/acme-ab12cd/${WORKSPACE_HOME_PATH}`)
    );
    expect(WORKSPACE_HOME_PATH).toBe("overview");
  });

  it("has no route for the retired pages", () => {
    // None of these has a page component left (`configuration` and the two
    // canvas pages went 2026-08-11; `workflows` went with the same wave).
    // Their rows must stay absent all the same: a re-added row would now
    // resolve to nothing, which is a blank pane rather than an import error.
    const paths = WORKSPACE_PAGES.map((page) => page.path);
    for (const retired of ["canvas", "canvas2", "workflows", "configuration"]) {
      expect(paths).not.toContain(retired);
      expect(paths.some((p) => p.startsWith(`${retired}/`))).toBe(false);
    }
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
    // `channels-v2` is the one desktop-only extra: the ported channels surface,
    // live behind a temporary route until Phase 12 renames it to `channels`.
    expect(WORKSPACE_PAGES.map((page) => page.path)).toEqual([
      "overview",
      "ontology",
      "ontology/:clusterSlug",
      "knowledge",
      "knowledge/:kbSlug",
      "skills",
      "skills/:skillSlug",
      "chats",
      "channels",
      "channels-v2",
      "channels-v2/:channelId",
      "members",
      "settings",
    ]);
  });

  it("routes a named channel to the v2 page, with its id", () => {
    // THE DESKTOP NOTIFICATION'S LANDING ROUTE (wiring plan Phase 9). Main
    // pushes `/{segment}/channels-v2/{channelId}` over the navigate bridge, so
    // what this table owes is the match and the param — the page threads it
    // into the v2 core's initial selection from there.
    const router = createMemoryRouter(routes, {
      initialEntries: ["/acme-ab12cd/channels-v2/7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90"],
    });
    const match = router.state.matches.at(-1);
    expect(match?.route.path).toBe("channels-v2/:channelId");
    expect(match?.params.channelId).toBe("7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90");
  });

  it("keeps the paramless row matching, and gives the SHIPPING page no detail child", () => {
    // The pair the deep-link hand copy encodes (`channels-v2: true`,
    // `channels: false`). A `channels/:channelId` row would either claim a
    // detail view the v1 page does not have, or split one path across two page
    // components — which is why the notification's route is v2's.
    const paramless = createMemoryRouter(routes, {
      initialEntries: ["/acme-ab12cd/channels-v2"],
    });
    expect(paramless.state.matches.at(-1)?.route.path).toBe("channels-v2");
    expect(WORKSPACE_PAGES.map((page) => page.path)).not.toContain("channels/:channelId");
  });
});
