// @vitest-environment jsdom
/**
 * **THE COMPOSER CARD'S GEOMETRY — Samuel's 2026-09-08 toolbar wave, pinned.**
 *
 * Three properties, each one a thing a redesign loses quietly:
 *
 *  - **The recipient tag is OUTSIDE the card**, above it, packed LEFT. It has moved twice
 *    (card bottom-left → card first row, hard right → above the card, hard left), so the pin is
 *    on the RELATIONSHIP — not inside the bordered element, and earlier in document order —
 *    rather than on a class string that will be rewritten again.
 *  - **Every toolbar glyph is the send button's own square**, so its hover face has the arrow's
 *    footprint. Pinned by comparing the RENDERED height of a glyph against the arrow's, which is
 *    the only form that catches a glyph nudged to a near-miss value.
 *  - **The mic sits immediately left of the send button**, and the four surface-opening glyphs
 *    stay together at the left end. DOM order IS keyboard order here (nothing carries a
 *    `tabIndex`), so one assertion covers both.
 *
 * ⚠ THE SUBJECT IS THE ROW, WHICH IS WHY THIS IS NOT `composer.test.tsx` — that file is at 463
 * lines and is about what the composer WRITES. §1's seam, not a line-count dodge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({ templates: [], loading: false, error: null, refetch: () => {} }),
}));

import { ChannelsV2Composer } from "./composer";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/**
 * ⚠ THE MIC RENDERS ONLY WHERE THE BROWSER HAS AN ENGINE (`use-dictation.ts`, the
 * feature-detection rule), and jsdom ships none — so every case about the mic's POSITION would
 * silently assert on an absent button without this. A constructor is all `recognitionCtor` probes.
 */
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  static last: FakeRecognition | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
}

beforeEach(() => {
  FakeRecognition.last = null;
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
});
afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  cleanup();
});

function mount() {
  const { container } = render(
    <ChannelsV2Composer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
    />
  );
  return container;
}

const btn = (name: string) => screen.getByRole("button", { name });

/**
 * ⚠ `act`, BECAUSE THE ENGINE'S EVENTS ARE NOT CLICKS. `fireEvent` wraps its own dispatch; a
 * callback we invoke straight off the fake recognition object is a state write from outside
 * React's batching, and the render it schedules never flushes before the next assertion.
 */
function engineError(code: string) {
  act(() => {
    FakeRecognition.last?.onerror?.({ error: code });
  });
}

describe("the recipient tag sits ABOVE the card, outside it, hard left", () => {
  it("is not inside the bordered card element", () => {
    // ⚠ THE CARD IS `.raised-tab` — the bordered box (`composer.tsx`'s own note says the 1px
    // moved into its padding). "Outside the box" is exactly "not a descendant of that element",
    // and asserting it this way survives the next radius/padding rewrite.
    const container = mount();
    const card = container.querySelector(".raised-tab");
    const tag = screen.getByRole("status", { name: "Recipients" });
    expect(card).not.toBeNull();
    expect(card?.contains(tag)).toBe(false);
  });

  it("comes BEFORE the card in document order — above it, not below", () => {
    // ⚠ THE OTHER HALF: a tag lifted out of the card but appended after it is still outside it.
    const container = mount();
    const card = container.querySelector(".raised-tab") as HTMLElement;
    const tag = screen.getByRole("status", { name: "Recipients" });
    expect(tag.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("packs LEFT, and still says → nobody with nothing addressed", () => {
    // ⚠ `justify-start`, NOT `justify-end` — the 2026-09-04 top-RIGHT placement's class. The two
    // halves (which element it hangs off, which way it packs) have to move together.
    mount();
    const tag = screen.getByRole("status", { name: "Recipients" });
    expect(tag.className).toContain("justify-start");
    expect(tag.className).not.toContain("justify-end");
    expect(tag.textContent).toContain("nobody");
  });

  it("nothing else moved out of the card — the field is still the card's first row", () => {
    // ⚠ Samuel: *"nothing else in the card moves up"*. The mutation this catches is a rewrite
    // that lifts the whole first row out on the way to lifting the tag.
    const container = mount();
    const card = container.querySelector(".raised-tab") as HTMLElement;
    expect(card.contains(screen.getByLabelText("Message"))).toBe(true);
    expect(card.contains(btn("Send"))).toBe(true);
    expect(card.contains(btn("Emoji"))).toBe(true);
  });
});

describe("every toolbar glyph is the send button's square", () => {
  it("matches the arrow's height and width", () => {
    // ⚠ THE ASSERTION IS ON THE RENDERED CLASSES, NOT ON A LITERAL 30. `send-button.tsx` draws
    // `h-[30px] w-[30px]` and the glyphs read `--action-h-sm`, which docs/DESIGN-SYSTEM.md says
    // IS 30px — the point Samuel made is that the two FOOTPRINTS agree, so what is pinned is
    // that the glyphs read the small-action token at all and that jsdom's computed box for the
    // two is the same shape. A glyph nudged back to `h-6 w-6` fails on the first assertion.
    mount();
    for (const name of ["New thread", "Mention", "Emoji", "Dictate"]) {
      const face = btn(name);
      expect(face.className, `${name} must read the small-action scale`).toContain(
        "h-[var(--action-h-sm)]"
      );
      expect(face.className).toContain("w-[var(--action-h-sm)]");
      // ⚠ ROUND, which is the one way they differ from the arrow — and `h-7 … rounded-[7px]`
      // is `IconButton`'s own default, so this also catches a className that stopped winning.
      expect(face.className).toContain("rounded-full");
      expect(face.className).not.toContain("rounded-[7px]");
    }
  });

  it("hovers with the SAME face the Discard beside it wears", () => {
    // ⚠ THE HOVER FILL IS WHAT SAMUEL ASKED ABOUT (*"their shadow when hovered over"*). It is
    // `IconButton`'s own `hover:bg-surface-raised-1` — the Discard's token — and this pins that
    // neither drifted onto a private recipe.
    const container = mount();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi" } });
    expect(btn("Emoji").className).toContain("hover:bg-surface-raised-1");
    expect(btn("Discard").className).toContain("hover:bg-surface-raised-1");
    expect(container.querySelector(".raised-tab")).not.toBeNull();
  });
});

describe("the icon row's order", () => {
  it("is new-thread, @, emoji … then mic, then send", () => {
    // ⚠ Samuel, 2026-09-08: *"move the mic icon, to be directly to the left of the send button"*.
    // It was the LAST glyph of the opening run, four controls away from the arrow.
    // ⚠ DOM ORDER IS KEYBOARD ORDER — nothing in this row carries a `tabIndex`, so pinning the
    // rendered sequence pins the tab sequence too.
    const container = mount();
    const row = btn("Send").parentElement as HTMLElement;
    const order = [...row.querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent
    );
    // ⚠ "New Agent" (Bot) is ABSENT here on purpose: it renders only where the bridge can launch
    // (`newAgent.canLaunch`), which this mount does not hand down. Its place at the head of the
    // run is `composer-launch.test.tsx`'s.
    expect(order).toEqual(["New thread", "Mention", "Emoji", "Dictate", "Send"]);
    expect(container).toBeTruthy();
  });

  it("keeps the mic against the send button once Discard appears", () => {
    // ⚠ THE MUTATION THIS CATCHES: Discard renders only with content, so a row that reads
    // correctly on an empty composer can still shove itself between the mic and the arrow the
    // moment a character is typed — the exact adjacency Samuel asked for, broken by a state the
    // first case never enters.
    mount();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } });
    const row = btn("Send").parentElement as HTMLElement;
    const order = [...row.querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent
    );
    expect(order).toEqual(["New thread", "Mention", "Emoji", "Discard", "Dictate", "Send"]);
  });
});

describe("a failed dictation SAYS SO instead of blinking", () => {
  it("names the fault on the button after the engine errors", () => {
    // ⚠ THE BUG REPORT, REPRODUCED (Samuel: *"i click on it, it like shows red for a second then
    // turns off"*). `onstart` fires when CAPTURE opens; the recognition SERVICE failing afterwards
    // is a separate event, and the old hook mapped it to a bare `stop()`. In Electron that is the
    // only outcome there is — its Chromium carries no Google speech key — so this is the state
    // the desktop app renders every single time.
    mount();
    fireEvent.click(btn("Dictate"));
    // Red, from the engine's own onstart.
    const live = btn("Stop dictation");
    expect(live.className).toContain("text-danger");

    engineError("network");
    // ⚠ THE STATE PERSISTS PAST THE STOP. A reason cleared on the way out IS the blink.
    const failed = btn("Dictation unavailable");
    expect(failed.title).toBe("Dictation unavailable");
    expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop dictation" })).toBeNull();
  });

  it("says BLOCKED for a refused microphone, and clears the reason on the next attempt", () => {
    mount();
    fireEvent.click(btn("Dictate"));
    engineError("not-allowed");
    expect(btn("Microphone blocked")).toBeTruthy();

    // ⚠ CLEARED AT THE START OF AN ATTEMPT, never at its end — a control still showing the last
    // failure while capture is live would be the same lie in the other direction.
    fireEvent.click(btn("Microphone blocked"));
    expect(btn("Stop dictation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Microphone blocked" })).toBeNull();
  });

  it("stays SILENT for the two ordinary ways a dictation ends", () => {
    // ⚠ `no-speech` is a quiet room and `aborted` is our own stop. Painting either as a fault
    // puts a red glyph on the two most common endings.
    mount();
    fireEvent.click(btn("Dictate"));
    engineError("no-speech");
    expect(btn("Dictate")).toBeTruthy();

    fireEvent.click(btn("Dictate"));
    engineError("aborted");
    expect(btn("Dictate")).toBeTruthy();
  });
});
