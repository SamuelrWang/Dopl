/**
 * **WHITE INK IS READABLE ON ALL SIXTEEN AGENT FILLS — MEASURED, NOT ASSUMED.**
 *
 * Bought on 2026-10-10, when the working strip stopped putting the agent's colour in
 * a 6px dot and started wearing it as a PILL FILL with the agent's name on top
 * (`components/agent-activity.tsx`). A dot has no contrast requirement at all; a
 * filled label has one per hue, and `agent-bits.tsx › AGENT_PILL_FACE` answers it
 * with ONE ink (`--text-on-cta`, `#ffffff`) for every key.
 *
 * ⚠ **THE ONE-INK DECISION IS ONLY SAFE BECAUSE THE RAMP IS ONE LIGHTNESS**, which
 * `docs/DESIGN-SYSTEM.md` states as a design rule (*"ONE SATURATION AND ONE
 * LIGHTNESS, HUE ONLY"*) and `agent-color-values.ts` holds as data. The day somebody
 * lightens a hue to make it "pop", white on it stops reading and NOTHING ELSE IN THE
 * REPO WOULD FAIL — the tint still renders, the pill still paints, and the only
 * symptom is a name nobody can read. This is that failure, as a gate.
 *
 * ⚠ **IT ASSERTS THE RATIO, NOT THE LIGHTNESS.** Pinning `l === 0.44` would forbid a
 * palette change that is perfectly fine; pinning the ratio forbids only the ones that
 * cost legibility, which is the thing actually being protected.
 *
 * ⚠ **THERE IS NO SECOND THEME TO CHECK, AND THAT IS ASSERTED TOO** (the last case).
 * `globals.css`'s own header says *"one palette in :root, no dark/light split"* — so
 * "contrast in both themes" has one answer here, and a `.dark`/`prefers-color-scheme`
 * block appearing later would make this file's single verdict a half-truth.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { AGENT_COLOR_KEYS } from "./agent-colors";
import { AGENT_COLOR_VALUES } from "./agent-color-values";

/** WCAG 2.1: normal text needs 4.5. */
const AA_NORMAL = 4.5;
/**
 * The floor the ramp actually sits on, with room for a hue tweak but not for a
 * LIGHTNESS one.
 *
 * ⚠ **NOT 7, AND THE NEAR-MISS IS WHY THIS NUMBER IS WRITTEN DOWN.** The worst hue
 * (H=200) measures **6.999:1** — a thousandth under AAA's 7. So the honest claim about
 * this palette is "AA with half again the margin, and AAA to within a rounding error",
 * never "AAA". Asserting 7 here would have failed on a palette nobody had changed.
 */
const RAMP_FLOOR = 6.9;

/** `--text-on-cta`, the pill's ink. */
const INK: Rgb = [1, 1, 1];

type Rgb = readonly [number, number, number];

/**
 * Oklch → sRGB, then CLAMPED to gamut.
 *
 * ⚠ **THE CLAMP IS THE POINT, NOT A ROUNDING CONVENIENCE.** Seven of the sixteen hues
 * are outside sRGB at this chroma, so the unclamped channels go negative; a browser
 * shows the clipped colour, and the clipped colour is the one a reader's contrast is
 * against. Measuring the unclamped value would answer a question nobody is asking.
 */
function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;
  const L = lp ** 3;
  const M = mp ** 3;
  const S = sp ** 3;
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const enc = (u: number) => {
    const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  };
  return [enc(lin[0]), enc(lin[1]), enc(lin[2])] as const;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const f = (u: number) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("white ink on the agent colour bank", () => {
  it.each(AGENT_COLOR_KEYS)("%s clears WCAG AA for normal text", (key) => {
    const { l, c, h } = AGENT_COLOR_VALUES[key];
    expect(contrast(INK, oklchToSrgb(l, c, h))).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("holds the same floor on EVERY key, which is what buys a single ink rule", () => {
    // ⚠ One assertion over all sixteen rather than sixteen, because the CLAIM is about
    // the ramp: "no key needs its own ink" is a property of the set, and the worst key
    // is the only one that could withdraw it.
    const worst = Math.min(
      ...AGENT_COLOR_KEYS.map((key) => {
        const { l, c, h } = AGENT_COLOR_VALUES[key];
        return contrast(INK, oklchToSrgb(l, c, h));
      })
    );
    expect(worst).toBeGreaterThanOrEqual(RAMP_FLOOR);
  });

  it("is a FLAT ramp as far as the reader is concerned — no key is an outlier", () => {
    // The spread stays small only while lightness is uniform. A hue lightened on its own
    // would widen this long before it broke AA, so this fails EARLY and says why.
    const ratios = AGENT_COLOR_KEYS.map((key) => {
      const { l, c, h } = AGENT_COLOR_VALUES[key];
      return contrast(INK, oklchToSrgb(l, c, h));
    });
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(2);
  });

  it("has ONE palette, so there is no second theme to measure", () => {
    // ⚠ Reads the stylesheet rather than trusting the comment in it. The agent tokens are
    // declared once; a theme block would have to redeclare them to matter.
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const declarations = css.match(/--agent-color-01\s*:/g) ?? [];
    expect(declarations).toHaveLength(1);
    expect(css).not.toMatch(/prefers-color-scheme/);
  });
});
