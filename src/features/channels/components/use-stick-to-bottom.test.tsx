// @vitest-environment jsdom
/**
 * THE SCROLLER'S THREE RULES, AT THE HOOK — the cases Samuel's 2026-09-08 report bought:
 * "when i open a channel, I do not start at the most recent message, It keeps on starting in
 * the middle somewhere, and then I have to scroll down to the most recent message."
 *
 * ⚠ A HOOK HARNESS, NOT THE PANE, and deliberately. `message-pane.test.tsx` already owns the
 * rules AS THE PANE STATES THEM (a switch lands at the bottom, a follow is smooth, a reader in
 * history is not yanked) and is close enough to the 500-line cap that five more cases would
 * push it over. What is NEW here is the three distinctions the pane cannot express without a
 * whole `use-channel-messages.ts`: a PLACEHOLDER commit vs. the real transcript, a PREPENDED
 * page vs. an APPENDED message, and content that GROWS with no row change at all.
 *
 * ⚠ JSDOM HAS NO LAYOUT AND NO `ResizeObserver`. `scrollHeight` / `clientHeight` / `scrollTop`
 * are stubbed on the prototype (`scrollHeight` is a module `let`, so a case can make the
 * content taller mid-test, which is the whole point of two of them) and `ResizeObserver` is a
 * fake whose callbacks this file fires by hand. `getBoundingClientRect` is all zeros, so the
 * row-start offset rule 2 computes collapses to the current position — what these cases pin is
 * WHICH BRANCH ran (a hard `scrollTop` jump vs. a smooth `scrollTo`), which is exactly the
 * distinction the bug was.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useStickToBottom } from "./use-stick-to-bottom";

/** MUTABLE — a case makes the content taller by assigning it. */
let scrollHeight = 1000;
const CLIENT_HEIGHT = 400;
/** `scrollHeight - clientHeight` — where a real bottom-scrolled box sits. */
const trueBottom = () => scrollHeight - CLIENT_HEIGHT;

const tops = new WeakMap<Element, number>();
const scrollTo = vi.fn();

/** Every live observer's callback, so a case can say "the content resized". */
const observed = new Set<ResizeObserverCallback>();
class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {
    observed.add(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observed.delete(this.cb);
  }
}

/** The content got taller under a reader who did not move — rule 3's trigger. */
function contentGrowsTo(height: number) {
  scrollHeight = height;
  for (const cb of Array.from(observed)) cb([], {} as ResizeObserver);
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => CLIENT_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      tops.set(this, value);
    },
  });
  Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

beforeEach(() => {
  scrollHeight = 1000;
  scrollTo.mockReset();
  scrollTo.mockImplementation(() => {});
  observed.clear();
});
afterEach(cleanup);

interface HarnessProps {
  viewKey: string;
  /** The transcript, ASCENDING — the last one is the newest, as the pane passes it. */
  ids: readonly string[];
  /** `loading || stale` — the pane's rule-1 gate. */
  settling: boolean;
}

/**
 * The scroller as the pane builds it: ONE element child holding the rows, which is what the
 * growth observer attaches to.
 */
function Harness({ viewKey, ids, settling }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  useStickToBottom(
    ref,
    viewKey,
    ids.length,
    ids[ids.length - 1] ?? null,
    settling
  );
  return (
    <div ref={ref} data-testid="scroller">
      <div data-testid="content">
        {ids.map((id) => (
          <p key={id} data-message-id={id}>
            {id}
          </p>
        ))}
      </div>
    </div>
  );
}

function mount(over: Partial<HarnessProps> = {}) {
  const props: HarnessProps = {
    viewKey: "ch-1:",
    ids: ["a", "b", "c"],
    settling: false,
    ...over,
  };
  const view = render(<Harness {...props} />);
  return {
    scroller: view.getByTestId("scroller"),
    rerender: (next: Partial<HarnessProps>) =>
      view.rerender(<Harness {...{ ...props, ...next }} />),
  };
}

/** The user's own scroll — the ONLY thing that moves the pin. */
function userScrollsTo(scroller: HTMLElement, top: number) {
  scroller.scrollTop = top;
  fireEvent.scroll(scroller);
}

describe("rule 1 — landing is the BOTTOM, not the start of the last row", () => {
  it("lands the real transcript at the bottom when it REPLACES the placeholder", () => {
    // ⚠ SAMUEL'S BUG, EXACTLY. A channel open commits rows twice: the previous channel's rows
    // ride through the switch on `keepPreviousData` (`settling`), then the real transcript
    // arrives. The second commit is the one that used to take rule 2's branch and animate to
    // the START of the newest message — a screen above the bottom for a long agent post.
    const { scroller, rerender } = mount({
      ids: ["prev-1", "prev-2"],
      settling: true,
    });
    // The real transcript is TALLER than what the placeholder measured — its last row alone
    // outgrows the pane, which is the case where "row start" and "the bottom" differ most.
    scrollHeight = 3000;
    rerender({ ids: ["real-1", "real-2", "real-3"], settling: false });
    expect(scroller.scrollTop).toBe(3000);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("rule 2 — only a genuinely NEW last message aligns to its start", () => {
  it("moves NOTHING when an older page is prepended", () => {
    // `rowCount` grows and `lastRowId` does not. `use-load-older.ts` owns this commit and
    // restores its own anchor; a follow here would throw the reader out of the history they
    // scrolled up to read.
    const { scroller, rerender } = mount({ ids: ["a", "b", "c"] });
    userScrollsTo(scroller, trueBottom()); // gap 0 — still pinned
    rerender({ ids: ["o-1", "o-2", "a", "b", "c"] });
    expect(scroller.scrollTop).toBe(trueBottom());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("SMOOTH-scrolls when a new message is appended and the reader is pinned", () => {
    const { scroller, rerender } = mount({ ids: ["a", "b", "c"] });
    userScrollsTo(scroller, trueBottom());
    rerender({ ids: ["a", "b", "c", "d"] });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: "smooth" });
  });
});

describe("rule 3 — growth keeps the pin", () => {
  it("re-pins a pinned reader when the content gets taller with no row change", () => {
    // An agent streaming into a row already on screen, or an image laying out after first
    // paint: no dep changes, so nothing but the observer can see it.
    const { scroller } = mount();
    expect(scroller.scrollTop).toBe(1000);
    contentGrowsTo(2000);
    expect(scroller.scrollTop).toBe(2000);
  });

  it("does NOT re-pin a reader who has scrolled up into history", () => {
    // The rule that outranks all three. Growth is not permission to move someone reading.
    const { scroller } = mount();
    userScrollsTo(scroller, 0);
    contentGrowsTo(2000);
    expect(scroller.scrollTop).toBe(0);
  });
});
