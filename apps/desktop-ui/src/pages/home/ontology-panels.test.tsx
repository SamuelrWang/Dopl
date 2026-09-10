import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import { renderHome, routes } from "./home-test-harness";
import {
  NEW_CLUSTER_ID,
  PERSONAL_WORKSPACE_ID,
  PIPELINE_ID,
  ROSTER_ID,
  ontologyRoutes,
  openOntologyFace,
  openOntologyMenu,
  openOntologySwitcher,
  resetOntologyRoutes,
} from "./ontology-test-harness";
import { paneToken } from "./home-panes";
import {
  AGENTS_PANE,
  KNOWLEDGE_PANE,
  ONTOLOGY_PANE,
  OVERVIEW_PANE,
} from "./home-tabs";

/**
 * /home → ONTOLOGY, END TO END THROUGH THE REAL PAGE.
 *
 * ⚠ **THE FACE IS THE WORKSPACE BOARD SINCE 2026-09-10** (Samuel: *"the UI for
 * the ontology in the home should look a lot more like the ontology for
 * workspaces … for the ontology switcher, instead of different tabs, have it be
 * a dropdown"*). What this file asserted about a grid of CARDS it now asserts
 * about the board and its header: the switcher lists the container's ontologies,
 * "+ Ontology" makes one and lands on it, and every /home-only control is
 * reachable from the header's `…` and from nowhere else.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NEVER THE PANEL, for the reason
 * `knowledge-panels.test.tsx` gives: three of the things this file proves are
 * properties of the PAGE — that the fifth tab exists and is reachable, that the
 * face reads the PERSONAL container off the boot query the page already mounts,
 * and that the pane token resolves to this face at all. A direct mount would
 * hand the panel static props and pass with every one of those broken.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED — `vi.mock` is hoisted per file and its
 * factory may not close over imports, so the stub is local.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  resetOntologyRoutes();
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      ontologyRoutes(path, opts) ??
      routes(path, opts) ??
      Promise.reject(new Error(`unexpected: ${path}`))
  );
  installBridge({ apiRequest });
});

/**
 * 🔒 THE PANE TOKEN — a WHOLE token, and a channel click on this face changes
 * NOTHING (S4's ruling; INVARIANTS §4A, `home-tabs.ts › ONTOLOGY_PANE`).
 *
 * ⚠ IT IS THE ONE THING ON THIS FACE THAT IS NOT VISIBLE, so it is asserted
 * directly rather than inferred from a render: keying Ontology by the selection
 * would close an open board on every click of the list beside it, which looks
 * like a flicker and is a lost edit.
 *
 * ⚠ AND THE CONSUMERS MUST NOT THROW ON IT. `HomePane` matches this token
 * BEFORE the two `startsWith` branches and reads no row out of it; nothing
 * `slice`s it and `use-activity-jump.ts` never sees a tab at all — it raises
 * Channels by name. A prefix branch claiming this token would hand
 * `HomeAgentPanels` a row id of `""`.
 */
describe("the pane token", () => {
  it("carries NO row, whatever is selected — Overview's rule, second host", () => {
    expect(paneToken("ontology", "link:ws-1")).toBe(ONTOLOGY_PANE);
    expect(paneToken("ontology", null)).toBe(ONTOLOGY_PANE);
    expect(paneToken("ontology", "rel:ws-2")).toBe(paneToken("ontology", "link:ws-9"));
  });

  it("is claimed by NO other face's branch — the disjointness rule, both ways", () => {
    expect(ONTOLOGY_PANE.startsWith(KNOWLEDGE_PANE)).toBe(false);
    expect(ONTOLOGY_PANE.startsWith(AGENTS_PANE)).toBe(false);
    expect(ONTOLOGY_PANE.startsWith(OVERVIEW_PANE)).toBe(false);
    expect(OVERVIEW_PANE.startsWith(ONTOLOGY_PANE)).toBe(false);
    // …and the row-keyed faces still key on their row, so the two rules hold
    // at once rather than one having replaced the other.
    expect(paneToken("agents", "link:ws-1")).toBe(`${AGENTS_PANE}link:ws-1`);
  });
});

describe("the face", () => {
  it("IS the board, addressed at the PERSONAL container — not a list of cards", async () => {
    renderHome();
    await openOntologyFace();

    // The workspace page's own header + kanban, rendered for /home.
    expect(screen.getByLabelText("Cluster name")).toHaveValue("Pipeline");
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    // 🔒 THE CARD LIST IS GONE, and with it the four pills that hung off it.
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("reads `/api/ontology` addressed to the PERSONAL container, once", async () => {
    renderHome();
    await openOntologyFace();

    const reads = bridgeCalls(apiRequest).filter(
      (c) => c.path.split("?")[0] === "/api/ontology"
    );
    expect(reads).not.toHaveLength(0);
    for (const read of reads) {
      expect(read.opts.workspaceId).toBe(PERSONAL_WORKSPACE_ID);
    }
  });

  it("keeps the board's OWN chrome — Column, and no cluster delete beside it", async () => {
    renderHome();
    await openOntologyFace();

    expect(screen.getByRole("button", { name: "Column" })).toBeInTheDocument();
    // 🔒 The delete that names CHANNELS is the host's, in the overflow — the
    // view's own trash would delete with no such sentence (Q4).
    expect(screen.queryByRole("button", { name: /^Delete Pipeline/ })).toBeNull();
  });

  it("says nothing about emptiness before the read lands", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/ontology"
        ? new Promise(() => {})
        : (ontologyRoutes(path, opts) ??
          routes(path, opts) ??
          Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.click(screen.getByText("Ontology"));
    await screen.findByRole("tab", { name: "Ontology", selected: true });

    expect(screen.queryByText("No ontologies yet.")).toBeNull();
  });

  it("offers ONE line and the page button when there are none", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/ontology"
        ? Promise.resolve(ok({ clusters: [], objects: {} }))
        : (ontologyRoutes(path, opts) ??
          routes(path, opts) ??
          Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.click(screen.getByText("Ontology"));

    expect(await screen.findByText("No ontologies yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ontology" })).toBeInTheDocument();
  });
});

/**
 * THE SWITCHER — the tab strip's replacement (Samuel, 2026-09-10: *"instead of
 * different tabs, have it be a dropdown"*).
 *
 * ⚠ MUTATION-VERIFIED — one revert, one failure: rendering only the ACTIVE entry
 * in `cluster-switcher.tsx › ClusterDropdown` (the menu lists the ontology you
 * are already on and no way to any other, which is the whole control missing
 * while the trigger still looks right).
 */
describe("the switcher", () => {
  it("lists EVERY ontology in the container, with its object count", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologySwitcher();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Pipeline/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Roster/ })).toBeInTheDocument();
    // ⚠ A GRAPH WALK, NOT `columnIds.length` (R5): one column plus its two
    // cards is THREE objects, and a count of 1 would be the column count
    // wearing the word "objects".
    expect(within(menu).getByText("3 objects")).toBeInTheDocument();
    expect(within(menu).getByText("0 objects")).toBeInTheDocument();
  });

  it("switches the board to the one picked", async () => {
    renderHome();
    await openOntologyFace();
    const reads = () =>
      bridgeCalls(apiRequest).filter((c) => c.path.split("?")[0] === "/api/ontology")
        .length;
    const before = reads();
    await openOntologySwitcher();

    fireEvent.click(screen.getByRole("menuitem", { name: /Roster/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("Cluster name")).toHaveValue("Roster")
    );
    // ⚠ NO SECOND READ: both ontologies are in the snapshot the board already
    // holds, so the switcher moves a SELECTION rather than fetching a board.
    expect(reads()).toBe(before);
  });
});

/**
 * ⚠ MUTATION-VERIFIED — one revert, one failure: dropping `setSelectedId(cluster.id)`
 * from `ontology-panels.tsx › create` (the POST still lands and the ontology
 * still exists, so every other assertion here passes while the operator is left
 * looking at the ontology they were already on).
 */
describe("creating", () => {
  it("POSTs into the personal container and LANDS on the new ontology", async () => {
    renderHome();
    await openOntologyFace();

    fireEvent.click(screen.getByRole("button", { name: "Ontology" }));

    await waitFor(() => {
      const post = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/ontology/clusters" && c.opts.method === "POST"
      );
      expect(post?.opts.workspaceId).toBe(PERSONAL_WORKSPACE_ID);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Cluster name")).toHaveValue("New cluster")
    );
    expect(NEW_CLUSTER_ID).toBe("cluster-new");
  });
});

/**
 * EVERY /home CONTROL, ONE PLACE EACH — the four the card's pill row carried
 * before the restyle, re-homed into the header's `…`.
 */
describe("the controls", () => {
  it("reaches Share, Changelog, both agent rungs and Delete from the overflow", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Share" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Changelog" })).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Agents can view" })
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Agents can edit" })
    ).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("writes the agents rung to the CLUSTER's own PATCH", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologySwitcher();
    fireEvent.click(screen.getByRole("menuitem", { name: /Roster/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Cluster name")).toHaveValue("Roster")
    );

    await openOntologyMenu("Roster");
    fireEvent.click(screen.getByRole("menuitem", { name: "Agents can view" }));

    await waitFor(() => {
      const patch = bridgeCalls(apiRequest).find(
        (c) =>
          c.path === `/api/ontology/clusters/${ROSTER_ID}` &&
          c.opts.method === "PATCH"
      );
      expect(patch?.opts.body).toEqual({ agentsMayEdit: false });
    });
  });

  it("opens the share popup for the ontology on the board", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));

    expect(
      await screen.findByRole("dialog", { name: /Share Pipeline/i })
    ).toBeInTheDocument();
  });

  it("opens the delete confirm, which is the one that NAMES the channels", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByText(/unshares it from/)).toBeInTheDocument();
  });
});

describe("what this face deliberately does not do", () => {
  it("does not read the CHANNEL's container — the rows are personal", async () => {
    renderHome();
    await openOntologyFace();

    const shares = bridgeCalls(apiRequest).filter((c) =>
      c.path.includes("/shares")
    );
    // ⚠ NO SHARE READ ON FIRST PAINT. The board's own header says nothing about
    // sharing; the per-cluster read is the DIALOG's.
    expect(shares).toHaveLength(0);
    expect(PIPELINE_ID).toBe("cluster-pipeline");
  });
});

/**
 * THE **Changelog** ENTRY POINT (2026-09-09, the CHANGELOG lane part 2).
 *
 * ⚠ MUTATION-VERIFIED — two reverts, two failures: pointing it at the OBJECT
 * route instead of the cluster ROLL-UP (the ontology's own rename disappears),
 * and rendering the roll-up with the knowledge row shape (the field row reads as
 * an op label with no values in it).
 */
describe("the changelog", () => {
  async function openChangelog(): Promise<void> {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Changelog" }));
  }

  it("reads the CLUSTER roll-up and renders `field: before → after`", async () => {
    await openChangelog();
    const row = await screen.findByText("Stage");
    expect(row.parentElement?.textContent).toContain("New");
    expect(row.parentElement?.textContent).toContain("Won");
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).some(
          (c) => c.path.split("?")[0] === `/api/ontology/clusters/${PIPELINE_ID}/revisions`
        )
      ).toBe(true)
    );
  });

  it("shows the ontology's OWN rows beside its objects', day-grouped", async () => {
    await openChangelog();
    await screen.findByText("Stage");
    // The cluster's own rename, by an AGENT — the roll-up is both, in one list.
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("agent")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
  });

  it("the OBJECT panel carries a History section, addressed at that object", async () => {
    renderHome();
    await openOntologyFace();

    fireEvent.click(await screen.findByText("Acme"));
    expect(
      await screen.findByRole("heading", { name: "History" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).some(
          (c) => c.path.split("?")[0] === "/api/ontology/objects/card-1/revisions"
        )
      ).toBe(true)
    );
  });

  it("comes back to the board", async () => {
    await openChangelog();
    await screen.findByText("Stage");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("Cluster name")).toHaveValue("Pipeline");
  });
});
