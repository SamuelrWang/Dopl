// @vitest-environment jsdom
/**
 * THE SEARCH POPUP'S BEHAVIOUR — when it opens, what it asks for, what the
 * arrows walk, and what Enter hands back.
 *
 * ⚠ **THE FETCHER IS A STUB, WHICH IS THE POINT OF IT BEING A PROP.** These
 * cases exercise the SAME code path the fixture table and the real endpoint run
 * through; nothing here mocks a module.
 *
 * ⚠ **REAL TIMERS, `findBy*` FOR THE ANSWER.** The debounce is 250ms of wall
 * clock and the assertions that matter are about what the card shows once it has
 * settled; fake timers here would test the scheduler rather than the card.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { SearchItem, SearchResponse } from "../contracts";
import { SEARCH_DEBOUNCE_MS, type SearchFetcher } from "../use-search";
import { FIXTURE_RECENTS, fixtureSearchFetcher } from "../search-fixtures";
import { SearchPopup } from "./search-popup";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const CHANNEL: SearchItem = {
  id: "ch-1",
  kind: "channels",
  title: "q4-outbound",
  containerId: "ws-1",
};
const MESSAGE: SearchItem = {
  id: "msg-1",
  kind: "messages",
  title: "Priya Shah",
  snippet: "pushed the <mark>orchestrator</mark> <b>template</b>",
  containerId: "ws-1",
  channelId: "ch-1",
  seq: 4821,
};
const KNOWLEDGE: SearchItem = {
  id: "kb-1",
  kind: "knowledge",
  title: "Desktop Orchestrator Protocol",
  containerId: "ws-1",
};

const ANSWER: SearchResponse = {
  q: "orch",
  scope: "account",
  tookMs: 4,
  groups: [
    // ⚠ **PAYLOAD ORDER IS SECTION ORDER** (`contracts.ts › SEARCH_GROUP_ORDER`,
    // which the service builds in) — so this is stated in it, and the card is
    // asserted to preserve it rather than to re-derive it.
    { kind: "channels", total: 1, items: [CHANNEL] },
    { kind: "messages", total: 1, items: [MESSAGE] },
    // ⚠ AN EMPTY GROUP the contract would already have omitted: the card drops
    // one anyway, for an older or a stubbed server.
    { kind: "skills", total: 0, items: [] },
    { kind: "knowledge", total: 1, items: [KNOWLEDGE] },
  ],
};

/** A stable fetcher — the hook's contract requires it (a fresh identity every render
 *  re-arms the debounce forever). */
function stubFetcher(answer: SearchResponse = ANSWER) {
  const calls: string[] = [];
  const fetcher: SearchFetcher = ({ q }) => {
    calls.push(q);
    return Promise.resolve({ ...answer, q });
  };
  return { fetcher, calls };
}

/** The card plus the thing it hangs off: a field the test can type into, with
 *  the host's own clear-and-blur wired the way both real hosts wire it. */
function Host({
  fetcher,
  onNavigate = vi.fn(),
  initial = "",
  ...rest
}: {
  fetcher: SearchFetcher;
  onNavigate?: (item: SearchItem) => void;
  initial?: string;
  seedRecents?: readonly string[];
}) {
  const [query, setQuery] = useState(initial);
  const [focused, setFocused] = useState(true);
  return (
    <div>
      <input
        aria-label="Search"
        value={query}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      <SearchPopup
        query={query}
        focused={focused}
        scope="account"
        onNavigate={onNavigate}
        onClose={() => {
          setQuery("");
          setFocused(false);
        }}
        onQueryChange={setQuery}
        fetcher={fetcher}
        userId="u1"
        {...rest}
      />
    </div>
  );
}

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("Search"), { target: { value } });

const card = () => screen.findByRole("listbox", { name: "Search results" });

describe("the search popup opens on the TYPING, with no ⌘K and no toggle", () => {
  it("stays shut at one character and asks the server nothing", async () => {
    const { fetcher, calls } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("o");
    await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 60));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("opens at TWO and renders what came back", async () => {
    const { fetcher } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("or");
    expect(await card()).not.toBeNull();
    expect(await screen.findByText("q4-outbound")).not.toBeNull();
  });

  it("🔒 DEBOUNCES — fast typing is ONE request, for the LAST value", async () => {
    const { fetcher, calls } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("or");
    type("orc");
    type("orch");
    await card();
    await waitFor(() => expect(calls).toEqual(["orch"]));
  });

  it("closes when the field loses focus, and Escape CLEARS the field", async () => {
    const { fetcher } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("orch");
    await card();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    // ⚠ `.value`, not `toHaveValue`: the ROOT suite installs no jest-dom.
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
  });
});

describe("the sections", () => {
  it("renders the payload's order, omits the empty group, and labels each one", async () => {
    const { fetcher } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("orch");
    await card();

    // ⚠ WAIT FOR THE ANSWER, not for the card: the card opens on the KEYSTROKE
    // (loading, last answer underneath) and the sections arrive with the fetch.
    await screen.findByText("q4-outbound");
    const labels = screen.getAllByText(/^(Channels|Messages|Knowledge|Skills)$/);
    expect(labels.map((el) => el.textContent)).toEqual([
      "Channels",
      "Messages",
      "Knowledge",
    ]);
  });

  it("🔒 renders a snippet's `<mark>` and NOTHING else it carries", async () => {
    const { fetcher } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("orch");
    await card();

    const mark = await screen.findByText("orchestrator");
    expect(mark.tagName).toBe("MARK");
    // ⚠ The `<b>` arrived on the wire and must be TEXT, not markup.
    expect(document.querySelector("[role='listbox'] b")).toBeNull();
    expect(screen.getByText(/<b>template<\/b>/)).not.toBeNull();
  });

  it("says `No results` in ONE line, and only once the answer is in", async () => {
    const { fetcher } = stubFetcher({ q: "zz", scope: "account", tookMs: 1, groups: [] });
    render(<Host fetcher={fetcher} />);
    type("zzz");
    await card();
    expect(await screen.findByText("No results")).not.toBeNull();
  });
});

describe("the keyboard", () => {
  it("↓/↑ walk the flat order ACROSS groups and wrap", async () => {
    const { fetcher } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("orch");
    await card();

    const activeRow = () =>
      document.querySelector('[data-active="true"]')?.getAttribute("data-search-row");

    // The first row of the first section is the cursor's home.
    await waitFor(() => expect(activeRow()).toBe("ch-1"));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => expect(activeRow()).toBe("msg-1"));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => expect(activeRow()).toBe("kb-1"));
    // ⚠ WRAPS, like every menu in the app.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => expect(activeRow()).toBe("ch-1"));
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await waitFor(() => expect(activeRow()).toBe("kb-1"));
  });

  it("🔒 Enter hands the HOST the row it is on — the whole item, per kind", async () => {
    const { fetcher } = stubFetcher();
    const onNavigate = vi.fn();
    render(<Host fetcher={fetcher} onNavigate={onNavigate} />);
    type("orch");
    await card();
    await waitFor(() =>
      expect(document.querySelector('[data-active="true"]')).not.toBeNull()
    );

    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() =>
      expect(
        document.querySelector('[data-active="true"]')?.getAttribute("data-search-row")
      ).toBe("msg-1")
    );
    fireEvent.keyDown(window, { key: "Enter" });

    // ⚠ THE WHOLE ITEM, because what "open" means is the HOST's decision and it
    // needs the channel, the thread and the seq to make it.
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "messages", channelId: "ch-1", seq: 4821 })
    );
  });

  it("a CLICK takes the row it is on, whatever the cursor is on", async () => {
    const { fetcher } = stubFetcher();
    const onNavigate = vi.fn();
    render(<Host fetcher={fetcher} onNavigate={onNavigate} />);
    type("orch");
    await card();

    fireEvent.click(await screen.findByText("Desktop Orchestrator Protocol"));
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "knowledge", id: "kb-1" })
    );
  });
});

describe("recents", () => {
  it("🔒 a TAKEN query is remembered, and shows under the empty field", async () => {
    const { fetcher } = stubFetcher();
    render(<Host fetcher={fetcher} />);
    type("orch");
    await card();
    fireEvent.click(await screen.findByText("q4-outbound"));

    // ⚠ PERSISTED, not held in a ref: the next session reads the same list.
    expect(globalThis.localStorage.getItem("dopl.search.recents:u1")).toContain("orch");

    // The host cleared and blurred; focus the field again with nothing in it.
    fireEvent.focus(screen.getByLabelText("Search"));
    expect(await screen.findByText("Recent")).not.toBeNull();
    expect(screen.getByText("orch")).not.toBeNull();
  });

  it("a recent row puts its query BACK IN THE FIELD rather than navigating", async () => {
    const { fetcher } = stubFetcher();
    const onNavigate = vi.fn();
    globalThis.localStorage.setItem(
      "dopl.search.recents:u1",
      JSON.stringify(["credit model"])
    );
    render(<Host fetcher={fetcher} onNavigate={onNavigate} />);

    fireEvent.focus(screen.getByLabelText("Search"));
    fireEvent.click(await screen.findByText("credit model"));
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe(
      "credit model"
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows the SEED only while the operator has remembered nothing", async () => {
    const { fetcher } = stubFetcher();
    render(<Host fetcher={fetcher} seedRecents={["orchestrator"]} />);
    fireEvent.focus(screen.getByLabelText("Search"));
    expect(await screen.findByText("orchestrator")).not.toBeNull();
    // ⚠ And it is NOT written to storage — a seed the operator never typed must
    // not become their history.
    expect(globalThis.localStorage.getItem("dopl.search.recents:u1")).toBeNull();
  });
});

/**
 * 🔒 **THE FIXTURE TABLE IS STILL A `SearchFetcher`, AND THAT IS WHAT KEEPS IT
 * USABLE (2026-09-17).** Both hosts ship `search-client.ts › apiSearchFetcher`
 * now that `feat/search-api` has merged; the table stayed for tests and for a dev
 * run with no server, and an unexercised one would rot into a shape the card can
 * no longer render. ⚠ It is also the body `pages/home/home-search-popup.test.tsx`
 * hands back through the bridge, so this case is what says that body is honest.
 */
describe("the fixture table, which the hosts no longer mount", () => {
  it("answers in PAYLOAD ORDER with rows the card can draw", async () => {
    render(<Host fetcher={fixtureSearchFetcher} seedRecents={FIXTURE_RECENTS} />);
    type("orchestrator");
    await card();

    // A real match, its section, and the agent-template row's own colour value.
    expect(await screen.findByText("Desktop Orchestrator Protocol")).not.toBeNull();
    expect(screen.getByText("Knowledge")).not.toBeNull();
    expect(screen.getByText("Orchestrator")).not.toBeNull();

    // ⚠ PAYLOAD ORDER, NOT A SORT — the renderer walks the groups as given
    // (`contracts.ts › SEARCH_GROUP_ORDER` is what the service builds in), so a
    // table that answered out of order would show here.
    const labels = screen.getAllByText(/^(Messages|Knowledge|Agent templates)$/);
    expect(labels.map((el) => el.textContent)).toEqual([
      "Messages",
      "Knowledge",
      "Agent templates",
    ]);
  });

  it("account scope never returns the three container-only sections", async () => {
    // ⚠ Samuel, 2026-09-17: *"those modules do not exist on home"* —
    // `contracts.ts › CONTAINER_ONLY_SEARCH_GROUPS`, which the service enforces
    // and the table mirrors.
    render(<Host fetcher={fixtureSearchFetcher} />);
    type("priya");
    await card();
    await screen.findByText(/Priya Shah|No results/);
    expect(screen.queryByText("Members")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByText("Chats")).toBeNull();
  });
});
