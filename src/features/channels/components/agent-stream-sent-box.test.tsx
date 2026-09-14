// @vitest-environment jsdom
/**
 * THE POSTED BODY'S BOUND — the collapse on the outbound review card (task 10,
 * #1058/#1059).
 *
 * ⚠ ITS OWN FILE, on the card's own seam (INVARIANTS §1):
 * `agent-stream-consent.test.tsx` is about a DECISION and its state machine and
 * changes when the consent model does; this file is about HOW MUCH OF A POSTED
 * BODY IS SHOWING and changes when that bound does. Folding it into the consent
 * suite would re-open the gate's lifecycle for review every time a clamp moved.
 *
 * ⚠ THE HEIGHTS ARE STUBBED, AND THAT IS THE WHOLE REASON THIS FILE IS DELICATE.
 * jsdom lays nothing out: every `scrollHeight` and `clientHeight` is 0, so the
 * component's measurement — the one thing here that is not CSS — would answer
 * "nothing ever overflows" and every assertion below would pass for the wrong
 * reason. The stubs give layout a voice:
 *   - `scrollHeight` is the body's NATURAL height, the number the component
 *     compares against.
 *   - `clientHeight` reads the inline `max-height` the component itself sets:
 *     capped while collapsed, natural once open. That is exactly the CSS fact
 *     jsdom cannot compute (`calc(6 * 1.5em + 18px)` is never resolved here),
 *     which is why {@link COLLAPSED_PX} STANDS IN for it and is not an assertion
 *     about the real clamp. The real one is a browser fact and belongs to the
 *     desktop session.
 *
 * ⚠ THE PROPERTIES, and each is a way the feature could ship wrong:
 *   - A control on a card with nothing behind it — a promise of more that opens
 *     onto the same two lines.
 *   - A control MISSING on the long card it exists for.
 *   - Nothing dropped: the clamp is a bounded container, never a slice, so every
 *     character is in the DOM while collapsed (`agent-stream-prose.tsx` rule 4).
 *   - A body still under review, folded away under the button asking to post it.
 *   - "Show less" vanishing under the reader's cursor when the measurement is
 *     re-run in the open state, where the box has no cap and everything "fits".
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  POST_ACTION_LABEL,
  POST_COLLAPSE_LABEL,
  POST_EXPAND_LABEL,
  POST_PENDING_LABEL,
  SentToChannelBox,
} from "./agent-stream-sent-box";

/** What the collapsed box is worth in this environment. A stand-in for the real
 *  `calc()` clamp, which jsdom does not resolve. */
const COLLAPSED_PX = 122;

const BODY = "Renamed btn/secondary and shipped it.";

/** The body's natural height, as the current test wants layout to report it. */
let contentPx = 0;

/** ⚠ CAPTURED AT LOAD, BEFORE ANYTHING IS STUBBED. In jsdom these live on
 *  `Element.prototype`, so there is usually nothing OWN to restore here and the
 *  own property is deleted instead — both paths are handled rather than assumed. */
const REAL = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
} as const;

function layoutIs(naturalPx: number) {
  contentPx = naturalPx;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return contentPx;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      // ⚠ THE CAP IS THE COMPONENT'S OWN INLINE STYLE, which is set while
      // collapsed and dropped when open — so the stub follows the state under
      // test instead of the test having to say which state it is in.
      return this.style.maxHeight ? COLLAPSED_PX : contentPx;
    },
  });
}

afterEach(() => {
  cleanup();
  for (const key of ["scrollHeight", "clientHeight"] as const) {
    const real = REAL[key];
    if (real) Object.defineProperty(HTMLElement.prototype, key, real);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
  contentPx = 0;
});

function box(over: Partial<React.ComponentProps<typeof SentToChannelBox>> = {}) {
  return render(<SentToChannelBox text={BODY} at={1_000} {...over} />);
}

/** The clip box, reached the way a screen reader reaches it — which also proves
 *  `aria-controls` points at the thing the button actually opens. */
function clipFor(button: HTMLElement): HTMLElement {
  const id = button.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const clip = document.getElementById(id as string);
  expect(clip).toBeTruthy();
  return clip as HTMLElement;
}

describe("the control appears only on a body that is actually taller", () => {
  it("offers nothing on a short post", () => {
    // ⚠ THE FAILURE THIS FORBIDS: a control under every two-line post, promising
    // more and opening onto the same two lines. CSS alone cannot tell these two
    // cards apart, which is why the component measures at all.
    layoutIs(40);
    box();
    expect(screen.queryByRole("button", { name: POST_EXPAND_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: POST_COLLAPSE_LABEL })).toBeNull();
  });

  it("offers it on a tall one, collapsed, with the cap on the body", () => {
    layoutIs(400);
    box();
    const button = screen.getByRole("button", { name: POST_EXPAND_LABEL });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(clipFor(button).style.maxHeight).not.toBe("");
  });

  it("drops nothing while collapsed — the clamp is a bound, not a slice", () => {
    // ⚠ THE MARKDOWN RULING DEPENDS ON THIS. A slice would cut a fence or a link
    // mid-token and render the wreckage; the whole string stays in the DOM and
    // only its container is bounded.
    layoutIs(400);
    box();
    expect(screen.getByText(BODY)).toBeTruthy();
  });
});

describe("opening it", () => {
  it("swaps the label and lifts the cap", () => {
    layoutIs(400);
    box();
    const button = screen.getByRole("button", { name: POST_EXPAND_LABEL });
    const clip = clipFor(button);
    fireEvent.click(button);
    const open = screen.getByRole("button", { name: POST_COLLAPSE_LABEL });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(clip.style.maxHeight).toBe("");
  });

  it("keeps the control while open even if the body shrinks under it", () => {
    // ⚠ THE VERDICT IS STICKY WHILE OPEN, AND THIS IS WHY. Open, the box has no
    // cap, so re-running the measurement proves the content "fits" and would pull
    // "Show less" out from under the reader's cursor mid-read.
    layoutIs(400);
    const { rerender } = box();
    fireEvent.click(screen.getByRole("button", { name: POST_EXPAND_LABEL }));
    layoutIs(40);
    rerender(<SentToChannelBox text="a much shorter body" at={1_000} />);
    expect(screen.getByRole("button", { name: POST_COLLAPSE_LABEL })).toBeTruthy();
  });

  it("re-measures the moment it collapses again", () => {
    // ⚠ STICKY IS NOT PERMANENT: the collapsed state is the one where the
    // question is answerable, so closing a now-short body retires the control.
    layoutIs(400);
    const { rerender } = box();
    fireEvent.click(screen.getByRole("button", { name: POST_EXPAND_LABEL }));
    layoutIs(40);
    rerender(<SentToChannelBox text="a much shorter body" at={1_000} />);
    fireEvent.click(screen.getByRole("button", { name: POST_COLLAPSE_LABEL }));
    expect(screen.queryByRole("button", { name: POST_EXPAND_LABEL })).toBeNull();
  });
});

describe("a body still under review is never folded away", () => {
  it("shows a held draft whole, however tall, and keeps its own button alone", () => {
    // ⚠ THE ONE FACE THAT MUST NOT COLLAPSE. This is the body the operator is
    // deciding about: a card that hid two thirds of it behind a disclosure while
    // asking for a press would be requesting consent to words it had folded away.
    // ⚠ IT IS ALSO THE SEPARATION BY CONSTRUCTION — `canPost` requires `pending`,
    // so the collapse control and the Post button can never contend for the last
    // row of this card.
    layoutIs(400);
    box({ pending: true, requestId: "c-1", onPost: () => {} });
    expect(screen.getByText(POST_PENDING_LABEL)).toBeTruthy();
    expect(screen.getByRole("button", { name: POST_ACTION_LABEL })).toBeTruthy();
    expect(screen.queryByRole("button", { name: POST_EXPAND_LABEL })).toBeNull();
    expect(screen.getByText(BODY)).toBeTruthy();
  });

  it("shows an expired draft whole too", () => {
    // ⚠ `pending` COVERS "Not sent": an expired draft is the operator's last
    // chance to read what never went out.
    layoutIs(400);
    box({ pending: true, expired: true, requestId: "c-1", onPost: () => {} });
    expect(screen.queryByRole("button", { name: POST_EXPAND_LABEL })).toBeNull();
    expect(screen.getByText(BODY)).toBeTruthy();
  });
});
