// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STEPS } from "./demo-steps";
import { typedMessageAt } from "./demo-transcript";
import { revealBody, useTypedWords } from "./typed-reveal";

describe("typed reveal (timed loop)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cuts a body to its first n words, and returns it whole at the end", () => {
    expect(revealBody("one two  three", 2)).toBe("one two");
    expect(revealBody("one two  three", 3)).toBe("one two  three");
    expect(revealBody("one two", 0)).toBe("one");
  });

  it("types every human line in full before its beat ends", () => {
    const typed = STEPS.map((_, i) => i).filter((i) => typedMessageAt(i));
    expect(typed.length).toBeGreaterThan(0);
    for (const step of typed) {
      const body = typedMessageAt(step)!.body;
      const { result, unmount } = renderHook(() => useTypedWords(step, body));
      act(() => {
        vi.advanceTimersByTime(STEPS[step].dur);
      });
      expect(revealBody(body, result.current)).toBe(body);
      unmount();
    }
  });
});
