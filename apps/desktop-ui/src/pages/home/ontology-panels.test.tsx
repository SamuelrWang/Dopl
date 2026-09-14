import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import { renderHome, routes } from "./home-test-harness";
import {
  NEW_CLUSTER_ID,
  PERSONAL_WORKSPACE_ID,
  PIPELINE_ID,
  createOntologyFromSwitcher,
  ontologyName,
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
 * ⚠ **THE HEADER WAS RESTYLED ON 2026-09-10** (Samuel, on this face): the name IS
 * the dropdown (and carries "+ Ontology"), the purpose line is the kit's
 * underline field hinted "Description", the `…` became a gear circle and
 * "+ Column" became the black "+ Object". What this file asserted about the old
 * pills and the old page button it now asserts about those.
 *
 * ⚠ **AND ON 2026-09-11 "+ Object" BECAME THE OBJECT TYPE — THE LANE — BEHIND A
 * POPUP** (Samuel: it had been *"creating a new object on top of the column"*).
 * The gear's duplicate "+ Column" row went with that, and the dotted grid came
 * back on the same white panel.
 *
 * ⚠ **AND RENAMING IS A GEAR ROW** — making the name the dropdown's TRIGGER left
 * nothing that renamed an ontology, so "Rename" swaps that trigger for the same
 * underline field the Description wears (`board-header-bits.tsx ›
 * InlineUnderlineField`, one recipe for both).
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
 * 🔒 THE PANE TOKEN — a WHOLE token, so the token this face renders under does
 * not vary with the selection (S4's ruling; INVARIANTS §4A, `home-tabs.ts ›
 * ONTOLOGY_PANE`).
 *
 * ⚠ **THAT IS ABOUT THE TOKEN, NOT ABOUT THE CLICK — AND IT STOPPED BEING BOTH
 * ON 2026-09-13.** This docblock read *"a channel click on this face changes
 * NOTHING"*, which was the S4 behaviour and is now the bug Samuel reported from
 * exactly this face: a pick raises the CHANNEL face from wherever you are (the
 * `it` at the end of "the face" below). The token rule survives untouched — while
 * Ontology is the face on screen, every selection resolves to the same token.
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
    expect(ontologyName()).toBe("Pipeline");
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

  /**
   * 🔒 **A CHANNEL PICK LEAVES THIS FACE FOR THAT CHANNEL'S OWN (Samuel,
   * 2026-09-13:** *"I was on the ontology page, and it just stayed on the ontology
   * page no change. So wherever the user is, if they click on a different channel
   * in the picker, it needs to go to the channel page of that"***).** This face is
   * where he reported it, which is why the case lives here and not only beside the
   * Overview one (`index.test.tsx`) — and it is the face the old carve-out left
   * behind, because Ontology's pane carries no row either.
   *
   * ⚠ **THE TOKEN RULE ABOVE IS UNAFFECTED.** What changed is the FACE, not how
   * this face keys itself: while Ontology is on screen a selection still resolves
   * to one token, and an open board is still not remounted by a click.
   *
   * ⚠ MUTATION-VERIFIED — one revert, one failure: restoring
   * `if (tab === "overview")` in front of `index.tsx`'s `setTab("channels")`.
   */
  it("hands a channel pick to that channel's own face, from HERE", async () => {
    renderHome();
    await openOntologyFace();
    expect(screen.queryByTestId("channel-surface")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /Priya Shah/ }));

    await screen.findByRole("tab", { name: "Channel", selected: true });
    expect(await screen.findByTestId("channel-surface")).toBeInTheDocument();
  });

  it("keeps the board's OWN chrome — the black + Object, and no cluster delete", async () => {
    renderHome();
    await openOntologyFace();

    // 🔒 THE HEADER BUTTON IS "+ Object" AND IT IS THE BLACK PAGE PILL (Samuel,
    // 2026-09-10). There is no "+ Column" anywhere on the board since 09-11.
    const object = screen.getByRole("button", { name: "Object" });
    expect(object.className).toMatch(/auth-btn-3d/);
    expect(object.className).toMatch(/h-9/);
    expect(screen.queryByRole("button", { name: "Column" })).toBeNull();
    // 🔒 The delete that names CHANNELS is the host's, in the gear menu — the
    // view's own trash would delete with no such sentence (Q4).
    expect(screen.queryByRole("button", { name: /^Delete Pipeline/ })).toBeNull();
  });

  /**
   * 🔒 **THE DOTTED GRID, ON THE WHITE PANEL — BOTH AT ONCE** (Samuel, 2026-09-11:
   * *"I don't see the dots, the dotted grid. I want to bring that dotted grid
   * back"*, alongside his 2026-09-10 *"double panel"* ruling, which stands).
   *
   * ⚠ THE TWO ARE NOT IN TENSION AND THIS TEST IS WHY BOTH ARE PINNED TOGETHER:
   * the grid paints DOTS and no fill, so the board stays one panel. The thing
   * that was deleted on 09-10 and must never come back is a background COLOUR on
   * the scroller.
   *
   * ⚠ MUTATION-VERIFIED — one revert, one failure: taking `graph-substrate
   * kanban-substrate` back off `kanban-board.tsx`'s scroller (every other
   * assertion on this face passes with the grid gone).
   */
  it("draws the dotted grid, and still only ONE panel under it", async () => {
    renderHome();
    await openOntologyFace();
    await screen.findByText("Acme");

    const scroller = document.querySelector(".kanban-substrate");
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toMatch(/graph-substrate/);
    // 🔒 NO FILL ON THE SCROLLER — the dots are the whole decoration.
    expect(scroller!.className).not.toMatch(/\bbg-/);
    // …and no second `.page-float` inside the pane either (Samuel, 2026-09-10:
    // *"the ontology is still on a gray panel. That is on the white panel"*) —
    // the view is `frameless` on /home.
    expect(document.querySelector(".page-float .page-float")).toBeNull();
    expect(document.querySelectorAll(".page-float").length).toBeLessThanOrEqual(1);
  });

  /**
   * 🔒 **THE LANE'S GRAY IS THE TAB-SWITCHER PANEL'S** (Samuel, 2026-09-11: *"I
   * want it to be the same gray that appears on the panel holding the tab
   * switcher. Right now, it's a different gray, and I don't like that"*).
   *
   * ⚠ ASSERTED AS THE TOKEN, not a colour: jsdom loads no stylesheet, so the
   * utility class IS the contract — and `--home-panel` is exactly what the header
   * strip's own panel paints (`pages/home/index.tsx`, `page-float bg-home-panel`).
   *
   * ⚠ MUTATION-VERIFIED — one revert, one failure: putting `bg-bg-inset` back on
   * `kanban-board.tsx › Column` (the lanes render, the board renders, and only
   * the token says the two grays disagree again).
   */
  it("paints the lanes in the header panel's own gray", async () => {
    renderHome();
    await openOntologyFace();
    await screen.findByText("Acme");
    // The lane is the board's own `w-72` column wrapper.
    const lane = document.querySelector(".w-72");

    expect(lane).not.toBeNull();
    expect(lane!.className).toMatch(/bg-home-panel/);
    expect(lane!.className).not.toMatch(/bg-bg-inset/);
  });

  /**
   * 🔒 THE DESCRIPTION FIELD (Samuel, 2026-09-10: *"Put in there, Description as
   * the hint, and make it have a gray underline that turns black when a user is
   * editing (like the one we have in other places)"*).
   *
   * ⚠ `.lineActive` IS THE CONTRACT, not `:focus-within` — jsdom loads no
   * stylesheet, so the sweep is a class the field toggles
   * (`shared/ui/form-dialog.module.css`).
   */
  it("hints `Description` on the shared underline field, black while editing", async () => {
    renderHome();
    await openOntologyFace();

    const field = screen.getByLabelText("Description");
    expect(field.getAttribute("placeholder")).toBe("Description");
    expect(field.className).toMatch(/input/);
    // 🔒 AS TALL AS THE BLACK BUTTON beside it — the hairline sits flush with
    // that button's bottom (Samuel, 2026-09-10: *"pushing the underline down so
    // that it sits flush with the bottom of the + button"*).
    expect(field.className).toMatch(/inputAction/);
    const line = field.parentElement;
    expect(line?.className).toMatch(/line/);
    expect(line?.className).not.toMatch(/lineActive/);
    fireEvent.focus(field);
    expect(field.parentElement?.className).toMatch(/lineActive/);
    fireEvent.blur(field);
    expect(field.parentElement?.className).not.toMatch(/lineActive/);

    // Same save path as the sentence-placeholder input it replaced.
    fireEvent.change(field, { target: { value: "Deals in flight, revised" } });
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).some(
          (c) =>
            c.path === `/api/ontology/clusters/${PIPELINE_ID}` &&
            c.opts.method === "PATCH"
        )
      ).toBe(true)
    );
  });

  /**
   * 🔒 ONE PLACE PER CONTROL — the gear's "+ Column" row is DELETED (2026-09-11).
   * It made the same thing the header button now makes, under a word the UI no
   * longer uses.
   */
  it("has no + Column row left in the gear", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();

    const menu = within(screen.getByRole("menu"));
    expect(menu.queryByRole("menuitem", { name: "Column" })).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
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

    await waitFor(() => expect(ontologyName()).toBe("Roster"));
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

    // 🔒 THE CREATE IS A ROW IN THE NAME DROPDOWN (Samuel, 2026-09-10: *"move the
    // + ontology button, make it a button/option in the ontology dropdown
    // selector"*) — there is no black "+ Ontology" in the header any more.
    expect(screen.queryByRole("button", { name: "Ontology" })).toBeNull();
    await createOntologyFromSwitcher();

    await waitFor(() => {
      const post = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/ontology/clusters" && c.opts.method === "POST"
      );
      expect(post?.opts.workspaceId).toBe(PERSONAL_WORKSPACE_ID);
    });
    await waitFor(() => expect(ontologyName()).toBe("New cluster"));
    expect(NEW_CLUSTER_ID).toBe("cluster-new");
  });

  /**
   * 🔒 **AND IT LANDS THERE AFTER THE BOARD HAS BEEN EDITED, WHICH IS THE CASE
   * THAT BROKE.** One keystroke sets `use-ontology.ts › dirtyRef`, after which the
   * reducer ignores every later snapshot — so the pin /home moves to the minted id
   * named a cluster the board had never heard of, and the pane read "This ontology
   * is no longer here.", its sentence for a DELETED one. The host's `boardEpoch`
   * `key` is the fix and its docblock carries why a remount is safe.
   * ⚠ MUTATION-VERIFIED — one revert (drop that `key`), one failure.
   */
  it("lands on the new ontology even when the board has unsaved local edits", async () => {
    renderHome();
    await openOntologyFace();

    // One keystroke is all it takes: every dispatch sets the store's dirty flag.
    fireEvent.change(await screen.findByLabelText("Description"), {
      target: { value: "Deals in flight, edited" },
    });
    await createOntologyFromSwitcher();

    await waitFor(() => expect(ontologyName()).toBe("New cluster"));
    expect(screen.queryByText("This ontology is no longer here.")).toBeNull();
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
    await screen.findByTitle("Switch ontology");
    expect(ontologyName()).toBe("Pipeline");
  });
});
