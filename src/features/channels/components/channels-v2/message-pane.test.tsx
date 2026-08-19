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
import { channelRows, indexMembers } from "./view-model";
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
    requested: new Set<string>(),
    scrollTarget: null,
    infoOpen: false,
    gate: { begin: vi.fn(), end: vi.fn() },
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
  const { container, rerender } = render(
    <ChannelsV2MessagePane {...paneProps(over)} />
  );
  return {
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
