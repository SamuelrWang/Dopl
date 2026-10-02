import { describe, it, expect } from "vitest";
import { mergeStoredLayout } from "./positions";

describe("mergeStoredLayout", () => {
  it("replaces with {} for the empty (reset) patch, ignoring current", () => {
    expect(mergeStoredLayout({ a: { x: 1, y: 2 } }, {})).toEqual({});
  });

  it("shallow-merges a non-empty patch over the current layout by node id", () => {
    const current = { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } };
    const out = mergeStoredLayout(current, { b: { x: 9, y: 9 }, c: { x: 3, y: 3 } });
    expect(out).toEqual({
      a: { x: 1, y: 1 },
      b: { x: 9, y: 9 },
      c: { x: 3, y: 3 },
    });
  });

  it("treats a null/undefined current layout as empty", () => {
    expect(mergeStoredLayout(null, { a: { x: 1, y: 1 } })).toEqual({ a: { x: 1, y: 1 } });
    expect(mergeStoredLayout(undefined, { a: { x: 1, y: 1 } })).toEqual({ a: { x: 1, y: 1 } });
  });
});

