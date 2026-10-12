// @vitest-environment jsdom
/**
 * **THE CITATION JUMP WORKS IN THE POP-OUT** (grammar B, 2026-10-12).
 *
 * ⚠ **THIS WINDOW HANDED NO `onJumpToSeq` AT ALL**, so every citation in it was
 * plain text by the absent-not-disabled rule. That was correct while nothing
 * could move the transcript, and a dead end the moment a pill became the ONLY way
 * a reader reaches a cited message — which is what grammar B makes it. A pop-out
 * is also where one exchange is read most closely, so it is the worst surface to
 * have the affordance missing from.
 *
 * ⚠ **THE WHOLE POINT IS THE WIRING, WHICH IS WHY THIS MOUNTS THE REAL WINDOW.**
 * The resolver (`use-message-jump.ts`) and the landing (`message-pane.tsx`) are
 * the SHARED ones and have their own suites; neither can fail when a host simply
 * does not pass the prop. `transcript-citation.test.tsx`'s docblock names that
 * exact history — the pill once shipped "complete and inert" for this reason.
 *
 * ⚠ JSDOM has no layout, so `scrollIntoView` is stubbed on the prototype; the
 * TINT is the half it cannot see, and both are asserted.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CHANNEL_ID, ME, PEER, member, message, thread, WS } from "./test-fixtures";
import { FLASH_TINT } from "./authored-row";

/** ⚠ Mirrors `message-pane.tsx`'s private constant: the flash window this suite
 *  has to step past to make a second ask observable. */
const FLASH_MS = 1600;

const { live } = vi.hoisted(() => ({ live: vi.fn(() => ({ gate: {} })) }));

vi.mock("./composer", () => ({
  ChannelsComposer: () => <div data-testid="composer" />,
}));
vi.mock("./live", () => ({ useChannelsLive: live }));

const THREAD = thread({ id: "t-1", title: "Ship the release" });

/**
 * Two messages in one thread: an older one, and a newer one CITING it.
 *
 * ⚠ The citing row's own seq is not the cited seq — a fixture where they
 * coincide would pass even if the code read the number off the wrong row.
 */
vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [
      message({
        id: "m-older",
        seq: 11,
        authorUserId: PEER,
        body: "the original point",
        metadata: { taskId: "t-1" },
      }),
      message({
        id: "m-citing",
        seq: 12,
        authorUserId: PEER,
        body: "as #11 said, and see #7 too",
        metadata: { taskId: "t-1" },
        // Written under grammar B, citing the older row by seq — and a second
        // entry whose number is ONE DIGIT, which only an allowlist can pill.
        cites: [
          { messageId: "m-older", seq: 11, no: null, thread: "t-1" },
          { messageId: "m-elsewhere", seq: 7, no: null, thread: "t-1" },
        ],
      }),
    ],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({
    members: [member({ userId: ME }), member({ userId: PEER, role: "member" })],
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({
    threads: [THREAD],
    loading: false,
    truncated: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [] }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../hooks/use-channel-agent-sessions", () => ({
  useChannelAgentSessions: () => ({ sessions: [], refetch: () => {} }),
}));
vi.mock("./use-desktop-sessions", () => ({
  useDesktopSessions: () => ({ sessions: [], refresh: () => {} }),
}));

import { ChannelsThreadWindow } from "./thread-window";

const scrollIntoView = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

beforeEach(() => {
  scrollIntoView.mockReset();
});

afterEach(cleanup);

function mount() {
  return render(
    <ChannelsThreadWindow
      workspaceId={WS}
      channelId={CHANNEL_ID}
      threadId="t-1"
      currentUserId={ME}
    />
  );
}

function tinted(messageId: string): boolean {
  const row = document.querySelector(`[data-message-id="${messageId}"]`);
  return row !== null && row.className.includes(FLASH_TINT);
}

describe("a citation in the pop-out", () => {
  it("🔒 is PRESSABLE — this window used to hand no jump at all", () => {
    mount();
    expect(
      screen.getByRole("button", { name: "Go to message #11" }),
      `With no \`onJumpToSeq\` the citation renders as plain text, which is correct ` +
        `for a host that cannot move the transcript and a dead end for one that can.`
    ).toBeTruthy();
  });

  it("🔒 moves the transcript AND marks where it landed", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Go to message #11" }));
    expect(scrollIntoView).toHaveBeenCalled();
    // ⚠ The half `scrollIntoView` cannot see: a reader moved to a row with
    // nothing to show them which one it is has been moved for nothing.
    expect(tinted("m-older")).toBe(true);
  });

  it("🔒 asking TWICE asks twice — and the second ask TINTS AGAIN", () => {
    /**
     * ⚠ **THE TINT IS WHAT BITES HERE, AND ASSERTING THE SCROLL ALONE DID NOT —
     * WHICH IS REVIEW 35'S LESSON ARRIVING A SECOND TIME.** The pane scrolls
     * whenever its `scrollTarget` object changes, but it only FLASHES while
     * `scrollTarget.nonce !== spentNonce` (`message-pane.tsx`). So a local signal
     * that handed out a FIXED nonce would still move the transcript on every
     * click while silently losing the highlight from the second one onward — and
     * I measured exactly that: this case passed the fixed-nonce mutation until
     * the tint was asserted.
     *
     * ⚠ **THE FIRST FLASH HAS TO EXPIRE FIRST**, or the tint from click one is
     * still on screen and the assertion proves nothing. Spending the nonce is
     * what makes the second ask a real ask.
     */
    vi.useFakeTimers();
    try {
      mount();
      const pill = screen.getByRole("button", { name: "Go to message #11" });
      fireEvent.click(pill);
      expect(tinted("m-older")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(FLASH_MS + 50);
      });
      expect(tinted("m-older"), "the flash must expire before the second ask").toBe(
        false
      );
      scrollIntoView.mockReset();
      fireEvent.click(pill);
      expect(scrollIntoView).toHaveBeenCalled();
      expect(tinted("m-older")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔒 pills a SINGLE-DIGIT citation, which only an allowlist can", () => {
    // `#7` can never be a pill under the legacy two-digit floor; it is live here
    // because the author cited message 7 through the field.
    mount();
    expect(screen.getByRole("button", { name: "Go to message #7" })).toBeTruthy();
  });

  it("the cited row is reachable even though it is ABOVE the citing row", () => {
    // Both are loaded in this window, so this is the ordinary case rather than
    // the page-back one — and it is the case a pop-out is almost always in.
    mount();
    expect(document.querySelector('[data-message-id="m-older"]')).not.toBeNull();
  });
});
