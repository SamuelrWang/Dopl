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
 * KNOWLEDGE HOME — the `/knowledge` mode. Three properties a later "small"
 * change takes away silently:
 *
 *   1. **Root is a destination.** Nothing auto-selects a base out of it; the
 *      address bar is untouched until the user moves.
 *   2. **A grid of N bases costs ONE request.** Card meta comes from
 *      `baseStats` on the list response, never a per-card tree fetch.
 *   3. **Crossing modes does not remount.** Both route rows render the same
 *      component type, so controller state (search text, loaded trees)
 *      survives a round trip out and back.
 */

describe("knowledge home grid", () => {
  beforeEach(installKnowledgeBridge);

  it("lands on the CARD GRID, one card per base, and mounts no trees", async () => {
    renderAt(`/${SEGMENT}/knowledge`);

    const specs = await screen.findByRole("article", { name: "Product specs" });
    expect(screen.getByRole("article", { name: "Sales playbook" })).toBeInTheDocument();
    expect(screen.getByLabelText("New knowledge base")).toBeInTheDocument();

    // ⚠ Card meta comes from the LIST response's `baseStats` + `ownerNames`:
    // a grid of N bases costs ONE request, so no tree may be fetched here.
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
    // One key: page and controller both read via `useKnowledgeBaseList`.
    expect(paths().filter((p) => p === "/api/knowledge/bases")).toHaveLength(1);
  });

  it("filters the grid live, and the scope pills carry per-scope counts", async () => {
    renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Sales playbook" });

    // Both fixtures private → counts 2/2/0/0. Pills are cut from the
    // SEARCH-filtered list, BEFORE the scope filter runs.
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
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "All1",
      "Private1",
      "Team0",
      "Public0",
    ]);
    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "zzz" },
    });
    expect(screen.getByLabelText("New knowledge base")).toBeInTheDocument();
  });

  it("opens a card, then returns via the crumb, WITHOUT remounting the view", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    const salesCard = await screen.findByRole("article", { name: "Sales playbook" });

    // ⚠ Transient view state: survives only if the component instance does.
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
    // A card click selects the BASE, not an entry.
    await screen.findAllByText("Discovery call");

    // ⚠ Round trip index → :kbSlug → index is the proof: both rows render the
    // same component type, so react-router reconciles instead of remounting. A
    // remount anywhere here would reset the search text.
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
    fireEvent.click(screen.getByRole("article", { name: "Sales playbook" }));
    await screen.findAllByText("Discovery call");
    expect(
      paths().filter((p) => p === "/api/knowledge/bases/base-b/tree")
    ).toHaveLength(1);
  });

  it("Back returns to the previous mode without a clobbering re-write", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    // Every navigation in order — the only way to catch a second, stale write.
    const moves: string[] = [];
    router.subscribe((state) => {
      moves.push(`${state.historyAction} ${state.location.pathname}`);
    });

    await screen.findByRole("article", { name: "Product specs" });
    expect(moves).toEqual([]);

    fireEvent.click(screen.getByRole("article", { name: "Product specs" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge/${BASE_A_SEG}`);
    });
    expect(moves).toEqual([`PUSH /${SEGMENT}/knowledge/${BASE_A_SEG}`]);

    await router.navigate(-1);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge`);
    });
    // ⚠ Exactly ONE POP lands: the write effect must not re-assert the pre-Back
    // selection over it or push a truncating entry.
    expect(moves).toEqual([
      `PUSH /${SEGMENT}/knowledge/${BASE_A_SEG}`,
      `POP /${SEGMENT}/knowledge`,
    ]);
    expect(
      await screen.findByRole("article", { name: "Sales playbook" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New knowledge base")).toBeInTheDocument();
  });

});

/**
 * PER-USER STARS end to end: real hook, real query cache, fake server. What a
 * reducer unit test cannot show — grid moves on the CLICK, not the round trip,
 * and a failed write puts the card back instead of leaving the screen
 * describing a state the server never reached.
 */
describe("knowledge home stars", () => {
  beforeEach(installKnowledgeBridge);

  function order(): string[] {
    return screen
      .getAllByRole("article")
      .map((el) => el.getAttribute("aria-label") ?? "");
  }

  it("reorders while the write is STILL IN FLIGHT, then keeps it", async () => {
    // ⚠ Star request is HELD, so everything asserted before `settleStarWrites`
    // is optimistic by construction: a grid that reordered only on the server's
    // answer would sit still until the test timed out.
    deferStarWrites();
    renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Product specs" });
    expect(order()).toEqual(["Product specs", "Sales playbook"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Bookmark Sales playbook" })
    );

    await waitFor(() => {
      expect(order()).toEqual(["Sales playbook", "Product specs"]);
    });
    expect(
      screen.getByRole("button", { name: "Remove bookmark from Sales playbook" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(paths()).toContain("/api/knowledge/bases/base-b/star");

    settleStarWrites("ok");

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

    fireEvent.click(
      screen.getByRole("button", { name: "Bookmark Sales playbook" })
    );
    await waitFor(() => {
      expect(order()).toEqual(["Sales playbook", "Product specs"]);
    });

    settleStarWrites("fail");

    // ⚠ Whole cache entry restored from the snapshot, so star + order + every
    // other fold go back together. Entry count below proves the rollback did
    // not narrow the entry to the one key the write touched.
    await waitFor(() => {
      expect(order()).toEqual(["Product specs", "Sales playbook"]);
    });
    expect(
      screen.getByRole("button", { name: "Bookmark Sales playbook" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "Sales playbook" }).textContent)
      .toContain("2 entries");
  });

  it("does not open the base when the star is clicked", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Sales playbook" });

    fireEvent.click(
      screen.getByRole("button", { name: "Bookmark Sales playbook" })
    );

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

    fireEvent.click(
      screen.getByRole("button", { name: "Bookmark Sales playbook" })
    );

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(before);
  });
});
