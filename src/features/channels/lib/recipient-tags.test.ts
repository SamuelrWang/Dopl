import { describe, expect, it } from "vitest";
import { addressKey } from "./recipient-tags";

describe("addressKey", () => {
  it("a repeated id is one address, as the rendered tag is (F24)", () => {
    expect(addressKey({ agentIds: ["a", "a"], userIds: [] })).toBe(
      addressKey({ agentIds: ["a"], userIds: [] })
    );
  });

  it("is order-insensitive, and keeps absent (`?`) apart from empty", () => {
    expect(addressKey({ agentIds: ["b", "a"], userIds: null })).toBe("a,b|?");
    expect(addressKey({ agentIds: null, userIds: [] })).toBe("?|");
  });
});
