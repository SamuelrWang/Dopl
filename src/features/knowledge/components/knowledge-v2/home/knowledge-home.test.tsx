// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../../types";
import type { ListFilter } from "../types";
import { KnowledgeHome } from "./knowledge-home";

/**
 * `/knowledge` card grid. Properties pinned here, because a redesign loses them
 * quietly:
 *  - meta line comes from `baseStats` on the LIST response; deriving counts
 *    from a loaded tree turns the grid into N requests.
 *  - pill counts are cut BEFORE the scope filter.
 *  - create cell sits outside the filtered set (no-match ≠ dead end).
 *  - ⚠ no `<button>` inside a `<button>`: card is an `<article>` with two
 *    sibling footer buttons.
 */

afterEach(cleanup);

const ME = "u-me";

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb-1",
    slug: "specs",
    publicId: "aaaaaaaaaaaa",
    name: "Product specs",
    description: "What we ship",
    visibility: "private",
    accessMode: "workspace",
    createdBy: ME,
    updatedAt: new Date().toISOString(),
    ...over,
  } as KnowledgeBase;
}

const PRIVATE = base();
const TEAM = base({
  id: "kb-2",
  slug: "runbooks",
  name: "Runbooks",
  description: null,
  visibility: "public",
  accessMode: "teams",
  createdBy: "u-other",
});
const SHARED = base({
  id: "kb-3",
  slug: "sales",
  name: "Sales playbook",
  description: "How we sell",
  visibility: "public",
  accessMode: "workspace",
});

const STATS: Record<string, KnowledgeBaseStats> = {
  "kb-1": {
    entryCount: 12,
    lastEntryUpdatedAt: new Date().toISOString(),
    storageBytes: 4_231_000,
  },
  "kb-2": { entryCount: 1, lastEntryUpdatedAt: null, storageBytes: 0 },
};

function renderHome(
  over: Partial<React.ComponentProps<typeof KnowledgeHome>> = {}
) {
  const props = {
    bases: [PRIVATE, TEAM, SHARED],
    filterCounts: { all: 3, private: 1, team: 1, workspace: 1 } as Record<
      ListFilter,
      number
    >,
    baseStats: STATS,
    kbStorageLimit: 5_000_000,
    ownerNames: { "u-other": "Dana Reed" },
    starredBaseIds: [] as string[],
    currentUserId: ME,
    query: "",
    onQueryChange: vi.fn(),
    filter: "all" as ListFilter,
    onFilterChange: vi.fn(),
    onOpenBase: vi.fn(),
    onToggleStar: vi.fn(),
    onCreate: vi.fn(),
    ...over,
  };
  render(<KnowledgeHome {...props} />);
  return props;
}

/** Container is an `<article>` labelled by base name; controls are
 *  `Open {name}` / `Bookmark {name}`, so a BUTTON role+name query is
 *  ambiguous. */
function card(name: string) {
  return screen.getByRole("article", { name });
}

function cardNames(): string[] {
  return screen
    .getAllByRole("article")
    .map((el) => el.getAttribute("aria-label") ?? "");
}

describe("KnowledgeHome grid", () => {
  it("renders one card per visible base, with scope and description", () => {
    renderHome();

    expect(card("Product specs").textContent).toContain("Private");
    expect(card("Product specs").textContent).toContain("What we ship");

    expect(card("Runbooks").textContent).toContain("No description");
    expect(card("Sales playbook").textContent).toContain("Public");
  });

  it("builds the meta line from the LIST response's counters, not a tree", () => {
    renderHome();
    expect(card("Product specs").textContent).toContain("12 entries");
    expect(card("Product specs").textContent).toContain("By You");
    expect(card("Runbooks").textContent).toContain("1 entry ");
    expect(card("Runbooks").textContent).toContain("By Dana Reed");
  });

  it("omits the count rather than claiming zero when stats are missing", () => {
    renderHome({ baseStats: {} });
    expect(card("Product specs").textContent).not.toContain("entries");
    expect(card("Product specs").textContent).toContain("updated");
  });

  it("draws a storage bar per card, in human bytes against the plan cap", () => {
    renderHome();
    expect(card("Product specs").textContent).toContain("4.2 MB / 5 MB");
    // Zero is a REAL value: empty base gets an empty bar, not no bar.
    expect(card("Runbooks").textContent).toContain("0 B / 5 MB");
  });

  it("draws NO bar when the cap is unknown — missing is unknown, never zero", () => {
    // A bar against a guessed limit asserts a fact nobody measured.
    renderHome({ kbStorageLimit: null });
    expect(card("Product specs").textContent).not.toContain("MB /");
    expect(card("Product specs").textContent).toContain("12 entries");
  });

  it("draws NO bar for a base whose counter is unknown", () => {
    renderHome({
      baseStats: {
        "kb-1": { entryCount: 12, lastEntryUpdatedAt: null, storageBytes: null },
      },
    });
    expect(card("Product specs").textContent).toContain("12 entries");
    expect(card("Product specs").textContent).not.toContain("MB /");
  });

  it("marks a full base as over, and says what did NOT stop", () => {
    renderHome({
      baseStats: {
        "kb-1": {
          entryCount: 12,
          lastEntryUpdatedAt: null,
          storageBytes: 5_000_000,
        },
      },
    });
    const text = card("Product specs").textContent ?? "";
    expect(text).toContain("5 MB / 5 MB");
    // Gates FREEZE: note must say data is intact and the way out still works.
    expect(text).toContain("Nothing was deleted");
    expect(text).toContain("still works");
  });

  it("nests no interactive element inside another", () => {
    // ⚠ `<button>` inside `<button>` is invalid HTML — browsers reparent the
    // inner one OUT of the card, so it lands elsewhere in the document.
    renderHome();
    const specs = card("Product specs");
    expect(specs.tagName).toBe("ARTICLE");
    expect(specs.querySelector("button button")).toBeNull();
    expect(specs.querySelector("a button")).toBeNull();
    expect(within(specs).getAllByRole("button")).toHaveLength(2);
  });

  it("keeps BOTH controls keyboard-reachable, and names each by its base", () => {
    // Otherwise the grid is N buttons all called "Open".
    renderHome();
    const specs = card("Product specs");
    const [star, open] = within(specs).getAllByRole("button");
    expect(star.getAttribute("aria-label")).toBe("Bookmark Product specs");
    expect(open.getAttribute("aria-label")).toBe("Open Product specs");
    expect(star.getAttribute("tabindex")).toBeNull();
    expect(open.getAttribute("tabindex")).toBeNull();
  });

  it("puts the per-scope counts on the filter pills", () => {
    renderHome();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "All3",
      "Private1",
      "Team1",
      "Public1",
    ]);
  });

  it("opens a base from the ONE Open button", () => {
    const props = renderHome();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Product specs" })
    );
    expect(props.onOpenBase).toHaveBeenCalledTimes(1);
    expect(props.onOpenBase).toHaveBeenCalledWith(PRIVATE);
  });

  it("still opens on a click anywhere on the card — ONCE, not twice", () => {
    // ⚠ Card click handler is a MOUSE shortcut for Open; without the button
    // stopping propagation both fire and the base opens twice.
    const props = renderHome();
    fireEvent.click(card("Product specs"));
    expect(props.onOpenBase).toHaveBeenCalledTimes(1);

    (props.onOpenBase as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open Runbooks" }));
    expect(props.onOpenBase).toHaveBeenCalledTimes(1);
  });

  it("fires onCreate from the trailing new-base cell, even with no matches", () => {
    const props = renderHome({
      bases: [],
      query: "nothing matches",
      filterCounts: { all: 0, private: 0, team: 0, workspace: 0 },
    });
    fireEvent.click(screen.getByLabelText("New knowledge base"));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it("reports typing up to the controller instead of filtering locally", () => {
    const props = renderHome();
    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "sales" },
    });
    expect(props.onQueryChange).toHaveBeenCalledWith("sales");
  });
});

describe("KnowledgeHome stars", () => {
  it("puts the star state in the accessibility tree, not only the fill", () => {
    // `aria-pressed` makes this a TOGGLE; the label names the ACTION.
    renderHome({ starredBaseIds: ["kb-2"] });

    const unstarred = screen.getByRole("button", {
      name: "Bookmark Product specs",
    });
    expect(unstarred.getAttribute("aria-pressed")).toBe("false");

    const starred = screen.getByRole("button", {
      name: "Remove bookmark from Runbooks",
    });
    expect(starred.getAttribute("aria-pressed")).toBe("true");
  });

  it("asks for the OPPOSITE state, and does not open the base", () => {
    // Sends the END state (route verbs are idempotent) and stops propagation.
    const props = renderHome({ starredBaseIds: ["kb-2"] });

    fireEvent.click(
      screen.getByRole("button", { name: "Bookmark Product specs" })
    );
    expect(props.onToggleStar).toHaveBeenCalledWith("kb-1", true);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove bookmark from Runbooks" })
    );
    expect(props.onToggleStar).toHaveBeenCalledWith("kb-2", false);

    expect(props.onOpenBase).not.toHaveBeenCalled();
  });

  it("lifts starred bases to the FRONT, keeping list order within each group", () => {
    // ⚠ List order here is DELIBERATELY NOT ALPHABETICAL: "Sales playbook"
    // precedes "Runbooks" only because the caller's array says so. A comparator
    // falling back to name — or to `starredBaseIds` order (`["kb-3","kb-2"]`)
    // — gives the other answer.
    renderHome({
      bases: [SHARED, PRIVATE, TEAM],
      starredBaseIds: ["kb-3", "kb-2"],
    });
    expect(cardNames()).toEqual([
      "Sales playbook",
      "Runbooks",
      "Product specs",
    ]);
  });

  it("keeps the UNSTARRED group in list order too", () => {
    renderHome({ bases: [SHARED, PRIVATE, TEAM], starredBaseIds: ["kb-2"] });
    expect(cardNames()).toEqual([
      "Runbooks",
      "Sales playbook",
      "Product specs",
    ]);
  });

  it("leaves the order alone when nothing is starred", () => {
    renderHome({ bases: [SHARED, PRIVATE, TEAM] });
    expect(cardNames()).toEqual([
      "Sales playbook",
      "Product specs",
      "Runbooks",
    ]);
  });

  it("sorts WITHIN the filtered results, and never changes the pill counts", () => {
    // Badges are cut upstream of the scope pill, so stars can't change them.
    renderHome({
      bases: [PRIVATE, SHARED],
      starredBaseIds: ["kb-3"],
      filterCounts: { all: 2, private: 1, team: 0, workspace: 1 },
    });
    expect(cardNames()).toEqual(["Sales playbook", "Product specs"]);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "All2",
      "Private1",
      "Team0",
      "Public1",
    ]);
  });

  it("ignores a star for a base this grid is not rendering", () => {
    // Client holds `starredBaseIds` across a search: an id with no card must
    // not push a phantom to the front.
    renderHome({ bases: [PRIVATE], starredBaseIds: ["kb-2", "kb-99"] });
    expect(cardNames()).toEqual(["Product specs"]);
  });
});

/**
 * THE HERO IS A DECORATIVE BAND AND NOTHING ELSE (Samuel's ruling, 2026-08-30 —
 * ledger ASK-5). `home/hero-chat.tsx › HeroChat` hung under this image and is
 * DELETED: a composer, an auto-grow textarea, an IME guard, a live region and a
 * hardcoded reply, wired to nothing, live on a workspace page.
 *
 * ⚠ THE ABSENCE IS THE ASSERTION, and it is written against the CONTROLS rather
 * than against the component, so re-adding the same fake chat under a new name
 * fails it too. The three probes below are the composer's own affordances: a
 * textbox, a send control, a dictation toggle.
 *
 * ⚠ MUTATION-VERIFY: restoring `<HeroChat />` under the band turns the second
 * case red on all three probes, and leaves the first (no image → no hero) green
 * — which is why both are here.
 */
describe("KnowledgeHome hero", () => {
  const HERO = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

  it("renders no hero at all without a bundled image", () => {
    renderHome();
    expect(document.querySelector("img[alt='']")).toBeNull();
  });

  it("renders the image band and NO chat under it", () => {
    renderHome({ heroImageSrc: HERO });

    const img = document.querySelector("img[alt='']");
    expect(img).not.toBeNull();

    // The hero container (`.homeHero`) — the band's parent.
    const hero = (img as HTMLElement).closest("div")?.parentElement ?? null;
    expect(hero).not.toBeNull();
    expect(within(hero!).queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText("Send to the assistant")).toBeNull();
    expect(screen.queryByLabelText("Dictate a message")).toBeNull();
  });
});
