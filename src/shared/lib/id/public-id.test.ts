import { describe, expect, it } from "vitest";
import { PUBLIC_ID_LENGTH, generatePublicId } from "./public-id";

describe("generatePublicId", () => {
  it("returns a 12-character string", () => {
    const id = generatePublicId();
    expect(id).toHaveLength(PUBLIC_ID_LENGTH);
  });

  it("uses lowercase base36 alphabet only", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePublicId()).toMatch(/^[0-9a-z]{12}$/);
    }
  });

  it("produces unique values across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generatePublicId());
    expect(seen.size).toBe(1000);
  });
});
