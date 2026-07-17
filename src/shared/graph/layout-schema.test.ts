import { describe, it, expect } from "vitest";
import { MAX_LAYOUT_NODES, graphLayoutSchema } from "./layout-schema";

describe("graphLayoutSchema", () => {
  it("accepts a well-formed position map", () => {
    const parsed = graphLayoutSchema.safeParse({
      "node-1": { x: 10, y: 20 },
      "node-2": { x: -5.5, y: 0 },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty map (pure auto-layout)", () => {
    expect(graphLayoutSchema.safeParse({}).success).toBe(true);
  });

  it("rejects NaN / Infinity coordinates", () => {
    expect(graphLayoutSchema.safeParse({ a: { x: NaN, y: 0 } }).success).toBe(false);
    expect(graphLayoutSchema.safeParse({ a: { x: Infinity, y: 0 } }).success).toBe(false);
  });

  it("rejects a string coordinate", () => {
    expect(graphLayoutSchema.safeParse({ a: { x: "10", y: 0 } }).success).toBe(false);
  });

  it("rejects an out-of-bounds coordinate", () => {
    expect(graphLayoutSchema.safeParse({ a: { x: 5_000_000, y: 0 } }).success).toBe(false);
  });

  it("rejects extra keys on a position", () => {
    expect(
      graphLayoutSchema.safeParse({ a: { x: 1, y: 2, z: 3 } }).success
    ).toBe(false);
  });

  it("rejects a blob with too many nodes", () => {
    const huge: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i <= MAX_LAYOUT_NODES; i++) huge[`n${i}`] = { x: 0, y: 0 };
    expect(graphLayoutSchema.safeParse(huge).success).toBe(false);
  });
});
