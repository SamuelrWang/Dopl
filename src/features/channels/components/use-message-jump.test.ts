// @vitest-environment jsdom
/**
 * 🔒 **THE TRANSCRIPT ACTUALLY MOVES — the surface half of both jumps.**
 *
 * `transcript-citation.test.tsx` proves a pill hands its seq UP;
 * `lib/message-refs.test.ts` proves the resolver. This file proves the two ends
 * meet, and — since F-714 (2026-09-17) — that a seq a HOST hands in lands the
 * same way: **one mechanism for a citation, a Tags mention and a search hit.**
 *
 * The properties that fail quietly:
 *  - 🔒 **IT WAITS FOR ROWS.** Firing against an empty page resolves EVERY seq to
 *    a miss, so a search hit would land on the "older than the loaded history"
 *    notice instead of on its message — indistinguishable, to the reader, from
 *    the bug F-714 closes.
 *  - 🔒 **A MISS STILL FIRES**, with the sentinel the pane's notice is derived
 *    from. A bare return is the silent-nothing this feature refuses.
 *  - 🔒 **ONCE PER (CHANNEL, THREAD, SEQ).** `rows` changes identity on every
 *    refetch and grows as older history loads; a re-fire would yank a reader who
 *    has scrolled away.
 *
 * MUTATION-VERIFY: 4 reverts, 4 failures, 0 vacuous (2026-09-17) — dropping the
 * `hasRows` guard, keying the ref on the channel alone, dropping the thread from
 * the signal, and returning early on a miss each turn a case here red.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageJump } from "./use-message-jump";

const ROWS = [
  { id: "m-1", seq: 4820 },
  { id: "m-2", seq: 4821 },
];

function mount(over: Partial<Parameters<typeof useMessageJump>[0]> = {}) {
  const jumpToMessage = vi.fn();
  const props = {
    rows: ROWS,
    openThreadId: null,
    initialSeq: null as number | null,
    channelId: "ch-1",
    jumpToMessage,
    ...over,
  };
  const view = renderHook((p: typeof props) => useMessageJump(p), {
    initialProps: props,
  });
  return { ...view, jumpToMessage, props };
}

describe("the initial seq (F-714)", () => {
  it("lands on the message once the transcript has rows", () => {
    const { jumpToMessage } = mount({ initialSeq: 4821 });
    expect(jumpToMessage).toHaveBeenCalledWith(null, "m-2");
  });

  it("🔒 waits for the rows rather than resolving against an empty page", () => {
    const { rerender, jumpToMessage, props } = mount({
      rows: [],
      initialSeq: 4821,
    });
    expect(jumpToMessage).not.toHaveBeenCalled();

    rerender({ ...props, rows: ROWS, initialSeq: 4821 });
    // ⚠ The MESSAGE id, not the sentinel — which is the whole point of waiting.
    expect(jumpToMessage).toHaveBeenCalledWith(null, "m-2");
  });

  it("🔒 fires the sentinel for a seq outside the loaded page", () => {
    const { jumpToMessage } = mount({ initialSeq: 99 });
    // ⚠ NOT a message id, and never read as one: it matches nothing, which is
    // what raises the pane's "older than the loaded history" notice.
    expect(jumpToMessage).toHaveBeenCalledWith(null, "seq:99");
  });

  it("does nothing at all when no seq was named", () => {
    const { jumpToMessage } = mount();
    expect(jumpToMessage).not.toHaveBeenCalled();
  });

  it("🔒 does not re-fire when the rows are refetched", () => {
    const { rerender, jumpToMessage, props } = mount({ initialSeq: 4821 });
    expect(jumpToMessage).toHaveBeenCalledTimes(1);
    // A refetch hands back an equal-but-new array; older history makes it longer.
    rerender({ ...props, rows: [{ id: "m-0", seq: 4819 }, ...ROWS] });
    expect(jumpToMessage).toHaveBeenCalledTimes(1);
  });

  it("re-fires inside the THREAD a hit named", () => {
    const { rerender, jumpToMessage, props } = mount({ initialSeq: 4821 });
    rerender({ ...props, openThreadId: "t-1", initialSeq: 4821 });
    // ⚠ A hit that names a thread arrives as two host moves — select the
    // channel, open the thread — and the seq belongs to the SECOND view.
    expect(jumpToMessage).toHaveBeenLastCalledWith("t-1", "m-2");
    expect(jumpToMessage).toHaveBeenCalledTimes(2);
  });
});

describe("the citation pill's jump, unchanged", () => {
  it("resolves a seq against the loaded rows of the view it is in", () => {
    const { result, jumpToMessage } = mount({ openThreadId: "t-9" });
    result.current(4820);
    expect(jumpToMessage).toHaveBeenCalledWith("t-9", "m-1");
  });
});
