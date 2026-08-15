// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../../types";
import type { ListFilter } from "../types";
import { HERO_CHAT_PLACEHOLDER } from "./hero-chat";
import { KnowledgeHome } from "./knowledge-home";

/**
 * The `/knowledge` mode: a card grid, not a list pane.
 *
 * The properties worth pinning are the ones a redesign quietly loses. The
 * meta line is fed by `baseStats` from the LIST response — if a future edit
 * derives the count from a loaded tree instead, the grid silently becomes N
 * requests, so the count is asserted against a base whose tree is never
 * fetched here. The pill counts are cut BEFORE the scope filter, which is the
 * only way an unselected pill's badge means anything. And the create cell is
 * outside the filtered set, so a query matching nothing still offers a way
 * forward instead of a dead end.
 *
 * THE CARD'S ELEMENT SEMANTICS CHANGED 2026-08-12 and this file is where that
 * is pinned. It was ONE `<button>` wrapping the whole card, and the assertion
 * here was "no nested interactive, no flow content" — which the star toggle
 * makes impossible to keep as written: a second control cannot live inside a
 * button. The card is now an `<article>` with TWO sibling buttons in its
 * footer. **The property being defended did not change** — no `<button>`
 * inside a `<button>`, ever — only the structure it is asserted against, and
 * the pair below (`no nested interactive` / `both controls reachable`) is the
 * same guarantee restated for the new shape.
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

/** ONE card, by the base it is about. The container is an `<article>` labelled
 *  with the base name — its controls are named `Open {name}` / `Star {name}`,
 *  so a role+name query for a BUTTON would be ambiguous by design. */
function card(name: string) {
  return screen.getByRole("article", { name });
}

/** The cards, in render order — what the star sort is asserted against. */
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

    // Empty description is a placeholder, not a blank well.
    expect(card("Runbooks").textContent).toContain("No description");
    expect(card("Sales playbook").textContent).toContain("Public");
  });

  it("builds the meta line from the LIST response's counters, not a tree", () => {
    renderHome();
    // Singular/plural, and the owner: "You" for one's own base, the resolved
    // display name for another member's.
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
    // Zero is a REAL value: an empty base gets an empty bar, not no bar.
    expect(card("Runbooks").textContent).toContain("0 B / 5 MB");
  });

  it("draws NO bar when the cap is unknown — missing is unknown, never zero", () => {
    // An old server (or a failed billing read) sends no cap. Drawing one
    // against a guessed limit would assert a fact nobody measured.
    renderHome({ kbStorageLimit: null });
    expect(card("Product specs").textContent).not.toContain("MB /");
    // The rest of the card is untouched.
    expect(card("Product specs").textContent).toContain("12 entries");
  });

  it("draws NO bar for a base whose counter is unknown", () => {
    // The deploy-order case, per base: counts survive, the bar does not.
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
    // Gates FREEZE. The note has to say the data is intact and that the way
    // out (delete, or a smaller edit) still works.
    expect(text).toContain("Nothing was deleted");
    expect(text).toContain("still works");
  });

  it("nests no interactive element inside another", () => {
    // The property the old one-button card held by construction, now held by
    // structure: the card is an <article>, so its two controls are SIBLINGS.
    // A <button> inside a <button> is invalid HTML — browsers reparent the
    // inner one out of the card entirely, so it is not merely unreachable by
    // keyboard, it ends up somewhere else in the document.
    renderHome();
    const specs = card("Product specs");
    expect(specs.tagName).toBe("ARTICLE");
    expect(specs.querySelector("button button")).toBeNull();
    expect(specs.querySelector("a button")).toBeNull();
    // Exactly two controls, and no more: one star, one Open.
    expect(within(specs).getAllByRole("button")).toHaveLength(2);
  });

  it("keeps BOTH controls keyboard-reachable, and names each by its base", () => {
    // A grid of cards otherwise presents N buttons all called "Open", which a
    // screen reader cannot tell apart. Neither control is hidden from the
    // accessibility tree, and neither is a div wearing a click handler.
    renderHome();
    const specs = card("Product specs");
    const [star, open] = within(specs).getAllByRole("button");
    expect(star.getAttribute("aria-label")).toBe("Star Product specs");
    expect(open.getAttribute("aria-label")).toBe("Open Product specs");
    // Tab order is DOM order: star first (it sits at the footer's left), Open
    // last. Neither carries a tabindex that would reorder or remove it.
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
    // The card keeps a click handler as a MOUSE shortcut for the Open button.
    // Its own handler plus the button's would both fire on a click of Open if
    // the button did not stop propagation, and the base would open twice.
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
    // `aria-pressed` is what makes this a TOGGLE rather than two buttons that
    // happen to look different. A colour swap alone says nothing to a screen
    // reader, and the label has to name the ACTION, not the state.
    renderHome({ starredBaseIds: ["kb-2"] });

    const unstarred = screen.getByRole("button", { name: "Star Product specs" });
    expect(unstarred.getAttribute("aria-pressed")).toBe("false");

    const starred = screen.getByRole("button", { name: "Unstar Runbooks" });
    expect(starred.getAttribute("aria-pressed")).toBe("true");
  });

  it("asks for the OPPOSITE state, and does not open the base", () => {
    // The toggle sends the end state it wants (the route's two verbs are
    // idempotent), and it stops propagation — clicking the star inside a card
    // whose container opens on click must not also navigate.
    const props = renderHome({ starredBaseIds: ["kb-2"] });

    fireEvent.click(screen.getByRole("button", { name: "Star Product specs" }));
    expect(props.onToggleStar).toHaveBeenCalledWith("kb-1", true);

    fireEvent.click(screen.getByRole("button", { name: "Unstar Runbooks" }));
    expect(props.onToggleStar).toHaveBeenCalledWith("kb-2", false);

    expect(props.onOpenBase).not.toHaveBeenCalled();
  });

  it("lifts starred bases to the FRONT, keeping list order within each group", () => {
    // THE LIST ORDER HERE IS DELIBERATELY NOT ALPHABETICAL, and that is what
    // makes the assertion mean something: "Sales playbook" comes before
    // "Runbooks" only because the caller's array says so. A comparator that
    // fell back to the name — or to the star order in `starredBaseIds`, which
    // is `["kb-3", "kb-2"]` here — would produce the other answer.
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
    // A star is a view concern: it moves a card, it does not add one. The
    // badges are cut upstream, before the scope pill, so they are the same
    // numbers whether or not anything is starred.
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
    // The server narrows `starredBaseIds` to the visible bases, but the client
    // holds it across a search too — an id with no card must simply not
    // participate rather than push a phantom to the front.
    renderHome({ bases: [PRIVATE], starredBaseIds: ["kb-2", "kb-99"] });
    expect(cardNames()).toEqual(["Product specs"]);
  });
});

/**
 * THE HERO CHAT is WIRED HERE and behaves in `hero-chat.test.tsx`. What this
 * file owns is the ATTACHMENT: the chat is part of the HERO, not a sibling of
 * it, so it lives and dies with the bundled image. That is the whole reason
 * every other test above still sees the page it always saw — the default (web,
 * and this suite) passes no `heroImageSrc`.
 */
describe("KnowledgeHome hero chat wiring", () => {
  const HERO = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

  it("renders NOTHING without a hero image", () => {
    renderHome();
    expect(screen.queryByPlaceholderText(HERO_CHAT_PLACEHOLDER)).toBeNull();
    expect(screen.queryByLabelText("Dictate a message")).toBeNull();
  });

  it("attaches the chat INSIDE the hero container, below the image", () => {
    renderHome({ heroImageSrc: HERO });

    const field = screen.getByPlaceholderText(HERO_CHAT_PLACEHOLDER);
    const img = document.querySelector("img[alt='']");
    expect(img).not.toBeNull();

    // ONE container holding both bands: the rounded, bordered `.homeHero`
    // clips the image's top corners and the chat's bottom ones, which is what
    // makes them read as a single unit. A chat rendered as a SIBLING of the
    // hero would fail this while looking almost right.
    const hero = (img as HTMLElement).closest("div")?.parentElement ?? null;
    expect(hero).not.toBeNull();
    expect(hero!.contains(field)).toBe(true);
    // The image band is not the chat's parent — the chat is below it, not
    // stacked over the picture.
    expect((img as HTMLElement).parentElement!.contains(field)).toBe(false);
  });
});
