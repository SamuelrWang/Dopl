import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import WorkflowsPage from "#/pages/workflows";
import WorkflowDetailPage from "#/pages/workflows/detail";
import { SEGMENT } from "#/test-utils/bridge";

/**
 * Smoke test for the ported workflows pages: the REAL `WorkflowsView` tree
 * (tab strip → graph substrate → step cards) over a mocked data layer, mounted
 * on the SAME two route rows `routes.tsx` registers, because the index→detail
 * URL sync is part of what is being tested.
 *
 * `fetch` is the mock point: the reused feature client
 * (`@/shared/api/api-client`) is what every workflow read and write goes
 * through, and it falls back to `fetch` when no `window.dopl` bridge exists.
 *
 * Supabase is stubbed at the browser-client module so `useWorkflowsRealtime`
 * wires for real without a websocket. `ResizeObserver` and `Element.scrollTo`
 * are jsdom gaps the graph substrate uses (live height measurement,
 * scroll-selected-card-into-view).
 */

vi.mock("@/shared/supabase/browser", () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  return {
    getSupabaseBrowser: () => ({
      channel: () => channel,
      removeChannel: () => {},
    }),
  };
});

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}


/** Fresh per test: the realtime registry keys one channel per workspace id
 *  across mounts, so a reused id hands the next test a live entry. */
let workspaceId = "";
let workspaceSeq = 0;

const ROW = {
  id: "wf-1",
  slug: "onboard-a-client",
  name: "Onboard a client",
  description: "Everything from intro call to kickoff.",
  step_count: 2,
  knowledge_base_count: 0,
  skill_count: 0,
};

const OTHER_ROW = {
  ...ROW,
  id: "wf-2",
  slug: "publish-a-post",
  name: "Publish a post",
  description: null,
  step_count: 0,
};

const step = (id: string, ref: string, title: string) => ({
  id,
  ref,
  title,
  description: "",
  reads: [],
  actions: [],
  userInput: "",
  agentOutput: "",
  nextInstructions: "",
});

const DETAIL = {
  ...ROW,
  graph: {
    nodes: [step("n-1", "intro", "Run the intro call"), step("n-2", "kickoff", "Book kickoff")],
    edges: [{ from: "n-1", to: "n-2", condition: "" }],
  },
  layout: {},
};

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: FetchCall[];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  workspaceId = `ws-${++workspaceSeq}`;
  calls = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (url.startsWith("/api/workspaces/resolve")) {
      return json({
        workspace: { id: workspaceId, name: "Acme", slug: "acme", publicId: "ab12cd" },
        canonical: SEGMENT,
        needsRedirect: false,
      });
    }
    if (url === "/api/workspaces/me") return json({ role: "member", userId: "u-1" });
    if (url === "/api/workflows") return json({ workflows: [ROW, OTHER_ROW] });
    if (url === "/api/workflows/wf-1") return json(DETAIL);
    if (url === "/api/workflows/wf-2") {
      return json({ ...OTHER_ROW, graph: { nodes: [], edges: [] }, layout: {} });
    }
    if (url === "/api/workflows/wf-1/nodes" && method === "POST") {
      return json({ node_id: "n-3" });
    }
    if (url === "/api/knowledge/bases") return json({ bases: [] });
    if (url === "/api/skills") return json({ skills: [] });
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

/** The two rows exactly as `routes.tsx` registers them — same component type
 *  on both, which is what keeps the slug sync from remounting the graph. */
function renderPage(initialPath = `/${SEGMENT}/workflows`) {
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/workflows", element: <WorkflowsPage /> },
      { path: "/:workspaceSegment/workflows/:workflowSlug", element: <WorkflowDetailPage /> },
    ],
    { initialEntries: [initialPath] }
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

const requestsTo = (path: string, method = "GET") =>
  calls.filter((c) => c.url.split("?")[0] === path && c.method === method);

describe("workflows page", () => {
  it("resolves the workspace, then renders the first workflow's graph", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: /Run the intro call/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Book kickoff/ })).toBeInTheDocument();

    // The RSC's resolve + role, now client queries; the rest was always client.
    expect(requestsTo("/api/workspaces/resolve")[0].url).toContain(`segment=${SEGMENT}`);
    expect(requestsTo("/api/workspaces/me")).toHaveLength(1);
    expect(requestsTo("/api/workflows")[0].headers["x-workspace-id"]).toBe(workspaceId);
    expect(requestsTo("/api/workflows/wf-1")).toHaveLength(1);

    // Tab strip + the inline name/purpose inputs.
    expect(screen.getByRole("button", { name: /Publish a post/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Workflow name")).toHaveValue("Onboard a client");
  });

  it("keeps the URL on the server-canonical slug without a history entry", async () => {
    const router = renderPage();
    await screen.findByRole("button", { name: /Run the intro call/ });

    // history.replaceState → navigate(replace): the deep-link URL is restored,
    // and Back does not walk through it.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/workflows/onboard-a-client`)
    );
    expect(router.state.historyAction).toBe("REPLACE");

    fireEvent.click(screen.getByRole("button", { name: /Publish a post/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/workflows/publish-a-post`)
    );
  });

  it("pins the deep-linked workflow from the URL slug", async () => {
    renderPage(`/${SEGMENT}/workflows/publish-a-post`);

    await waitFor(() => expect(requestsTo("/api/workflows/wf-2")).toHaveLength(1));
    expect(await screen.findByDisplayValue("Publish a post")).toBeInTheDocument();
    // The first workflow is NOT the one that loaded.
    expect(requestsTo("/api/workflows/wf-1")).toHaveLength(0);
  });

  it("adds a step through the API and re-reads the workflow", async () => {
    renderPage();
    await screen.findByRole("button", { name: /Run the intro call/ });
    const before = requestsTo("/api/workflows/wf-1").length;

    fireEvent.click(screen.getByRole("button", { name: "Step" }));

    await waitFor(() =>
      expect(requestsTo("/api/workflows/wf-1/nodes", "POST")).toHaveLength(1)
    );
    const post = requestsTo("/api/workflows/wf-1/nodes", "POST")[0];
    expect(post.headers["x-workspace-id"]).toBe(workspaceId);
    expect(post.body).toMatchObject({ title: "New step" });
    // Structural mutations invalidate the detail so the server-owned topo
    // order / entry steps re-land.
    await waitFor(() =>
      expect(requestsTo("/api/workflows/wf-1").length).toBeGreaterThan(before)
    );
  });

  it("persists a dragged step position as a debounced layout PATCH", async () => {
    renderPage();
    const card = await screen.findByRole("button", { name: /Run the intro call/ });

    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 180, clientY: 156 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 180, clientY: 156 });

    // useGraphPositions debounces the write by 800ms and sends the WHOLE map
    // under `layout` (the column stores one blob).
    await waitFor(
      () => expect(requestsTo("/api/workflows/wf-1", "PATCH")).toHaveLength(1),
      { timeout: 3000 }
    );
    const patch = requestsTo("/api/workflows/wf-1", "PATCH")[0] as FetchCall & {
      body: { layout: Record<string, { x: number; y: number }> };
    };
    expect(Object.keys(patch.body.layout)).toEqual(["n-1"]);
    // Snapped to the 8px grid.
    expect(patch.body.layout["n-1"].x % 8).toBe(0);
    expect(patch.body.layout["n-1"].y % 8).toBe(0);
  });
});
