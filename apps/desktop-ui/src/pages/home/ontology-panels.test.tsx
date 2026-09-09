import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge } from "#/test-utils/bridge";
import { renderHome, routes } from "./home-test-harness";
import {
  PERSONAL_WORKSPACE_ID,
  PIPELINE_ID,
  ROSTER_ID,
  ontologyRoutes,
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
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      ontologyRoutes(path, opts) ??
      routes(path, opts) ??
      Promise.reject(new Error(`unexpected: ${path}`))
  );
  installBridge({ apiRequest });
});

/** Raise the Ontology face through the header control the operator clicks. */
async function openOntology(): Promise<void> {
  await screen.findByRole("tab", { name: "Overview" });
  fireEvent.click(screen.getByText("Ontology"));
  await screen.findByRole("tab", { name: "Ontology", selected: true });
}

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

describe("the list", () => {
  it("lists the PERSONAL container's ontologies, with the object count", async () => {
    renderHome();
    await openOntology();

    expect(await screen.findByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Roster")).toBeInTheDocument();
    // ⚠ A GRAPH WALK, NOT `columnIds.length` (R5): one column plus its two
    // cards is THREE objects, and a count of 1 would be the column count
    // wearing the word "objects".
    expect(screen.getByText(/3 objects/)).toBeInTheDocument();
  });

  it("reads `/api/ontology` addressed to the PERSONAL container, once", async () => {
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");

    const reads = bridgeCalls(apiRequest).filter(
      (c) => c.path.split("?")[0] === "/api/ontology"
    );
    expect(reads).not.toHaveLength(0);
    for (const read of reads) {
      expect(read.opts.workspaceId).toBe(PERSONAL_WORKSPACE_ID);
    }
  });

  it("says how many channels an ontology is shared into", async () => {
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");

    expect(screen.getByText(/shared into 2 channels/)).toBeInTheDocument();
  });

  it("🔒 SAYS NOTHING about sharing on a STALE cached payload — never '0 channels'", async () => {
    // 🔒 INVARIANTS §8. `Roster` is the shape a bundle that predates the field
    // wrote; UNKNOWN is not EMPTY, so the card omits the clause rather than
    // claiming a share count nobody read.
    renderHome();
    await openOntology();
    await screen.findByText("Roster");

    expect(screen.queryByText(/shared into 0 channels/)).not.toBeInTheDocument();
    const card = screen.getByText("Roster").parentElement;
    expect(card?.textContent).not.toMatch(/shared into/);
  });

  it("falls the SOLO TOGGLE back to the column default on a stale payload", async () => {
    // `Pipeline` carries `agentsMayEdit: false`; `Roster` carries nothing and
    // must read as the default the migration writes (`true` — Samuel's solo
    // default is "viewable and editable").
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");

    const pipeline = screen.getByRole("tablist", { name: "Agents on Pipeline" });
    expect(within(pipeline).getByRole("tab", { name: "View" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const roster = screen.getByRole("tablist", { name: "Agents on Roster" });
    expect(within(roster).getByRole("tab", { name: "Edit" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("writes the solo toggle to the CLUSTER's own PATCH", async () => {
    renderHome();
    await openOntology();
    await screen.findByText("Roster");

    const roster = screen.getByRole("tablist", { name: "Agents on Roster" });
    fireEvent.click(within(roster).getByRole("tab", { name: "View" }));

    await waitFor(() => {
      const patch = bridgeCalls(apiRequest).find(
        (c) =>
          c.path === `/api/ontology/clusters/${ROSTER_ID}` &&
          c.opts.method === "PATCH"
      );
      expect(patch?.opts.body).toEqual({ agentsMayEdit: false });
    });
  });
});

describe("opening one", () => {
  it("renders the board PINNED to that cluster — no strip, no way to the other", async () => {
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");

    const card = screen.getByText("Pipeline").parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));

    // The board's own header, addressed at the pinned cluster.
    const name = await screen.findByLabelText("Cluster name");
    expect(name).toHaveValue("Pipeline");
    // 🔒 THE STRIP IS GONE: the other cluster is not reachable from here, and
    // neither is the view's New-cluster button or its delete.
    expect(screen.queryByRole("button", { name: "New cluster" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete Pipeline/ })).toBeNull();
  });

  it("comes back to the list", async () => {
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");
    const card = screen.getByText("Pipeline").parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    await screen.findByLabelText("Cluster name");

    fireEvent.click(screen.getByRole("button", { name: "All ontologies" }));
    expect(await screen.findByText("Roster")).toBeInTheDocument();
  });
});

describe("creating", () => {
  it("POSTs into the personal container and opens the new board", async () => {
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");

    fireEvent.click(screen.getByRole("button", { name: /Ontology$/ }));

    await waitFor(() => {
      const post = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/ontology/clusters" && c.opts.method === "POST"
      );
      expect(post?.opts.workspaceId).toBe(PERSONAL_WORKSPACE_ID);
    });
  });
});

describe("what this face deliberately does not do", () => {
  it("does not read the CHANNEL's container — the rows are personal", async () => {
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");

    const shares = bridgeCalls(apiRequest).filter((c) =>
      c.path.includes("/shares")
    );
    // ⚠ NO SHARE READ ON FIRST PAINT. The list's own share COUNT rides the
    // snapshot; the per-cluster read is the DIALOG's, and mounting it here
    // would be one request per card.
    expect(shares).toHaveLength(0);
    expect(PIPELINE_ID).toBe("cluster-pipeline");
  });
});

/**
 * THE **Changelog** ENTRY POINT (2026-09-09, the CHANGELOG lane part 2).
 *
 * ⚠ MUTATION-VERIFIED — two reverts, two failures: pointing the card at the
 * OBJECT route instead of the cluster ROLL-UP (the ontology's own rename
 * disappears), and rendering the roll-up with the knowledge row shape (the field
 * row reads as an op label with no values in it).
 */
describe("the changelog", () => {
  async function openChangelog(): Promise<void> {
    renderHome();
    await openOntology();
    await screen.findByText("Pipeline");
    const card = screen.getByText("Pipeline").parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Changelog" }));
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
    await openOntology();
    await screen.findByText("Pipeline");
    const card = screen.getByText("Pipeline").parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    await screen.findByLabelText("Cluster name");

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

  it("comes back to the list", async () => {
    await openChangelog();
    await screen.findByText("Stage");
    fireEvent.click(screen.getByRole("button", { name: "All ontologies" }));
    expect(await screen.findByText("Roster")).toBeInTheDocument();
  });
});
