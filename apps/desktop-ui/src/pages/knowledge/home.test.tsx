import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BASE_A_SEG,
  BASE_B_SEG,
  SEGMENT,
  deferStarWrites,
  installKnowledgeBridge,
  paths,
  renderAt,
  settleStarWrites,
} from "./test-fixtures";

/**
 * KNOWLEDGE HOME — the `/knowledge` mode.
 *
 * Three properties this suite exists to keep true, all of them things a later
 * "small" change takes away silently:
 *
 *   1. **The root is a destination.** Nothing auto-selects a base out of it,
 *      so the grid is reachable and the address bar is untouched until the
 *      user moves. The old behaviour rewrote `/knowledge` onto the first (or
 *      last-opened) base before first paint.
 *   2. **A grid of N bases costs ONE request.** The card meta comes from
 *      `baseStats` on the list response; a tree fetch here would mean the
 *      counts were re-derived per card.
 *   3. **Crossing between the modes does not remount.** Both route rows
 *      render the same component type, so the controller's state (the search
 *      text, the loaded trees) survives a round trip out and back.
 */

describe("knowledge home grid", () => {
  beforeEach(installKnowledgeBridge);

  it("lands on the CARD GRID, one card per base, and mounts no trees", async () => {
    renderAt(`/${SEGMENT}/knowledge`);

    // The knowledge root is a landing page now, not a two-pane view with a
    // base auto-selected into it — nothing rewrites the URL onto a base.
    const specs = await screen.findByRole("article", { name: "Product specs" });
    expect(screen.getByRole("article", { name: "Sales playbook" })).toBeInTheDocument();
    expect(screen.getByLabelText("New knowledge base")).toBeInTheDocument();

    // The card meta comes from the LIST response's `baseStats` + `ownerNames`.
    // THE POINT OF THE SERVER-SIDE COUNT: a grid of N bases costs ONE request,
    // so no tree may be fetched to fill these numbers in.
    expect(specs.textContent).toContain("0 entries");
    expect(
      screen.getByRole("article", { name: "Sales playbook" }).textContent
    ).toContain("2 entries");
    expect(screen.getByRole("article", { name: "Sales playbook" }).textContent).toContain(
      "By Dana Reed"
    );
    expect(paths().filter((p) => p.includes("/tree"))).toEqual([]);

    expect(paths()).toContain("/api/knowledge/bases");
    expect(paths()).toContain(`/api/workspaces/${SEGMENT}/teams`);
    // One request for the list, not one per consumer: the page and the
    // controller both read it through `useKnowledgeBaseList`, one key.
    expect(paths().filter((p) => p === "/api/knowledge/bases")).toHaveLength(1);
  });

  it("filters the grid live, and the scope pills carry per-scope counts", async () => {
    renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Sales playbook" });

    // Both fixtures are private, so the counts are 2/2/0/0 — the pills are
    // cut from the SEARCH-filtered list, before the scope filter runs.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "All2",
      "Private2",
      "Team0",
      "Public0",
    ]);

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "sales" },
    });

    expect(screen.queryByRole("article", { name: "Product specs" })).toBeNull();
    expect(screen.getByRole("article", { name: "Sales playbook" })).toBeInTheDocument();
    // …and the counts follow the query.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "All1",
      "Private1",
      "Team0",
      "Public0",
    ]);
    // The create cell is not a search result — it survives an empty match.
    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "zzz" },
    });
    expect(screen.getByLabelText("New knowledge base")).toBeInTheDocument();
  });

  it("opens a card, then returns via the crumb, WITHOUT remounting the view", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    const salesCard = await screen.findByRole("article", { name: "Sales playbook" });

    // Transient view state that only survives if the component instance does.
    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "sales" },
    });
    expect(screen.queryByRole("article", { name: "Product specs" })).toBeNull();

    fireEvent.click(salesCard);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${BASE_B_SEG}`
      );
    });
    // Opening a base lands on its OVERVIEW with the tree beside it — a card
    // click selects the base, not an entry.
    await screen.findAllByText("Discovery call");

    // Back out through the crumb — the round trip is what proves it: the
    // route match moved index → :kbSlug → index, and both rows render the
    // same component type, so react-router reconciles instead of remounting.
    // A remount anywhere in there would have reset the search text.
    fireEvent.click(
      within(screen.getByLabelText("Knowledge base breadcrumb")).getByRole("button", {
        name: "Knowledge",
      })
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge`);
    });
    expect(screen.getByPlaceholderText("Search")).toHaveValue("sales");
    expect(screen.queryByRole("article", { name: "Product specs" })).toBeNull();
    // …and the tree it loaded is still cached: no second fetch on re-open.
    fireEvent.click(screen.getByRole("article", { name: "Sales playbook" }));
    await screen.findAllByText("Discovery call");
    expect(
      paths().filter((p) => p === "/api/knowledge/bases/base-b/tree")
    ).toHaveLength(1);
  });

  it("Back returns to the previous mode without a clobbering re-write", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    // Every navigation the router performs, in order — the only way to prove
    // the write effect did NOT fire a second, stale one behind our back.
    const moves: string[] = [];
    router.subscribe((state) => {
      moves.push(`${state.historyAction} ${state.location.pathname}`);
    });

    await screen.findByRole("article", { name: "Product specs" });
    // The root is a real destination now: nothing auto-selects a base out of
    // it, so the address bar is untouched until the user moves.
    expect(moves).toEqual([]);

    fireEvent.click(screen.getByRole("article", { name: "Product specs" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge/${BASE_A_SEG}`);
    });
    // Opening a base is one PUSH — not a push plus a corrective replace.
    expect(moves).toEqual([`PUSH /${SEGMENT}/knowledge/${BASE_A_SEG}`]);

    await router.navigate(-1);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge`);
    });
    // The whole point: exactly ONE POP lands, and the write effect does not
    // re-assert the pre-Back selection over it or push a truncating entry.
    expect(moves).toEqual([
      `PUSH /${SEGMENT}/knowledge/${BASE_A_SEG}`,
      `POP /${SEGMENT}/knowledge`,
    ]);
    // And the view followed the URL, not just the address bar: back on the
    // grid, both cards, no detail pane.
    expect(
      await screen.findByRole("article", { name: "Sales playbook" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New knowledge base")).toBeInTheDocument();
  });

});

/**
 * PER-USER STARS, end to end: the real hook, the real query cache, the fake
 * server. What a unit test of the reducer cannot show is that the grid moves
 * on the CLICK rather than on the round trip, and that a failed write puts the
 * card back where it was instead of leaving the screen describing a state the
 * server never reached.
 */
describe("knowledge home stars", () => {
  beforeEach(installKnowledgeBridge);

  function order(): string[] {
    return screen
      .getAllByRole("article")
      .map((el) => el.getAttribute("aria-label") ?? "");
  }

  it("reorders while the write is STILL IN FLIGHT, then keeps it", async () => {
    // The star request is HELD. Everything asserted before `settleStarWrites`
    // is therefore optimistic by construction: a grid that only reordered on
    // the server's answer would sit still here until the test timed out.
    deferStarWrites();
    renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Product specs" });
    expect(order()).toEqual(["Product specs", "Sales playbook"]);

    fireEvent.click(screen.getByRole("button", { name: "Star Sales playbook" }));

    await waitFor(() => {
      expect(order()).toEqual(["Sales playbook", "Product specs"]);
    });
    expect(
      screen.getByRole("button", { name: "Unstar Sales playbook" })
    ).toHaveAttribute("aria-pressed", "true");
    // …and the request really is out and unanswered.
    expect(paths()).toContain("/api/knowledge/bases/base-b/star");

    settleStarWrites("ok");

    // The settle does not undo it, and nothing re-downloads the list to find
    // out what it already computed.
    await waitFor(() => {
      expect(
        paths().filter((p) => p === "/api/knowledge/bases")
      ).toHaveLength(1);
    });
    expect(order()).toEqual(["Sales playbook", "Product specs"]);
  });

  it("ROLLS BACK the order when the write fails", async () => {
    deferStarWrites();
    renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Product specs" });

    fireEvent.click(screen.getByRole("button", { name: "Star Sales playbook" }));
    await waitFor(() => {
      expect(order()).toEqual(["Sales playbook", "Product specs"]);
    });

    settleStarWrites("fail");

    // The whole cache entry is restored from the snapshot, so the star, the
    // order and every other fold on the same entry go back together — the
    // entry count below is the proof the rollback did not narrow the entry to
    // the one key the write touched.
    await waitFor(() => {
      expect(order()).toEqual(["Product specs", "Sales playbook"]);
    });
    expect(
      screen.getByRole("button", { name: "Star Sales playbook" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "Sales playbook" }).textContent)
      .toContain("2 entries");
  });

  it("does not open the base when the star is clicked", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Sales playbook" });

    fireEvent.click(screen.getByRole("button", { name: "Star Sales playbook" }));

    await waitFor(() => {
      expect(paths()).toContain("/api/knowledge/bases/base-b/star");
    });
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge`);
    expect(paths().filter((p) => p.includes("/tree"))).toEqual([]);
  });

  it("leaves the scope-pill counts alone — a star reorders, it does not filter", async () => {
    renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Product specs" });
    const before = screen.getAllByRole("tab").map((t) => t.textContent);

    fireEvent.click(screen.getByRole("button", { name: "Star Sales playbook" }));

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(before);
  });
});
