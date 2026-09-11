import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
 * Ontology smoke test: REAL `OntologyView` (name dropdown → kanban lanes → object
 * panel) over a mocked bridge, mounted on the SAME two route rows `routes.tsx`
 * registers — ⚠ the index→detail URL sync only behaves if both rows resolve to
 * ONE component type, and that is part of what is tested.
 *
 * ⚠ **THE HEADER IS THE BOARD'S, AND IT WAS RESTYLED ON 2026-09-10** — the ruling
 * landed on /home's face and this page mounts the same component, so the tab
 * strip is gone here too: the cluster's NAME is the dropdown trigger (with
 * "+ Ontology" in it), the gear menu holds Rename and the header button
 * is the black "+ Object". This suite is the proof that the second surface moved
 * with the first.
 *
 * ⚠ **AND THIS PAGE'S STANDALONE TRASH BUTTON IS DELETED** — the gear holds the
 * ONE Delete row on both surfaces now, and "Rename" is how the name is edited at
 * all since the name became a dropdown trigger.
 *
 * Mocked at `window.dopl.apiRequest`: `useWorkspaceAccess` reads over the SPA
 * transport, the reused tree over the WEB `apiRequest`, both funnel into this
 * one bridge in the packaged app. Defining `window.dopl` also puts the shared
 * realtime registry in SPA no-op mode (real desktop behaviour, no websocket).
 */

const apiRequest = vi.hoisted(() => vi.fn());

const calls = () => bridgeCalls(apiRequest);

/** The board's open cluster — the dropdown trigger's own words (it was an input
 *  with a display value until 2026-09-10). */
function openClusterName(): string {
  return screen.getByTitle("Switch ontology").textContent ?? "";
}

/** Open the header's gear — Rename and the ONE Delete row. */
function openGear(name = "Revenue"): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: `Settings for ${name}` }));
  return screen.getByRole("menu");
}

/** Pick another ontology the way the header now offers it. */
function switchTo(name: RegExp): void {
  fireEvent.click(screen.getByTitle("Switch ontology"));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

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

    await screen.findByTitle("Switch ontology");
    expect(openClusterName()).toBe("Revenue");
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

    await screen.findByTitle("Switch ontology");
    expect(openClusterName()).toBe("Delivery");
    // `Accounts` is `Revenue`'s COLUMN — a lane header input, not the cluster.
    expect(screen.queryByDisplayValue("Accounts")).not.toBeInTheDocument();
  });

  it("replaces the URL with the selected cluster's slug, with no history entry", async () => {
    const router = renderOntology();
    await screen.findByTitle("Switch ontology");

    switchTo(/Delivery/);

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

  it("deletes the open cluster, naming its cascade", async () => {
    const router = renderOntology();
    await screen.findByTitle("Switch ontology");

    // ⚠ THE GEAR'S ROW, not a trash button beside it (2026-09-10) — same
    // confirm, one slot.
    fireEvent.click(
      within(openGear()).getByRole("menuitem", { name: "Delete" })
    );

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
    // Selection lands on the ADJACENT cluster, address bar included.
    await waitFor(() => expect(openClusterName()).toBe("Delivery"));
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

    await screen.findByTitle("Switch ontology");
    expect(openClusterName()).toBe("Revenue");
    // The create row inside the name dropdown and the header's "+ Object" are
    // both member+ affordances.
    fireEvent.click(screen.getByTitle("Switch ontology"));
    expect(screen.queryByRole("menuitem", { name: "Ontology" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Object" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Settings for/ })).not.toBeInTheDocument();
  });

  /**
   * 🔒 BOTH SURFACES WEAR ONE HEADER (2026-09-10). The strip is DELETED, not
   * hidden: `cluster-switcher.tsx` has a single face now.
   */
  it("wears /home's header — name dropdown, gear, black + Object, no pills", async () => {
    renderOntology();
    await screen.findByTitle("Switch ontology");

    const object = screen.getByRole("button", { name: "Object" });
    expect(object.className).toMatch(/auth-btn-3d/);
    expect(screen.getByRole("button", { name: /^Settings for Revenue/ })).toBeInTheDocument();
    // The other clusters are BEHIND the trigger, never beside it as pills.
    expect(screen.queryByRole("button", { name: /^Delivery/ })).not.toBeInTheDocument();
    // 🔒 THE DOTTED GRID IS BACK ON THIS SURFACE TOO (Samuel, 2026-09-11) — one
    // board component, so the workspace page moved with /home.
    expect(document.querySelector(".kanban-substrate")).not.toBeNull();
    // …and "+ Column" is GONE from the gear: the black button makes the object
    // TYPE now, and two ways to do it is the duplicate that row became.
    const menu = within(openGear());
    expect(menu.queryByRole("menuitem", { name: "Column" })).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  });

  /**
   * 🔒 **THE TRASH BUTTON IS GONE AND DELETE IS ONE GEAR ROW** (2026-09-10). This
   * page carried a standalone `Trash2` left of the gear; /home never did, because
   * its host supplies the confirm that names CHANNELS. Both surfaces now show
   * exactly one Delete, in the same slot.
   *
   * ⚠ MUTATION-VERIFIED — one revert, one failure: putting `ontology-view.tsx`'s
   * standalone trash button back beside the gear (every other assertion on this
   * page passes with two ways to delete on screen, which is the drift the single
   * slot removes).
   */
  it("deletes from the gear only — no standalone trash, exactly one Delete row", async () => {
    renderOntology();
    await screen.findByTitle("Switch ontology");

    expect(screen.queryByRole("button", { name: /^Delete Revenue/ })).toBeNull();
    expect(screen.queryByTitle("Delete cluster")).toBeNull();

    const menu = within(openGear());
    expect(menu.getAllByRole("menuitem", { name: "Delete" })).toHaveLength(1);
    expect(menu.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  });

  /**
   * 🔒 **RENAME MOVED WITH THE HEADER** — the name is a dropdown trigger here too,
   * so the gear's row is this page's only rename as well.
   */
  it("renames from the gear row, PATCHing the cluster", async () => {
    renderOntology();
    await screen.findByTitle("Switch ontology");

    fireEvent.click(within(openGear()).getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByLabelText("Name") as HTMLInputElement;
    expect(field.value).toBe("Revenue");
    // The trigger — and its chevron — is what the field replaced.
    expect(screen.queryByTitle("Switch ontology")).toBeNull();

    fireEvent.change(field, { target: { value: "Bookings" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(openClusterName()).toBe("Bookings"));
    await waitFor(
      () => {
        const patch = calls().find(
          (c) =>
            c.path === `/api/ontology/clusters/${CLUSTER_ID}` &&
            c.opts.method === "PATCH"
        );
        expect(patch?.opts.body).toMatchObject({ name: "Bookings" });
      },
      { timeout: 3000 }
    );
  });

  it("cancels the rename on Escape", async () => {
    renderOntology();
    await screen.findByTitle("Switch ontology");

    fireEvent.click(within(openGear()).getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "Nope" } });
    fireEvent.keyDown(field, { key: "Escape" });

    await screen.findByTitle("Switch ontology");
    expect(openClusterName()).toBe("Revenue");
    expect(
      calls().some(
        (c) =>
          c.path === `/api/ontology/clusters/${CLUSTER_ID}` &&
          c.opts.method === "PATCH"
      )
    ).toBe(false);
  });
});
