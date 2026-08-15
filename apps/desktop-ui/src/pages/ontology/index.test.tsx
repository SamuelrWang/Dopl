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
 * Ontology smoke test: REAL `OntologyView` (tab strip → kanban lanes → object
 * panel) over a mocked bridge, mounted on the SAME two route rows `routes.tsx`
 * registers — ⚠ the index→detail URL sync only behaves if both rows resolve to
 * ONE component type, and that is part of what is tested.
 *
 * Mocked at `window.dopl.apiRequest`: `useWorkspaceAccess` reads over the SPA
 * transport, the reused tree over the WEB `apiRequest`, both funnel into this
 * one bridge in the packaged app. Defining `window.dopl` also puts the shared
 * realtime registry in SPA no-op mode (real desktop behaviour, no websocket).
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
    // ⚠ `vi.hoisted` mocks sit outside vitest's `restoreMocks` sweep, so the
    // call log accumulates across tests and makes every count wrong.
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string, opts?: BridgeRequestOpts) =>
      ontologyBridge(path, opts)
    );
    installBridge({ apiRequest });
  });

  it("resolves the workspace, then renders the first cluster's board", async () => {
    renderOntology();

    expect(await screen.findByDisplayValue("Revenue")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();

    const paths = calls().map((c) => c.path);
    // ONE read for workspace + role + caller id, not three.
    expect(paths).toContain("/api/boot");
    expect(paths).not.toContain("/api/workspaces/me");
    expect(paths).toContain("/api/ontology");
    const snapshot = calls().find((c) => c.path === "/api/ontology");
    expect(snapshot?.opts.workspaceId).toBe(WORKSPACE_ID);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honours the deep-linked cluster slug as the fallback selector", async () => {
    renderOntology(`/${SEGMENT}/ontology/delivery`);

    expect(await screen.findByDisplayValue("Delivery")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Accounts")).not.toBeInTheDocument();
  });

  it("replaces the URL with the selected cluster's slug, with no history entry", async () => {
    const router = renderOntology();
    await screen.findByDisplayValue("Revenue");

    fireEvent.click(screen.getByRole("button", { name: /Delivery/ }));

    // ⚠ `navigate(..., {replace:true})` stands in for `history.replaceState`:
    // a path write is a security error on the packaged file:// document.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/ontology/delivery`)
    );
    expect(router.state.historyAction).toBe("REPLACE");
    // ⚠ Same component type on both rows, so the store survives the route
    // change rather than remounting and refetching.
    expect(
      calls().filter((c) => c.path === "/api/ontology")
    ).toHaveLength(1);
  });

  it("opens the object panel and persists an edit over the bridge", async () => {
    renderOntology();

    fireEvent.click(await screen.findByText("Acme Corp"));
    const subtitle = await screen.findByDisplayValue("Enterprise");
    fireEvent.change(subtitle, { target: { value: "Mid-market" } });

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

    // Count is the point of the copy: "cluster" undersells what a permanent
    // cascade delete takes (the column + its card).
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
    // Selection lands on the ADJACENT tab, address bar included.
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
