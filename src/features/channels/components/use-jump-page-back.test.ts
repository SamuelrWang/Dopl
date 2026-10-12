// @vitest-environment jsdom
/**
 * **THE HUNT'S RULES** — `use-jump-page-back.ts`, the driver that turns a jump
 * landing off the loaded page from a sentence into a scroll (Samuel, 2026-10-12).
 *
 * The landing itself is `message-pane.tsx`'s and is tested behaviourally in
 * `message-pane-page-back.test.tsx` with a fake pager. THIS file pins the parts a
 * rendered pane makes awkward to reach: the two bounds, the cancel, and the
 * re-resolution that makes a paged-in row actually land.
 *
 * ⚠ **THE RE-RESOLUTION IS THE NON-OBVIOUS ONE.** `citationScrollTargetId`
 * resolved the seq at CLICK time and minted `seq:<n>` because the row was absent.
 * The scroll target still holds that string afterwards, so a page that brings the
 * row in changes nothing unless something re-resolves it. That is `targetId`, and
 * without it the hunt would succeed and still not land.
 *
 * ⚠ **A HUNT IS DRIVEN BY ATTEMPTS, NOT BY A CLOCK**, so a "page" here is what a
 * page really is on the wire: `loadingOlder` true, then false. Rerendering with
 * unchanged props fires no effect, which is exactly right and is why the helper
 * below toggles.
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useJumpPageBack } from "./use-jump-page-back";

/** Newest page: seqs 8..10. Everything older is "not loaded yet". */
const NEWEST = [
  { id: "m-8", seq: 8 },
  { id: "m-9", seq: 9 },
  { id: "m-10", seq: 10 },
];

type Props = Parameters<typeof useJumpPageBack>[0];

function mount(over: Partial<Props> = {}) {
  const onLoadOlder = vi.fn();
  let props: Props = {
    scrollTarget: { messageId: "seq:1", nonce: 1 },
    rows: NEWEST,
    hasOlder: true,
    loadingOlder: false,
    onLoadOlder,
    maxPages: 3,
    deadlineMs: 60_000,
    ...over,
  };
  const view = renderHook((p: Props) => useJumpPageBack(p), {
    initialProps: props,
  });
  /** Re-render with a patch, keeping the rest. */
  const set = (patch: Partial<Props>) => {
    props = { ...props, ...patch };
    act(() => view.rerender(props));
  };
  /** One real page on the wire: in flight, then settled. */
  const page = (patch: Partial<Props> = {}) => {
    set({ loadingOlder: true });
    set({ loadingOlder: false, ...patch });
  };
  return { ...view, onLoadOlder, set, page };
}

describe("a target already on the page is not hunted", () => {
  it("a real id among the rows is found, and asks for nothing", () => {
    const { result, onLoadOlder } = mount({
      scrollTarget: { messageId: "m-9", nonce: 1 },
    });
    expect(result.current.found).toBe(true);
    expect(result.current.hunting).toBe(false);
    expect(result.current.targetId).toBe("m-9");
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("🔒 a SENTINEL whose seq is loaded resolves to the real id", () => {
    // The ordinary pill hit, expressed as a miss sentinel the host never needed.
    const { result, onLoadOlder } = mount({
      scrollTarget: { messageId: "seq:9", nonce: 1 },
    });
    expect(result.current.targetId).toBe("m-9");
    expect(result.current.found).toBe(true);
    expect(onLoadOlder).not.toHaveBeenCalled();
  });
});

describe("a target off the page is hunted", () => {
  it("asks for an older page and reports that it is hunting", () => {
    const { result, onLoadOlder } = mount();
    expect(result.current.hunting).toBe(true);
    expect(result.current.found).toBe(false);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("🔒 lands once a page brings the row in — the re-resolution", () => {
    const { result, page } = mount();
    page({ rows: [{ id: "m-1", seq: 1 }, ...NEWEST] });
    expect(result.current.found).toBe(true);
    expect(result.current.hunting).toBe(false);
    // ⚠ The real id, NOT the `seq:1` the scroll target still carries.
    expect(result.current.targetId).toBe("m-1");
  });

  it("🔒 hunts a REAL id that is off the page — the Mentions row's case", () => {
    // A mention row jumps by message id and has no seq to offer. The hunt needs
    // none: the predicate is "is this id among the rows".
    const { result, onLoadOlder } = mount({
      scrollTarget: { messageId: "m-2", nonce: 1 },
    });
    expect(result.current.hunting).toBe(true);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("🔒 does not stack a second request while a page is in flight", () => {
    const { onLoadOlder, set } = mount();
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    set({ loadingOlder: true });
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});

describe("the bounds — both end in the honest notice", () => {
  it("🔒 does not hunt when there is no older history", () => {
    // Today's behaviour, preserved: nothing to page, so the pane says so at once.
    const { result, onLoadOlder } = mount({ hasOlder: false });
    expect(result.current.hunting).toBe(false);
    expect(result.current.found).toBe(false);
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("🔒 gives up after maxPages, and STOPS hunting so the notice can show", async () => {
    // ⚠ The visibility is the point. A cap that merely stopped requesting would
    // leave `hunting` true forever — no landing and no notice, a hang dressed as
    // patience.
    const { result, onLoadOlder, page } = mount({ maxPages: 3 });
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    page();
    page();
    expect(onLoadOlder).toHaveBeenCalledTimes(3);
    page();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onLoadOlder).toHaveBeenCalledTimes(3);
    expect(result.current.hunting).toBe(false);
    expect(result.current.found).toBe(false);
  });

  it("🔒 gives up on the deadline, for the stuck fetch the cap cannot see", async () => {
    // `loadingOlder` never comes back down, so no attempt is ever made and the
    // page cap is never reached. Only a clock can end this one.
    vi.useFakeTimers();
    try {
      const { result, set } = mount({ deadlineMs: 1_000 });
      set({ loadingOlder: true });
      expect(result.current.hunting).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(1_100);
      });
      expect(result.current.hunting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a newer click cancels the one in flight", () => {
  it("🔒 a new nonce restarts the budget rather than inheriting a spent one", async () => {
    const { result, onLoadOlder, page, set } = mount({ maxPages: 2 });
    page();
    page();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hunting).toBe(false);
    const spent = onLoadOlder.mock.calls.length;

    // The reader clicks a different citation.
    set({ scrollTarget: { messageId: "seq:2", nonce: 2 } });
    expect(result.current.hunting).toBe(true);
    expect(onLoadOlder.mock.calls.length).toBeGreaterThan(spent);
  });

  it("🔒 an abandoned nonce does not pre-abandon the NEXT target", async () => {
    const { result, page, set } = mount({ maxPages: 1 });
    page();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hunting).toBe(false);
    set({ scrollTarget: { messageId: "m-4", nonce: 7 } });
    expect(result.current.hunting).toBe(true);
  });
});
