// @vitest-environment jsdom
/**
 * SCROLL-UP PAGING'S TWO HALVES — when the next page is asked for, and where the
 * reader ends up when it lands.
 *
 * ⚠ **jsdom DOES NO LAYOUT**, so every geometry read is zero unless it is
 * stubbed. `mountScroller` below stubs exactly two things — the scroller's own
 * rect and each row's — from a fake content map, which is enough because the hook
 * reads nothing else. That is not a weaker test than a real browser would give:
 * the rule under test is arithmetic over those two numbers, and the fixture is
 * where the interesting case (a message arriving at the BOTTOM mid-fetch) can be
 * staged at all.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useLoadOlder } from "./use-load-older";

afterEach(cleanup);

const ROW_H = 20;

/**
 * A scroller whose rows are `ids`, each `ROW_H` tall, stacked from the top of the
 * content box. A row's viewport position is `contentTop - scrollTop`, which is
 * what the browser would report and what the anchor arithmetic consumes.
 */
function Scroller({
  ids,
  canLoad = true,
  loading = false,
  onLoad,
}: {
  ids: string[];
  canLoad?: boolean;
  loading?: boolean;
  onLoad: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLoadOlder(ref, {
    canLoad,
    loading,
    topRowId: ids[0] ?? null,
    rowCount: ids.length,
    onLoad,
  });
  return (
    <div ref={ref} data-testid="scroller">
      {ids.map((id) => (
        <div key={id} data-message-id={id} />
      ))}
    </div>
  );
}

function stubLayout(scroller: HTMLElement, ids: string[]) {
  scroller.getBoundingClientRect = () =>
    ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }) as DOMRect;
  ids.forEach((id, i) => {
    const row = scroller.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (!row) return;
    row.getBoundingClientRect = () =>
      ({
        top: i * ROW_H - scroller.scrollTop,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: ROW_H,
      }) as DOMRect;
  });
}

function mountScroller(
  ids: string[],
  props: { canLoad?: boolean; loading?: boolean } = {}
) {
  const onLoad = vi.fn();
  const view = render(<Scroller ids={ids} onLoad={onLoad} {...props} />);
  const scroller = view.getByTestId("scroller");
  stubLayout(scroller, ids);
  return {
    onLoad,
    scroller,
    scrollTo(top: number) {
      scroller.scrollTop = top;
      fireEvent.scroll(scroller);
    },
    /** A page landed: rerender with the new row list and restub the layout. */
    setRows(next: string[], over: { loading?: boolean } = {}) {
      act(() => {
        view.rerender(
          <Scroller ids={next} onLoad={onLoad} {...props} {...over} />
        );
        stubLayout(scroller, next);
      });
    },
  };
}

describe("asking for the next page", () => {
  it("fires as the reader nears the top", () => {
    const h = mountScroller(["a", "b", "c"]);
    h.scrollTo(4000);
    expect(h.onLoad).not.toHaveBeenCalled();
    h.scrollTo(120);
    expect(h.onLoad).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when there is no more history", () => {
    const h = mountScroller(["a", "b"], { canLoad: false });
    h.scrollTo(0);
    expect(h.onLoad).not.toHaveBeenCalled();
  });

  it("does NOT fire while a page is already in flight", () => {
    const h = mountScroller(["a", "b"], { loading: true });
    h.scrollTo(0);
    expect(h.onLoad).not.toHaveBeenCalled();
  });

  it("fires ONCE for a burst of scroll events, before `loading` can commit", () => {
    // ⚠ The prop cannot have updated yet inside one frame's worth of events, so
    // the held anchor is what has to gate the repeats.
    const h = mountScroller(["a", "b", "c"]);
    h.scrollTo(100);
    h.scrollTo(90);
    h.scrollTo(80);
    expect(h.onLoad).toHaveBeenCalledTimes(1);
  });
});

describe("holding the reading position", () => {
  it("keeps the previously-topmost row exactly where it was", () => {
    const h = mountScroller(["a", "b", "c"]);
    // The reader is 60px down; row "a" sits 60px ABOVE the viewport top.
    h.scrollTo(60);
    expect(h.onLoad).toHaveBeenCalledTimes(1);

    // Two older rows land in front, pushing "a" from content-top 0 to 40.
    h.setRows(["x", "y", "a", "b", "c"]);

    // Without the anchor the reader would still be at 60 — i.e. thrown two rows
    // back into history they did not ask to be in.
    expect(h.scroller.scrollTop).toBe(60 + 2 * ROW_H);
  });

  it("is NOT fooled by a message arriving at the BOTTOM mid-fetch", () => {
    // ⚠ THE CASE A `scrollHeight` DELTA GETS WRONG. Total height grows by three
    // rows, but only two of them are above the anchor; a delta would shove the
    // reader down by the third.
    const h = mountScroller(["a", "b", "c"]);
    h.scrollTo(60);
    h.setRows(["x", "y", "a", "b", "c", "d"]);
    expect(h.scroller.scrollTop).toBe(60 + 2 * ROW_H);
  });

  it("re-arms after the page lands, so the reader can keep going", () => {
    const h = mountScroller(["a", "b", "c"]);
    h.scrollTo(60);
    h.setRows(["x", "y", "a", "b", "c"]);
    h.scrollTo(10);
    expect(h.onLoad).toHaveBeenCalledTimes(2);
  });

  it("re-arms after a page that added NOTHING", () => {
    // ⚠ THE STUCK-FOREVER CASE. An empty or failed `before` read changes no row
    // count, so the restore never runs — the anchor has to be released on the
    // loading edge instead, or every later page is refused in silence.
    const h = mountScroller(["a", "b", "c"], { loading: false });
    h.scrollTo(60);
    expect(h.onLoad).toHaveBeenCalledTimes(1);

    // The request goes out, then settles with nothing to show for it.
    h.setRows(["a", "b", "c"], { loading: true });
    h.setRows(["a", "b", "c"], { loading: false });

    h.scrollTo(20);
    expect(h.onLoad).toHaveBeenCalledTimes(2);
  });

  it("does not move the scroller when the anchor row is gone", () => {
    // Its thread was deleted under the fetch. A lost reading position is not a
    // reason to jump somewhere arbitrary.
    const h = mountScroller(["a", "b", "c"]);
    h.scrollTo(60);
    h.setRows(["x", "y", "b", "c"]);
    expect(h.scroller.scrollTop).toBe(60);
  });
});
