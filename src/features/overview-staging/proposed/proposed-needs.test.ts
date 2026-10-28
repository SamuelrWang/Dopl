import { describe, expect, it } from "vitest";
import { needsLabel } from "./proposed-needs";
import { humanTokens } from "./proposed-section";

describe("proposed Overview figures", () => {
  it("prints the real needs count, and floors a clipped one to tens", () => {
    expect(needsLabel(6, false)).toBe("6");
    expect(needsLabel(23, true)).toBe("20+");
    expect(needsLabel(4, true)).toBe("4+");
  });

  it("humanises tokens with a billions arm, flooring", () => {
    expect(humanTokens(4_876_300_000)).toBe("4.8B");
    expect(humanTokens(84_500)).toBe("84k");
  });
});
