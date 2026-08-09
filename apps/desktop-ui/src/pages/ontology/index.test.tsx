import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import {
  bootBody,
  bridgeCalls,
  installBridge,
  renderWithProviders,
} from "#/test-utils/bridge";
import OntologyPage from "./index";
import OntologyDetailPage from "./detail";
import { CLUSTER_ID, SEGMENT, WORKSPACE_ID, ontologyBridge } from "./test-fixtures";

/**
 * Smoke test for the ported ontology pages: the REAL `OntologyView` (tab strip
 * → kanban lanes → object panel) over a mocked bridge, mounted on the SAME two
 * route rows `routes.tsx` registers — the index→detail URL sync is part of what
 * is being tested, and it only behaves if both rows resolve to one component
 * type.
 *
 * Mocked at `window.dopl.apiRequest`: the seam (`useWorkspaceAccess`) reads
 * over the SPA transport and the whole reused tree reads over the WEB
 * `apiRequest`, and both funnel into this one bridge in the packaged app.
 * Defining `window.dopl` also puts the shared realtime registry in its SPA
 * no-op mode, which is the real desktop behaviour — no websocket to stub.
 */

const apiRequest = vi.hoisted(() => vi.fn());

const calls = () => bridgeCalls(apiRequest);

function renderOntology(entry = `/${SEGMENT}/ontology`) {
  const { router } = renderWithProviders(
    [
      { path: "/:workspaceSegment/ontology", element: <OntologyPage /> },
      { path: "/:workspaceSegment/ontology/:clusterSlug", element: <OntologyDetailPage /> },
    ],
    [entry]
  );
  return router;
}

describe("ontology page", () => {
  beforeEach(() => {
    // `vi.fn()` from `vi.hoisted` is outside vitest's `restoreMocks` sweep, so
    // the call log would accumulate across tests and make every count wrong.
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string, opts?: BridgeRequestOpts) =>
      ontologyBridge(path, opts)
    );
    installBridge({ apiRequest });
  });

  it("resolves the workspace, then renders the first cluster's board", async () => {
    renderOntology();

    expect(await screen.findByDisplayValue("Revenue")).toBeInTheDocument();
    // Kanban lanes: the column is an editable header input, its cards are text.
    expect(screen.getByDisplayValue("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();

    const paths = calls().map((c) => c.path);
    // ONE read for workspace + role + caller id (P0-2), not three.
    expect(paths).toContain("/api/boot");
    expect(paths).not.toContain("/api/workspaces/me");
    expect(paths).toContain("/api/ontology");
    const snapshot = calls().find((c) => c.path === "/api/ontology");
    expect(snapshot?.opts.workspaceId).toBe(WORKSPACE_ID);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honours the deep-linked cluster slug as the fallback selector", async () => {
    renderOntology(`/${SEGMENT}/ontology/delivery`);

    // `initialClusterSlug` picks the cluster; the name input is the tell.
    expect(await screen.findByDisplayValue("Delivery")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Accounts")).not.toBeInTheDocument();
  });

  it("replaces the URL with the selected cluster's slug, with no history entry", async () => {
    const router = renderOntology();
    await screen.findByDisplayValue("Revenue");

    fireEvent.click(screen.getByRole("button", { name: /Delivery/ }));

    // The router's `navigate(..., {replace:true})` stands in for the web
    // `history.replaceState` — a path write that is a security error on the
    // packaged file:// document.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/ontology/delivery`)
    );
    expect(router.state.historyAction).toBe("REPLACE");
    // Same component type on both rows, so the store survived the route change
    // rather than remounting and refetching.
    expect(
      calls().filter((c) => c.path === "/api/ontology")
    ).toHaveLength(1);
  });

  it("opens the object panel and persists an edit over the bridge", async () => {
    renderOntology();

    fireEvent.click(await screen.findByText("Acme Corp"));
    const subtitle = await screen.findByDisplayValue("Enterprise");
    fireEvent.change(subtitle, { target: { value: "Mid-market" } });

    // Debounced full-state PATCH — the store's own write path, reused untouched.
    await waitFor(
      () =>
        expect(
          calls().some(
            (c) =>
              c.path === `/api/ontology/objects/obj-card-1` && c.opts.method === "PATCH"
          )
        ).toBe(true),
      { timeout: 3000 }
    );
  });

  it("deletes the open cluster from the tab strip, naming its cascade", async () => {
    const router = renderOntology();
    await screen.findByDisplayValue("Revenue");

    fireEvent.click(screen.getByRole("button", { name: "Delete Revenue" }));

    // The count is the whole point of the copy: "cluster" undersells what a
    // permanent cascade delete takes (the column + its card).
    expect(
      await screen.findByText(
        `This permanently deletes "Revenue" and its 2 objects. This can't be undone.`
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) =>
            c.path === `/api/ontology/clusters/${CLUSTER_ID}` && c.opts.method === "DELETE"
        )
      ).toBe(true)
    );
    // Selection lands on the ADJACENT tab, address bar included — not on a
    // silent fall-through to whatever cluster happens to be first.
    expect(await screen.findByDisplayValue("Delivery")).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/ontology/delivery`)
    );
  });

  it("hides create affordances for a viewer", async () => {
    apiRequest.mockImplementation((path: string, opts?: BridgeRequestOpts) =>
      path === "/api/boot"
        ? Promise.resolve({
            status: 200,
            statusText: "OK",
            hasBody: true,
            body: bootBody({ role: "viewer" }),
          })
        : ontologyBridge(path, opts)
    );

    renderOntology();

    expect(await screen.findByDisplayValue("Revenue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New cluster" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Column" })).not.toBeInTheDocument();
  });
});
