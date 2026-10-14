import { describe, expect, it } from "vitest";
import { cardPath, cardRegions, glassBox, glassShape, poseDepths, type CardRect } from "./auth-glass-geometry";
import { panelPath } from "./panel-shape";

/** The split is `w × 2/3`, which is not exact in floating point. */
function near(got: CardRect | null, want: CardRect) {
  expect(got).not.toBeNull();
  for (const k of ["x", "y", "w", "h"] as const) expect(got![k]).toBeCloseTo(want[k], 6);
}

describe("cardRegions", () => {
  const w = 600;
  const h = 300;

  it("splits the lowered card into a full-height left and a right under the bite", () => {
    const { main, side } = cardRegions("lowered-top-notch", w, h);
    const d = poseDepths("lowered-top-notch", w, h).top;
    near(main, { x: 34, y: 34, w: 400 - 34 - 34, h: h - 68 });
    near(side, { x: 400 - 34, y: 34 + d, w: w - 34 - (400 - 34), h: h - 68 - d });
    // The two halves meet on the bite's wall, never overlap.
    expect(main.x + main.w).toBeCloseTo(side!.x, 6);
  });

  it("mirrors for the raised card: full-height right, short left over the bite", () => {
    const { main, side } = cardRegions("raised-bottom-notch", w, h);
    const d = poseDepths("raised-bottom-notch", w, h).bot;
    near(main, { x: 200 + 34, y: 34, w: w - 34 - (200 + 34), h: h - 68 });
    near(side, { x: 34, y: 34, w: 200, h: h - 68 - d });
  });

  it("is one rect with no side in the default pose", () => {
    expect(cardRegions("default", w, h)).toEqual({
      main: { x: 34, y: 34, w: w - 68, h: h - 68 },
      side: null,
    });
  });
});

describe("vertical-left-top-notch", () => {
  it("keeps the white card's bite corners at the card radius (they collapsed to 1.5px)", () => {
    const b = glassBox("vertical-left-top-notch", 502, 688);
    const d = cardPath("vertical-left-top-notch", b.w, b.h);
    // Each Q's control point to its end point is one corner radius on one axis.
    const qs = [...d.matchAll(/Q ([\d.]+),([\d.]+) ([\d.]+),([\d.]+)/g)].map((m) =>
      Math.max(Math.abs(+m[1] - +m[3]), Math.abs(+m[2] - +m[4]))
    );
    const real = qs.filter((v) => v > 0.01);
    expect(Math.min(...real)).toBeGreaterThan(13.9);
  });

  const pane = { w: 560, h: 750 };
  const poses = ["default", "lowered-top-notch", "raised-bottom-notch", "vertical-left-top-notch"] as const;
  const cmds = (d: string) => d.match(/[MLQZ]/g)?.join("") ?? "";

  it("is the horizontal box transposed (and widened 12%), against the left edge", () => {
    const h = glassBox("raised-bottom-notch", pane.w, pane.h);
    const v = glassBox("vertical-left-top-notch", pane.w, pane.h);
    expect(v.w).toBeCloseTo(h.h * 1.12, 6);
    expect(v.h).toBeCloseTo(h.w, 6);
    expect(v.x).toBeCloseTo(h.x, 6);
    expect(v.y + v.h / 2).toBeCloseTo(pane.h / 2, 6);
  });

  it("emits the SAME command sequence in every pose, so any two morph", () => {
    const seqs = poses.map((p) => {
      const b = glassBox(p, pane.w, pane.h);
      const d = panelPath(b.w, b.h, glassShape(b.w, poseDepths(p, b.w, b.h)), { radius: 20, notchRadius: 20 });
      expect(d).not.toContain("NaN");
      return cmds(d);
    });
    expect(new Set(seqs).size).toBe(1);
  });

  it("bites the TOP-LEFT corner at rest", () => {
    const b = glassBox("vertical-left-top-notch", pane.w, pane.h);
    const shape = glassShape(b.w, poseDepths("vertical-left-top-notch", b.w, b.h));
    const d = panelPath(b.w, b.h, shape, { radius: 20, notchRadius: 20 });
    // Starts on the top edge right of the wall; the left edge rises only to
    // the bite's floor.
    expect(d.startsWith(`M ${Math.round((shape.leftSplit! + 20) * 100) / 100},0`)).toBe(true);
    expect(d).toContain(`L 0,${Math.round((shape.leftDepth! + 20) * 100) / 100}`);
  });

  it("cuts the card into the full-width part under the bite and the strip beside it", () => {
    const { main, side } = cardRegions("vertical-left-top-notch", 270, 470);
    const d = poseDepths("vertical-left-top-notch", 270, 470).left;
    near(main, { x: 34, y: 34 + d, w: 270 - 68, h: 470 - 68 - d });
    expect(side!.y).toBe(34);
    expect(side!.h).toBeCloseTo(d, 6);
    expect(side!.x + side!.w).toBeCloseTo(270 - 34, 6);
    // Square, so step 3's square text block sits with equal gaps all round.
    expect(side!.h).toBeCloseTo(side!.w, 6);
  });
});
