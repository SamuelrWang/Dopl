// ONE HOVER LIFT, TWO CARD FACES — the kit's `.card-lift` and the knowledge card's `.card:hover`.
//
// 🔒 SAMUEL, 2026-09-21: the Agents and Knowledge cards *"should have the same animation"*.
// ⚠ P9-01: the Agents half used to be Tailwind arbitraries built by TEMPLATE interpolation, which
// Tailwind never emits (it scans literal source text) — so the identity card got a transition and
// no lift while a string-comparing test passed. The lift is a kit class and a token now, and this
// file checks the CSS both faces actually load.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");

const KNOWLEDGE_CSS = read(
  "../../features/knowledge/components/knowledge-v2/knowledge-v2.module.css"
);
const AGENTS_TSX = read("../../features/agent-identities/components/identity-section.tsx");
const KITS = {
  "src/app/globals.css": read("../../app/globals.css"),
  "apps/desktop-ui/src/styles/kit.css": read("../../../apps/desktop-ui/src/styles/kit.css"),
};
const TOKENS = {
  "src/app/globals.css": KITS["src/app/globals.css"],
  "apps/desktop-ui/src/styles/tokens.css": read("../../../apps/desktop-ui/src/styles/tokens.css"),
};

/** One rule's body, comments stripped and whitespace collapsed. */
function rule(css: string, selector: string) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = clean.indexOf(`${selector} {`);
  expect(start, `${selector} must exist`).toBeGreaterThan(-1);
  return clean.slice(start, clean.indexOf("}", start)).replace(/\s+/g, " ");
}

const token = (css: string) =>
  /--shadow-card-lift:\s*([^;]+);/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1].trim();

describe("the two card faces share one hover lift", () => {
  it("both kit copies define `.card-lift` — a rise AND the token shadow, both transitioned", () => {
    for (const [file, css] of Object.entries(KITS)) {
      const hover = rule(css, ".card-lift:hover");
      expect(hover, file).toContain("transform: translateY(-3px)");
      expect(hover, file).toContain("box-shadow: var(--shadow-card-lift)");
      const base = rule(css, ".card-lift");
      expect(base, file).toContain("transform");
      expect(base, file).toContain("box-shadow");
    }
  });

  it("the token is declared once per tree, with one value", () => {
    const values = Object.entries(TOKENS).map(([file, css]) => {
      const v = token(css);
      expect(v, `${file} declares --shadow-card-lift`).toBeTruthy();
      return v;
    });
    expect(new Set(values).size).toBe(1);
  });

  it("the knowledge card rises the same distance onto the same token", () => {
    const hover = rule(KNOWLEDGE_CSS, ".card:hover");
    expect(hover).toContain("transform: translateY(-3px)");
    expect(hover).toContain("box-shadow: var(--shadow-card-lift)");
  });

  it("the identity card wears the kit class as a literal — nothing for Tailwind to miss", () => {
    expect(AGENTS_TSX).toContain('"card-lift"');
    expect(AGENTS_TSX).not.toMatch(/hover:-translate-y-\[|hover:shadow-\[|CARD_LIFT/);
  });

  it("the lift is bigger than the 1px it replaced, and the shadow more visible", () => {
    // Samuel: "translate up a bit more and have a slightly more visible shadow".
    const alphas = [...String(token(TOKENS["src/app/globals.css"])).matchAll(/rgba\([^)]*?([\d.]+)\)/g)].map(
      (m) => Number(m[1])
    );
    expect(alphas.length).toBe(2);
    for (const a of alphas) expect(a).toBeGreaterThan(0.05);
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
