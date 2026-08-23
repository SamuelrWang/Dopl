// @vitest-environment jsdom
/**
 * THE CENTER PANE'S SCROLLER — the two behaviours that are invisible in a
 * screenshot and therefore go missing without a word.
 *
 *  - **STICK TO BOTTOM.** The transcript renders oldest-first, so a pane that
 *    never scrolls opens every channel on its oldest message. Three rules:
 *    a view switch lands at the bottom, new rows follow while the reader is
 *    there, and a reader scrolled up into history is NEVER yanked (the retired
 *    page followed unconditionally — this is the one behaviour that is
 *    deliberately not a restoration).
 *  - **A SCROLL TARGET OUTSIDE THE LOADED TRANSCRIPT SAYS SO.** A mention click
 *    marks read and navigates whether or not the row is in the page; when it is
 *    not, nothing moved and the operator was told nothing.
 *  - **THE HEADER BOOKMARK IS THE FAVOURITE TOGGLE** (2026-08-19). Its two
 *    states are a label and a fill — both invisible to a smoke test that only
 *    checks the button exists, which is what it was for a day when the control
 *    was inert furniture.
 *
 * ⚠ JSDOM HAS NO LAYOUT, so `scrollHeight` / `clientHeight` / `scrollTop` are
 * all 0 and `scrollIntoView` does not exist. They are stubbed on the prototype
 * with a per-element `scrollTop` backing, which is what lets these cases assert
 * the SCROLL CALLS the pane made rather than a rendered pixel.
 *
 * ⚠ `useThreadWrites` is mocked: the composer rides along inside this pane and
 * its write layer has its own suite.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

import {
  ChannelsV2MessagePane,
  SCROLL_TARGET_MISSING_NOTE,
  type ScrollTarget,
} from "./message-pane";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { CHANNEL_ID, ME, PEER, member, message, thread } from "./test-fixtures";
import type { ChannelMessage } from "../../types";

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 400;
/** `scrollHeight - clientHeight` — where a real bottom-scrolled box sits. */
const TRUE_BOTTOM = SCROLL_HEIGHT - CLIENT_HEIGHT;

const tops = new WeakMap<Element, number>();
const scrollIntoView = vi.fn();

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => SCROLL_HEIGHT,
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
  Element.prototype.scrollIntoView = scrollIntoView;
});

beforeEach(() => {
  scrollIntoView.mockReset();
  scrollIntoView.mockImplementation(() => {});
});
afterEach(cleanup);

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];
const INDEX = indexMembers(MEMBERS, ME);

function messages(count: number): ChannelMessage[] {
  return Array.from({ length: count }, (_, i) =>
    message({ id: `m-${i}`, seq: i + 1, body: `line ${i}` })
  );
}

const rowsOf = (msgs: ChannelMessage[]) =>
  channelRows(msgs, [], INDEX, formatChannelTimestamp);

type Props = React.ComponentProps<typeof ChannelsV2MessagePane>;

function paneProps(over: Partial<Props> = {}): Props {
  return {
    channelId: CHANNEL_ID,
    workspaceId: "ws-1",
    channelName: "Website",
    thread: null,
    rows: rowsOf(messages(3)),
    index: INDEX,
    members: MEMBERS,
    loading: false,
    scrollTarget: null,
    infoOpen: false,
    favorited: false,
    gate: { begin: vi.fn(), end: vi.fn() },
    onToggleFavorite: vi.fn(),
    onToggleInfo: vi.fn(),
    onExitThread: vi.fn(),
    onOpenThread: vi.fn(),
    ...over,
  };
}

/**
 * THE SCROLLER. Located by the one class that makes it one — the pane owns
 * exactly one `overflow-y-auto` box, and a `data-testid` on production markup
 * to serve a test would be the wrong trade.
 */
function scrollerOf(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".overflow-y-auto")!;
}

function mount(over: Partial<Props> = {}) {
  const props = paneProps(over);
  const { container, rerender } = render(<ChannelsV2MessagePane {...props} />);
  return {
    props,
    scroller: scrollerOf(container),
    rerender: (next: Partial<Props> = {}) =>
      rerender(<ChannelsV2MessagePane {...paneProps({ ...over, ...next })} />),
  };
}

/** The user's own scroll — the ONLY thing that moves the pin. */
function userScrollsTo(scroller: HTMLElement, top: number) {
  scroller.scrollTop = top;
  fireEvent.scroll(scroller);
}

describe("the transcript sticks to the bottom", () => {
  it("opens a channel at the BOTTOM, not on its oldest message", () => {
    const { scroller } = mount();
    expect(scroller.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("follows a new message while the reader is AT the bottom", () => {
    const { scroller, rerender } = mount();
    userScrollsTo(scroller, TRUE_BOTTOM); // gap 0 — still pinned
    scroller.scrollTop = 0; // ...and something moved it, so a follow is visible
    rerender({ rows: rowsOf(messages(4)) });
    expect(scroller.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("does NOT yank a reader who has scrolled up into history", () => {
    // ⚠ THE ONE RULE THAT IS NOT A RESTORATION. The retired page followed
    // unconditionally, so a message arriving mid-scrollback threw the reader
    // back to the end of the conversation.
    const { scroller, rerender } = mount();
    userScrollsTo(scroller, 0);
    rerender({ rows: rowsOf(messages(4)) });
    expect(scroller.scrollTop).toBe(0);
  });

  it("still follows a reader hovering just inside the slack", () => {
    // Drifted a line, not reading history: still following the conversation.
    const { scroller, rerender } = mount();
    userScrollsTo(scroller, TRUE_BOTTOM - 32);
    scroller.scrollTop = 0;
    rerender({ rows: rowsOf(messages(4)) });
    expect(scroller.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("jumps to the bottom on a THREAD switch, however far up the reader was", () => {
    const { scroller, rerender } = mount();
    userScrollsTo(scroller, 0);
    rerender({ thread: thread({ id: "t-1" }) });
    expect(scroller.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("jumps to the bottom on a CHANNEL switch", () => {
    const { scroller, rerender } = mount();
    userScrollsTo(scroller, 0);
    rerender({ channelId: "ch-other" });
    expect(scroller.scrollTop).toBe(SCROLL_HEIGHT);
  });
});

describe("the mention scroll target and the pin", () => {
  const TARGET: ScrollTarget = { messageId: "m-1", nonce: 1 };

  it("scrolls the named row into view", () => {
    mount({ scrollTarget: TARGET });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: "center" });
  });

  it("WINS over the stick-to-bottom in the same commit", () => {
    // ⚠ A mention click can swap the view AND ask for a jump in one render. If
    // the stick ran last, the reader would land on the newest message they did
    // not ask for. The jump's own landing is stamped here and must survive.
    const LANDED = 123;
    const { scroller, rerender } = mount();
    scrollIntoView.mockImplementation(() => {
      scroller.scrollTop = LANDED;
    });
    rerender({ thread: thread({ id: "t-1" }), scrollTarget: TARGET });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(LANDED);
  });

  it("RELEASES the pin, so the next message does not drag the reader back down", () => {
    // A deliberate landing in history is a reading position — and no `scroll`
    // event fires for a programmatic jump, so the pin has to be released by the
    // jump itself or the next arrival undoes it.
    const { scroller, rerender } = mount({ scrollTarget: TARGET });
    expect(scrollIntoView).toHaveBeenCalled();
    scroller.scrollTop = 0; // where the jump left the box
    rerender({ scrollTarget: TARGET, rows: rowsOf(messages(4)) });
    expect(scroller.scrollTop).toBe(0);
  });
});

/**
 * THE HEADER BOOKMARK — the favourite toggle for the OPEN CHANNEL.
 *
 * ⚠ The wording is pinned deliberately, not incidentally: it matches the
 * knowledge card's family verbatim ("Bookmark {name}" / "Remove bookmark from
 * {name}", `knowledge-v2/home/base-card.tsx`), because one save affordance
 * across the app should be one sentence. A drift here is a drift there.
 */
describe("the header's favourite toggle", () => {
  it("reads UNFAVOURITED as an unpressed, unfilled Bookmark naming the channel", () => {
    mount();
    const button = screen.getByRole("button", { name: "Bookmark Website" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.querySelector("svg")?.getAttribute("fill")).toBe("none");
  });

  it("reads FAVOURITED as pressed, filled, and offering the removal", () => {
    mount({ favorited: true });
    const button = screen.getByRole("button", {
      name: "Remove bookmark from Website",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // The fill IS the state — the outline is always drawn so the glyph does not
    // change size between the two.
    expect(button.querySelector("svg")?.getAttribute("fill")).toBe(
      "currentColor"
    );
  });

  it("calls back on click, in both directions", () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Bookmark Website" }));
    expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
    cleanup();

    const on = mount({ favorited: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove bookmark from Website" })
    );
    expect(on.props.onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it("still names the CHANNEL with a thread open — it is what the crumb names", () => {
    // A thread is not a favouritable thing: there is no per-(user, thread) row
    // anywhere, and the control's meaning must not change under the operator
    // when a thread opens.
    mount({ thread: thread({ id: "t-1", title: "UI-kit design" }) });
    expect(
      screen.getByRole("button", { name: "Bookmark Website" })
    ).not.toBeNull();
  });

  it("is ABSENT in the pop-out window's chrome", () => {
    // That header is the thread's own title and nothing else: no info panel, no
    // channel to go back to — and no channel-scoped control either.
    mount({ chrome: "window", thread: thread({ id: "t-1" }) });
    expect(screen.queryByRole("button", { name: /ookmark/ })).toBeNull();
  });
});

describe("a scroll target outside the loaded transcript", () => {
  const OLDER: ScrollTarget = { messageId: "m-ancient", nonce: 1 };

  it("says so instead of silently doing nothing", () => {
    mount({ scrollTarget: OLDER });
    expect(screen.getByText(SCROLL_TARGET_MISSING_NOTE)).not.toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("stays silent when the row IS loaded", () => {
    mount({ scrollTarget: { messageId: "m-1", nonce: 1 } });
    expect(screen.queryByText(SCROLL_TARGET_MISSING_NOTE)).toBeNull();
  });

  it("stays silent while the transcript is still loading", () => {
    // "Older than the loaded history" is a claim about a FINISHED read.
    mount({ scrollTarget: OLDER, loading: true, rows: [] });
    expect(screen.queryByText(SCROLL_TARGET_MISSING_NOTE)).toBeNull();
  });

  it("spends the nonce, so a re-click is not a no-op on top of a no-op", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = mount({ scrollTarget: OLDER });
      expect(screen.getByText(SCROLL_TARGET_MISSING_NOTE)).not.toBeNull();
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(screen.queryByText(SCROLL_TARGET_MISSING_NOTE)).toBeNull();
      // Clicking the same mention again is a NEW nonce and speaks again.
      rerender({ scrollTarget: { ...OLDER, nonce: 2 } });
      expect(screen.getByText(SCROLL_TARGET_MISSING_NOTE)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * THE PEER-ACTIVITY SLOT (2026-08-20). The pane does not decide whether a peer's
 * agent is working — `peer-activity.tsx` does, and `peer-activity.test.tsx` pins
 * it. What is this file's is the PLACEMENT, which is the part a redesign moves
 * without noticing: above the composer so it reads as context for what you are
 * about to type, below the send box so it never separates a decision from the
 * draft it is about.
 */
describe("the peer-activity slot", () => {
  const SLOT = <div data-testid="peer-activity">someone is working</div>;

  it("renders between the send box and the composer", () => {
    const { container } = render(
      <ChannelsV2MessagePane {...paneProps({ peerActivity: SLOT })} />
    );
    const slot = container.querySelector('[data-testid="peer-activity"]')!;
    const composer = container.querySelector("textarea")!;
    // ⚠ DOCUMENT ORDER, not a class name: the assertion is about where a reader's
    // eye lands, and comparing positions survives every styling change.
    expect(
      slot.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const scroller = scrollerOf(container);
    expect(
      scroller.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // ⚠ BOTH CHROMES. The pop-out is a real thread surface, and a peer agent
  // working on the thread you popped out is exactly what that window is for.
  it("renders in the pop-out window chrome too", () => {
    const { container } = render(
      <ChannelsV2MessagePane
        {...paneProps({ peerActivity: SLOT, chrome: "window", thread: thread({ id: "t-1" }) })}
      />
    );
    expect(container.querySelector('[data-testid="peer-activity"]')).not.toBeNull();
  });

  it("renders nothing when the caller hands over no slot", () => {
    const { container } = render(<ChannelsV2MessagePane {...paneProps()} />);
    expect(container.querySelector('[data-testid="peer-activity"]')).toBeNull();
  });
});
