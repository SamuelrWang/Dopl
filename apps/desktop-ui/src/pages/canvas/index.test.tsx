import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import CanvasPage from "./index";
import Canvas2AliasPage from "./canvas2";
import { SEGMENT, WORKSPACE_ID, ontologyBridge } from "#/pages/ontology/test-fixtures";

/**
 * Smoke test for the ported canvas (ontology graph) page.
 *
 * Mocked at `window.dopl.apiRequest` — the Electron bridge — not at the SPA
 * transport, because this page reads over BOTH clients: `useWorkspaceAccess`
 * goes through the SPA's `useApiQuery`, while the whole reused graph tree
 * (`useOntology`, `OntologyResourcesProvider`, `useWorkspaceEntitlements`) goes
 * through the WEB `apiRequest`. Both funnel into the same bridge in the
 * packaged app, so stubbing it exercises the real path once.
 *
 * `fetch` is a never-resolving tripwire: nothing here may reach the network
 * (`connect-src 'none'` in the packaged renderer).
 *
 * `ResizeObserver` and `Element.scrollTo` are jsdom gaps the graph substrate
 * uses (live node-height measurement, scroll-selected-card-into-view).
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const apiRequest = vi.hoisted(() => vi.fn());

const calls = () =>
  apiRequest.mock.calls.map((args) => ({
    path: (args as unknown[])[0] as string,
    opts: ((args as unknown[])[1] ?? {}) as BridgeRequestOpts,
  }));

function renderCanvas() {
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/canvas", element: <CanvasPage /> },
      { path: "/:workspaceSegment/canvas2", element: <Canvas2AliasPage /> },
    ],
    { initialEntries: [`/${SEGMENT}/canvas`] }
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe("canvas page", () => {
  beforeEach(() => {
    // `vi.fn()` from `vi.hoisted` is outside vitest's `restoreMocks` sweep, so
    // the call log would accumulate across tests and make every count wrong.
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string, opts?: BridgeRequestOpts) =>
      ontologyBridge(path, opts)
    );
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<never>(() => {})));
  });

  it("resolves the workspace, then renders the graph off the bridge", async () => {
    renderCanvas();

    // Cluster header + the nodes the scene derives from the snapshot.
    expect(await screen.findByDisplayValue("Revenue")).toBeInTheDocument();
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    // The edge legend is graph-view-only chrome — proves this is the graph,
    // not the kanban view.
    expect(screen.getByText("relationship")).toBeInTheDocument();

    const paths = calls().map((c) => c.path);
    expect(paths).toContain(`/api/workspaces/resolve?segment=${SEGMENT}`);
    expect(paths).toContain("/api/workspaces/me");
    expect(paths).toContain("/api/ontology");
    expect(paths).toContain("/api/billing/status");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("scopes every ontology read to the resolved workspace", async () => {
    renderCanvas();
    await screen.findByText("Accounts");

    const snapshot = calls().find((c) => c.path === "/api/ontology");
    expect(snapshot?.opts.workspaceId).toBe(WORKSPACE_ID);
  });

  it("creates a cluster over the bridge from the tab strip", async () => {
    renderCanvas();

    fireEvent.click(await screen.findByRole("button", { name: "New cluster" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) => c.path === "/api/ontology/clusters" && c.opts.method === "POST"
        )
      ).toBe(true)
    );
  });

  it("hides write affordances for a viewer", async () => {
    apiRequest.mockImplementation((path: string, opts?: BridgeRequestOpts) =>
      path === "/api/workspaces/me"
        ? Promise.resolve<BridgeResponse>({
            status: 200,
            statusText: "OK",
            hasBody: true,
            body: { role: "viewer", userId: "user-1" },
          })
        : ontologyBridge(path, opts)
    );

    renderCanvas();

    expect(await screen.findByText("Accounts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New cluster" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
  });

  it("aliases /canvas2 onto /canvas, forwarding the query string", async () => {
    const router = createMemoryRouter(
      [
        { path: "/:workspaceSegment/canvas", element: <p>graph</p> },
        { path: "/:workspaceSegment/canvas2", element: <Canvas2AliasPage /> },
      ],
      { initialEntries: [`/${SEGMENT}/canvas2?billing=success`] }
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/canvas`)
    );
    expect(router.state.location.search).toBe("?billing=success");
    // `replace` — the alias leaves no history entry, same as the web 308.
    expect(router.state.historyAction).toBe("REPLACE");
  });
});
