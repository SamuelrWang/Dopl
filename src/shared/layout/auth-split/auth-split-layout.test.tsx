// @vitest-environment jsdom
// AUTH SPLIT LAYOUT — THE SHARED-SURFACE PINS (2026-10-11, release review).
//
// WHAT THIS FILE IS FOR. `AuthSplitLayout` is rendered by FOUR surfaces — the web auth group
// (`app/(auth)/layout.tsx`: /login, /signup, /authenticate), `/oauth/authorize`, the desktop
// signed-out screen, and onboarding — plus `/get-started`, which portals an animation into its
// glass slot. Onboarding is the only one that names a pose. Until this file existed, NOTHING
// rendered the component in a test: the three consumer suites each mock it to a passthrough that
// DISCARDS its props, so every claim about what the other three surfaces look like was argued in
// comments and never measured.
//
// Two defects shipped into that blind spot on 2026-10-10, and each has a case below:
//  1. The white card was gated on `masked` — "the pane has been measured", true everywhere — so
//     an opaque #ffffff card painted on login, signup, /authenticate, /oauth/authorize and the
//     desktop signed-out screen, against this file's own written contract. On /get-started it
//     covered all but a 34px frame of the install animation.
//  2. The onboarding footer padding shipped as `py-7` utility classes. The class string sat in
//     the DOM and computed to 0px on web. ⚠ A CLASS-NAME ASSERTION WOULD HAVE PASSED GREEN —
//     which is why the padding case below reads the INLINE STYLE, the thing that actually
//     renders, and not `className`.
//
// ⚠ THE LIMIT OF THIS TIER, STATED. jsdom applies no stylesheet, so these cases can only pin
// what the component itself emits — inline style and node presence. They CANNOT prove a Tailwind
// rule was emitted into the built sheet. That is exactly why the geometry on this file is
// required to be inline style: inline is the part a test can see. If geometry moves back to a
// utility class, the padding case goes red because the inline style is gone — the regression the
// `py-7` round shipped.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

import { AuthSplitLayout } from "./auth-split-layout";
import { CARD_INSET } from "./auth-glass-geometry";

/**
 * The measure effect reads `getBoundingClientRect()` and BAILS on a pane narrower than 2px
 * (`w < 2 || h < 2`), so in jsdom — where every rect is zero — `box` stays null, `masked` stays
 * false and the card can never render. A card case over an unmeasured pane would be green for
 * the wrong reason, so the pane is given a real size here.
 */
/**
 * `usePrefersReducedMotion` calls `window.matchMedia`, which jsdom does not implement. Answering
 * `matches: false` is the MOTION path — the one every real browser takes by default, and the one
 * the card's opacity transition lives on, so the cases below exercise the live branch rather
 * than the reduced-motion shortcut.
 */
function withMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function withMeasuredPane(width = 1000, height = 800) {
  withMatchMedia();
  const spy = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  return spy;
}

/** The card is `aria-hidden` and identified by the token it fills with. */
const cardIn = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[style*="--glass-card-fill"]');

/** The scrolling form column — the element that carries onboarding's footer padding. */
const formColumnIn = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(".overflow-y-auto");

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("the white card is onboarding's, not every auth surface's", () => {
  it("🔒 a surface that names NO pose renders no card node at all", () => {
    withMeasuredPane();
    const { container } = render(
      <AuthSplitLayout>
        <form />
      </AuthSplitLayout>
    );
    // Login, signup, /authenticate, /oauth/authorize and the desktop signed-out screen all
    // reach the component this way: no `glassPose` prop.
    expect(cardIn(container)).toBeNull();
  });

  it("🔒 …and the glass slot is still there for /get-started to portal into", () => {
    withMeasuredPane();
    const { container } = render(
      <AuthSplitLayout>
        <form />
      </AuthSplitLayout>
    );
    // The card used to paint OVER this node. Removing the card must not remove the slot.
    expect(container.querySelector("#auth-glass-slot")).not.toBeNull();
  });

  it("🔒 …and it publishes the card's inset, so /get-started's panel is the card's size", () => {
    withMeasuredPane();
    const { container } = render(
      <AuthSplitLayout>
        <form />
      </AuthSplitLayout>
    );
    // `install-animation.css › .gs-dmg` insets by this var (Samuel 2026-10-14: "uniform to the
    // size of the other white panels"). It must be the constant `cardPath` draws with, not a copy.
    const slot = container.querySelector<HTMLElement>("#auth-glass-slot")!;
    expect(slot.style.getPropertyValue("--glass-card-inset")).toBe(`${CARD_INSET}px`);
  });

  // ⚠ ALL THREE POSES, `"default"` INCLUDED. Onboarding's step 3 is pose `"default"` by design,
  // so a fix that gated the card on `shaped` (pose !== default) would strip the card from the
  // one onboarding step that looks like a plain surface and is not. That is why this is a loop
  // over every pose and not a single happy-path case.
  it.each(["default", "lowered-top-notch", "raised-bottom-notch"] as const)(
    "🔒 onboarding names pose %s and keeps its card",
    (pose) => {
      withMeasuredPane();
      const { container } = render(
        <AuthSplitLayout glassPose={pose}>
          <form />
        </AuthSplitLayout>
      );
      expect(cardIn(container)).not.toBeNull();
    }
  );
});

describe("the footer padding is onboarding's, inline, and symmetric", () => {
  it("🔒 a surface that names no pose gets NO padding on the form column", () => {
    withMeasuredPane();
    const { container } = render(
      <AuthSplitLayout>
        <form />
      </AuthSplitLayout>
    );
    const col = formColumnIn(container);
    expect(col).not.toBeNull();
    expect(col!.style.paddingTop).toBe("");
    expect(col!.style.paddingBottom).toBe("");
  });

  // ⚠ READS INLINE STYLE, NOT `className`. The shipped `py-7` left the class in the DOM while
  // the rule was never emitted, so padding computed to 0 — a `toContain("py-7")` assertion
  // would have been green over a fix that did nothing. These are the px the element renders.
  it("🔒 onboarding gets 28px, and SYMMETRICALLY", () => {
    withMeasuredPane();
    const { container } = render(
      <AuthSplitLayout glassPose="lowered-top-notch">
        <form />
      </AuthSplitLayout>
    );
    const col = formColumnIn(container)!;
    expect(col.style.paddingTop).toBe("28px");
    expect(col.style.paddingBottom).toBe("28px");
    // Symmetry is the load-bearing half: the child's `min-h-full` resolves against this
    // element's CONTENT box, so equal padding shifts it down 28 and shortens it 56 and the
    // centre stays on the same pixel. `paddingBottom` alone would lift every form 14px.
    expect(col.style.paddingTop).toBe(col.style.paddingBottom);
    expect(col.style.scrollPaddingBottom).toBe("28px");
  });
});

describe("the card's content fades WITH the card, on one opacity", () => {
  // Samuel 2026-10-13: the content outlasted the white card on every step change. The card and
  // its content were sibling layers with two copies of one fade; now one wrapper owns the fade
  // and neither child may carry an opacity or transition of its own.
  it("🔒 card + content share one faded wrapper; the children carry no fade", () => {
    withMeasuredPane();
    const { container } = render(
      <AuthSplitLayout
        glassPose="lowered-top-notch"
        glassCardContent={{ "lowered-top-notch": () => <span data-testid="on-card">hi</span> }}
      >
        <form />
      </AuthSplitLayout>
    );
    const card = cardIn(container)!;
    const wrap = card.parentElement!;
    expect(wrap.hasAttribute("data-glass-card-fade")).toBe(true);
    expect(wrap.querySelector('[data-testid="on-card"]')).not.toBeNull();
    expect(wrap.style.transition).toContain("opacity");
    for (const child of Array.from(wrap.children) as HTMLElement[]) {
      expect(child.style.opacity).toBe("");
      expect(child.style.transition).toBe("");
    }
  });
});

describe("two cards on one pose hand off by key", () => {
  // The login card and step 4 are both pose "default" (Samuel 2026-10-13). A new key must fade
  // the OLD content out, then swap, then fade in — never paint the next card's content early.
  it("🔒 a new glassCardKey keeps the old content through the fade-out, then swaps", () => {
    vi.useFakeTimers();
    try {
      withMeasuredPane();
      const view = (key: string, label: string) => (
        <AuthSplitLayout
          glassPose="default"
          glassCardKey={key}
          glassCardContent={{ default: () => <span data-testid="face">{label}</span> }}
        >
          <form />
        </AuthSplitLayout>
      );
      const { container, rerender } = render(view("login", "LOGIN"));
      const face = () => container.querySelector('[data-testid="face"]')?.textContent;
      const wrap = () => container.querySelector<HTMLElement>("[data-glass-card-fade]")!;
      expect(face()).toBe("LOGIN");
      rerender(view("workspace", "STEP4"));
      expect(face()).toBe("LOGIN");
      expect(wrap().style.opacity).toBe("0");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(face()).toBe("STEP4");
      expect(wrap().style.opacity).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });
});
