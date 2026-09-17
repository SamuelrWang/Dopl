// @vitest-environment jsdom
/**
 * THE SEARCH POPUP'S SHAPE — which kinds are ONE LINE, what the right-hand slot
 * says, and the per-section scroll (2026-09-17).
 *
 * ⚠ **ITS OWN FILE BECAUSE `search-popup.test.tsx` SITS AT THE 500-LINE CAP**
 * (`eslint.config.mjs › max-lines`) — these cases pushed it to 535. One file per
 * reason to change (INVARIANTS §1): this one changes when the ROW ANATOMY does,
 * that one when the card's BEHAVIOUR does (the debounce, the arrows, the
 * recents, the sanitiser).
 *
 * ⚠ **REAL TIMERS AND A STUB FETCHER**, the same posture as that file: the cases
 * that matter are about what the card draws once the answer has settled.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type {
  SearchItem,
  SearchResponse,
  SearchScope,
} from "../contracts";
import type { SearchFetcher } from "../use-search";
import { SearchPopup, SEARCH_SECTION_MAX_H } from "./search-popup";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const KNOWLEDGE: SearchItem = {
  id: "kb-1",
  kind: "knowledge",
  title: "Desktop Orchestrator Protocol",
  subtitle: "Orchestration Guidelines",
  containerId: "ws-1",
  containerName: "Original",
};

/** ⚠ STABLE, as the hook's contract requires (`use-search.ts`). */
function stubFetcher(answer: SearchResponse) {
  const fetcher: SearchFetcher = ({ q }) => Promise.resolve({ ...answer, q });
  return { fetcher };
}

/** The card and the field it hangs off, wired the way both real hosts wire it. */
function Host({
  fetcher,
  scope = "account",
  containerId,
}: {
  fetcher: SearchFetcher;
  scope?: SearchScope;
  containerId?: string;
}) {
  const [query, setQuery] = useState("");
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
        scope={scope}
        containerId={containerId}
        onNavigate={() => {}}
        onClose={() => {
          setQuery("");
          setFocused(false);
        }}
        onQueryChange={setQuery}
        fetcher={fetcher}
        userId="u1"
      />
    </div>
  );
}

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("Search"), { target: { value } });

const card = () => screen.findByRole("listbox", { name: "Search results" });

const DESCRIBED_CHANNEL: SearchItem = {
  id: "ch-desc",
  kind: "channels",
  title: "q4-outbound",
  // The channel's DESCRIPTION — `channels.topic` on the wire.
  subtitle: "Outbound sequences for the quarter",
  containerId: "ws-1",
  containerName: "Original",
};
const BARE_CHANNEL: SearchItem = {
  id: "ch-bare",
  kind: "channels",
  title: "weekly-review",
  containerId: "ws-1",
  containerName: "Original",
};
const THREAD: SearchItem = {
  id: "th-1",
  kind: "threads",
  title: "Pricing page rewrite",
  // A thread's subtitle is its PARENT CHANNEL (`service-groups.ts › toItem`).
  subtitle: "q4-outbound",
  containerId: "ws-1",
  containerName: "Original",
  channelId: "ch-desc",
  threadId: "th-1",
};
const SHAPES: SearchResponse = {
  q: "q4",
  scope: "account",
  tookMs: 2,
  groups: [
    { kind: "channels", total: 2, items: [DESCRIBED_CHANNEL, BARE_CHANNEL] },
    { kind: "threads", total: 1, items: [THREAD] },
    { kind: "knowledge", total: 1, items: [KNOWLEDGE] },
  ],
};

/**
 * 🔒 **THE ROW SHAPE (Samuel, 2026-09-17, over the live card:** *"For channels it
 * like repeats the name of the channel in like 3 places it doesn't make any
 * sense. For channels and threads, it should be one line, it should be the name
 * of the channel in black, and then to the right the description of the channel
 * in gray italics."*). What is pinned here is the ANATOMY: which kinds are one
 * line, that nothing is said twice, and that a row with no description draws no
 * second span at all.
 */
describe("the row shape", () => {
  const row = (id: string) =>
    document.querySelector(`[data-search-row="${id}"]`) as HTMLElement;

  async function open(extra: { scope?: SearchScope; containerId?: string } = {}) {
    const { fetcher } = stubFetcher(SHAPES);
    render(<Host fetcher={fetcher} {...extra} />);
    type("q4");
    await card();
    // ⚠ `findAll` — the word is the channel's NAME and the thread's PARENT, so
    // it is legitimately on two rows.
    await screen.findAllByText("q4-outbound");
  }

  it("🔒 a CHANNEL is ONE LINE — the name once, then its description in muted italic", async () => {
    await open();
    const el = row("ch-desc");

    // ⚠ ONCE. The name used to be the title, the subtitle AND the right-hand
    // fact on the same row.
    const written = (el.textContent ?? "").match(/q4-outbound/g) ?? [];
    expect(written).toHaveLength(1);

    const description = screen.getByText("Outbound sequences for the quarter");
    expect(description.className).toContain("italic");
    expect(description.className).toContain("text-text-muted");
    expect(description.className).toContain("truncate");
    // ⚠ ONE LINE = the description is a SIBLING of the title, never stacked
    // under it in a column.
    expect(description.parentElement).toBe(el);
  });

  it("🔒 a channel with NO description draws no second span", async () => {
    await open();
    const el = row("ch-bare");
    // ⚠ The NAME and the container chip, and nothing between them — no empty
    // second line, and no repeat.
    expect(el.textContent).toBe("weekly-reviewOriginal");
    expect(el.querySelector(".italic")).toBeNull();
  });

  it("a THREAD is one line too, with its parent channel in the italic slot", async () => {
    await open();
    const el = row("th-1");
    const parent = screen.getByText("q4-outbound", {
      selector: "[data-search-row='th-1'] span",
    });
    expect(parent.className).toContain("italic");
    expect(el.textContent).toContain("Pricing page rewrite");
  });

  it("🔒 a KNOWLEDGE row keeps its two lines", async () => {
    await open();
    const el = row("kb-1");
    // The title and the second line live in one column, which is what makes the
    // row two lines high.
    const stack = el.querySelector(".flex-col");
    expect(stack).not.toBeNull();
    expect(stack?.textContent).toContain("Desktop Orchestrator Protocol");
  });

  it("🔒 the container is a CHIP on account scope, and is absent in the host's own container", async () => {
    await open();
    expect(screen.getAllByText("Original").length).toBeGreaterThan(0);

    cleanup();
    await open({ scope: "container", containerId: "ws-1" });
    expect(screen.queryByText("Original")).toBeNull();
  });
});

/**
 * 🔒 **EACH SECTION IS A FIXED HEIGHT THAT SCROLLS ITSELF (Samuel, 2026-09-17:**
 * *"right now, all the choices show, so it's like a super long scroll. It should
 * be, that each section is a fixed height, and if there's more items in it, it's
 * scrollable."*).
 */
describe("the sections scroll one at a time", () => {
  it("caps every section's list and leaves the heading above it", async () => {
    const { fetcher } = stubFetcher(SHAPES);
    render(<Host fetcher={fetcher} />);
    type("orch");
    await card();
    await screen.findAllByText("q4-outbound");

    const lists = document.querySelectorAll("[data-search-section]");
    expect(lists.length).toBe(3);
    for (const list of lists) {
      expect(list.className).toContain(SEARCH_SECTION_MAX_H);
      expect(list.className).toContain("overflow-y-auto");
    }
    // ⚠ THE HEADING IS A SIBLING, not the scroller's first child — it must not
    // scroll away from the rows it names.
    expect(screen.getByText("Channels").closest("[data-search-section]")).toBeNull();
  });
});
