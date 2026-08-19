import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import {
  THREAD_WINDOW_PATH,
  WORKSPACE_HOME_PATH,
  WORKSPACE_PAGES,
  routes,
} from "#/routes";

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
    // ⚠ NO `channels-v2` ROW. It existed from Phase 2 to the CUTOVER (Phase 12,
    // 2026-08-18) as a temporary path over the ported surface, beside a
    // `channels` row that had no detail child. Both v2 rows were renamed to
    // `channels` in one edit and the old page was deleted; a re-added
    // `channels-v2` row would now resolve to nothing.
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
      "channels/:channelId",
      "members",
      "settings",
    ]);
    expect(WORKSPACE_PAGES.map((page) => page.path)).not.toContain("channels-v2");
  });

  it("routes a named channel to the channels page, with its id", () => {
    // THE DESKTOP NOTIFICATION'S LANDING ROUTE (wiring plan Phase 9). Main
    // pushes `/{segment}/channels/{channelId}` over the navigate bridge
    // (`main/shell-mode.js › CHANNELS_PAGE`), so what this table owes is the
    // match and the param — the page threads it into the channels core's
    // initial selection from there.
    const router = createMemoryRouter(routes, {
      initialEntries: ["/acme-ab12cd/channels/7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90"],
    });
    const match = router.state.matches.at(-1);
    expect(match?.route.path).toBe("channels/:channelId");
    expect(match?.params.channelId).toBe("7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90");
  });

  it("keeps the paramless row matching, and gives the SHIPPING page its detail child", () => {
    // The pair the deep-link hand copy encodes, AFTER the cutover: `channels`
    // is `true` there and there is no `channels-v2` key at all. The assertion
    // INVERTED with the rename — until Phase 12 the shipping page had no detail
    // view and a `channels/:channelId` row would have lied about it; the
    // shipping page IS the detail-capable one now, and the two halves of the
    // path are one page component.
    const paramless = createMemoryRouter(routes, {
      initialEntries: ["/acme-ab12cd/channels"],
    });
    expect(paramless.state.matches.at(-1)?.route.path).toBe("channels");
    expect(WORKSPACE_PAGES.map((page) => page.path)).toContain("channels/:channelId");
  });
});

// ── The pop-out thread window (Samuel, 2026-08-19) ───────────────────────────
//
// ⚠ THE WHOLE POINT OF THE ROW IS THAT IT IS **OUTSIDE** `AppShellLayout`. The pop-out
// landed on the channels page until now, so a window opened to read ONE thread arrived
// carrying the app sidebar, the channels tree and the info panel. A layout route cannot be
// opted out of from inside, so the thread-only surface needs a row of its own — and a test
// that only checked "the route matches" would stay green if somebody nested it back.

describe("the thread-window route", () => {
  it("matches, with its channel param and its `?thread=` selection", () => {
    const router = createMemoryRouter(routes, {
      initialEntries: [`/acme-ab12cd/${THREAD_WINDOW_PATH}/ch-1?thread=t-1`],
    });
    const match = router.state.matches.at(-1);
    expect(match?.route.path).toBe(`/:workspaceSegment/${THREAD_WINDOW_PATH}/:channelId`);
    expect(match?.params.channelId).toBe("ch-1");
    expect(router.state.location.search).toBe("?thread=t-1");
  });

  it("is a TOP-LEVEL row — the app shell is not in its match chain", () => {
    const shell = createMemoryRouter(routes, {
      initialEntries: ["/acme-ab12cd/channels"],
    });
    const shellRoot = shell.state.matches[0]?.route.path;
    expect(shellRoot).toBe("/:workspaceSegment");

    const window = createMemoryRouter(routes, {
      initialEntries: [`/acme-ab12cd/${THREAD_WINDOW_PATH}/ch-1`],
    });
    expect(window.state.matches).toHaveLength(1);
    expect(window.state.matches[0]?.route.path).not.toBe("/:workspaceSegment");
  });

  it("is NOT a workspace page, so no deep link can reach it", () => {
    // `WORKSPACE_PAGES` is what `main/deep-link-target.js` hand-copies; a row here would let
    // `dopl://open/{seg}/thread-window/{id}` mint a bare thread window from any caller's
    // URL. A pop-out is created by MAIN, at a window main built and registered.
    const paths = WORKSPACE_PAGES.map((page) => page.path);
    expect(paths).not.toContain(THREAD_WINDOW_PATH);
    expect(paths.some((p) => p.startsWith(`${THREAD_WINDOW_PATH}/`))).toBe(false);
  });
});
