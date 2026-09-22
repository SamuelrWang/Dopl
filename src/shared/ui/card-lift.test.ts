// ONE HOVER LIFT, TWO CARD FACES, TWO LANGUAGES — the pin that stops them drifting.
//
// 🔒 SAMUEL, 2026-09-21: the Agents and Knowledge cards *"should have the same animation"*. They
// were not two tunings of one recipe — the Agents face transitioned the SHADOW ONLY and never
// moved — so this file asserts the two faces carry the SAME numbers, in both directions.
//
// ⚠ A SOURCE SCAN, BECAUSE NEITHER VALUE IS COMPARABLE ANY OTHER WAY: a CSS-module class is a build
// artifact and a Tailwind arbitrary is a string. Same idiom as
// `apps/desktop-ui/src/components/skeletons/frame-skeletons.test.tsx`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_LIFT_CLASS,
  CARD_LIFT_SHADOW,
  CARD_LIFT_TRANSITION,
  CARD_LIFT_Y,
} from "./card-lift";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");

const KNOWLEDGE_CSS = read(
  "../../features/knowledge/components/knowledge-v2/knowledge-v2.module.css"
);
const AGENTS_TSX = read("../../features/agent-templates/components/template-section.tsx");

/** `.card:hover { … }` — the rule, without the rest of the sheet. */
function cardHoverRule(css: string) {
  const start = css.indexOf(".card:hover {");
  expect(start, ".card:hover must exist in the knowledge module").toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("the two card faces share one hover lift", () => {
  it("the knowledge card carries the constant's own numbers", () => {
    const rule = cardHoverRule(KNOWLEDGE_CSS);
    expect(rule).toContain(`translateY(${CARD_LIFT_Y})`);
    // ⚠ Whitespace-normalised: the module is prettier-formatted and the constant is not.
    expect(rule.replace(/\s+/g, " ")).toContain(CARD_LIFT_SHADOW.replace(/\s+/g, " "));
  });

  it("the agents card consumes the constant rather than restating it", () => {
    expect(AGENTS_TSX).toContain('from "@/shared/ui/card-lift"');
    expect(AGENTS_TSX).toContain("CARD_LIFT_CLASS");
    // 🚫 THE OLD SHADOW-ONLY RECIPE IS GONE. This is the defect Samuel saw: a face that changed
    // its shadow and never rose, next to one that rose.
    expect(AGENTS_TSX).not.toContain("transition-shadow hover:shadow-[");
  });

  it("both faces MOVE — a shadow-only hover is the bug, not a variant", () => {
    expect(CARD_LIFT_TRANSITION).toContain("transform");
    expect(CARD_LIFT_CLASS).toContain("hover:-translate-y-[");
    expect(cardHoverRule(KNOWLEDGE_CSS)).toContain("transform: translateY(");
  });

  it("the lift is bigger than the 1px it replaced, and the shadow more visible", () => {
    // Samuel: "translate up a bit more and have a slightly more visible shadow". A future tune may
    // move these, but it may not go back UNDER what he rejected.
    const px = Number(CARD_LIFT_Y.replace(/[^\d.]/g, ""));
    expect(px).toBeGreaterThan(1);
    const alphas = [...CARD_LIFT_SHADOW.matchAll(/rgba\([^)]*?([\d.]+)\)/g)].map((m) =>
      Number(m[1])
    );
    expect(alphas.length).toBe(2);
    // The two the knowledge face used to wear were 0.05 and 0.05.
    for (const a of alphas) expect(a).toBeGreaterThan(0.05);
  });

  it("the Tailwind escaping cannot hide a drift", () => {
    // The class string escapes spaces as `_`; unescaping must return the shared shadow exactly, so
    // a number changed on one side and not the other fails here rather than rendering differently.
    const escaped = CARD_LIFT_CLASS.match(/hover:shadow-\[(.+?)\]/);
    expect(escaped, "the class must carry a hover shadow").not.toBeNull();
    const unescaped = String(escaped?.[1]).replace(/_/g, " ").replace(/,(?! )/g, ", ");
    expect(unescaped).toBe(CARD_LIFT_SHADOW);
  });
});

describe("the knowledge card's well is the Shared pill's hue, lighter", () => {
  // 🔒 Samuel, 2026-09-21: *"can you make that gray color lighter? I think it's too dark"* — and
  // 2026-09-19 before it: the well wears *"the same gray as that of the shared pill"*. Both hold:
  // ONE hue, TWO tints.
  it("shares the hue and differs only in the tint", () => {
    expect(KNOWLEDGE_CSS).toContain("--kv-well-tint:");
    expect(KNOWLEDGE_CSS).toContain(
      "background: color-mix(in oklab, var(--kv-hue-private) var(--kv-well-tint), white)"
    );
    // The pill keeps its own amount — it was never the thing called too dark.
    // ⚠ IT MIXES `--kv-scope`, NOT THE HUE DIRECTLY: the pill wears whatever hue its scope
    // rebinds (team = link, public = success), and `.scopePrivate` rebinds it to the private hue.
    // That indirection is WHY the well names the hue itself — a well that read `--kv-scope` would
    // turn blue on a team base.
    expect(KNOWLEDGE_CSS).toContain(
      "background: color-mix(in oklab, var(--kv-scope) var(--kv-pill-tint), white)"
    );
    expect(KNOWLEDGE_CSS).toMatch(
      /\.scopePrivate\s*\{\s*--kv-scope:\s*var\(--kv-hue-private\)/
    );
  });

  it("the well is LIGHTER than the pill, which is the whole ask", () => {
    const tint = (name: string) =>
      Number(KNOWLEDGE_CSS.match(new RegExp(`${name}:\\s*([\\d.]+)%`))?.[1]);
    const well = tint("--kv-well-tint");
    const pill = tint("--kv-pill-tint");
    expect(Number.isFinite(well) && Number.isFinite(pill)).toBe(true);
    // Less of the hue mixed into white = lighter.
    expect(well).toBeLessThan(pill);
  });
});
