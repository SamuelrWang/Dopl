// A HOVER LIFT MUST NOT MOVE THE HIT BOX OUT FROM UNDER THE CURSOR.
//
// Samuel, 2026-10-26: the cursor *"will start flashing and glitching in between the hand and the
// normal arrow cursor a ton"*. Root cause: every lift recipe translated the hovered element, and
// the hit box moves with a transform, so a cursor on the bottom `--lift` px left the element, lost
// `:hover`, the element dropped back under it and was hovered again — a loop. A transparent
// `::after` band fills the vacated strip while hovered; this file pins that every `:hover` lift in
// either tree (the kit, and the page-scoped landing CSS that restates it) has the band.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const KITS = ["src/app/globals.css", "apps/desktop-ui/src/styles/kit.css"];

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `selector { body }` pair, flattened out of at-rules. */
function rules(css: string) {
  const out: { selector: string; body: string }[] = [];
  for (const m of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2].replace(/\s+/g, " ") });
  }
  return out;
}

const LIFT = /transform:\s*translateY\(\s*(-|calc\(-)/;
const BAND_SUFFIX = ":hover:not(:disabled)::after";
const isLift = (r: { selector: string; body: string }) => r.selector.includes(":hover") && LIFT.test(r.body);

/** The banded recipes' compound selectors (`.raise`, `.lp-audio-toggle[data-on-dark]`), or null. */
function band(css: string) {
  const rule = rules(css).find((r) => r.selector.endsWith(BAND_SUFFIX));
  if (!rule) return null;
  const head = rule.selector.slice(0, -BAND_SUFFIX.length);
  const list = /^:where\((.*)\)$/.exec(head)?.[1] ?? "";
  return { rule, head, members: list.split(",").map((m) => m.trim()) };
}

function walk(dir: string, acc: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(css|tsx|ts)$/.test(name) && !/\.test\./.test(name)) acc.push(path);
  }
  return acc;
}

const FILES = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "apps/desktop-ui/src"))];
const CSS = FILES.filter((p) => p.endsWith(".css")).map((p) => ({
  rel: relative(ROOT, p),
  css: readFileSync(p, "utf8"),
}));

describe("the kit's lift recipes keep a still hit box", () => {
  for (const file of KITS) {
    it(`${file}: every kit lift recipe is in the band`, () => {
      const b = band(CSS.find((c) => c.rel === file)!.css);
      expect(b, "the hit band rule").toBeTruthy();
      expect(b!.members).toEqual(
        expect.arrayContaining([
          ".auth-btn-3d",
          ".auth-btn-3d-light",
          ".btn-light",
          ".card-lift",
          ".raise",
          ".raise-pill",
          ".raise-ink",
        ])
      );
    });
  }
});

describe("every hover lift in either tree is banded", () => {
  const lifting = CSS.filter((c) => rules(c.css).some(isLift));

  it("finds the kit and the landing lifts", () => {
    const rels = lifting.map((c) => c.rel);
    for (const file of KITS) expect(rels).toContain(file);
    expect(rels).toContain("src/features/marketing/marketing.css");
  });

  for (const { rel, css } of lifting) {
    it(`${rel}: each lift rises by --lift over a banded, positioned recipe`, () => {
      const b = band(css);
      expect(b, "the file declares the hit band").toBeTruthy();
      expect(b!.rule.body).toContain('content: ""');
      expect(b!.rule.body).toContain("position: absolute");
      expect(b!.rule.body).toContain("top: 100%");
      expect(b!.rule.body).toContain("height: calc(var(--lift) + 1px)");
      const anchor = rules(css).find((r) => r.selector === b!.head);
      expect(anchor?.body, "the band's containing block").toContain("position: relative");

      for (const r of rules(css).filter(isLift)) {
        expect(r.body, r.selector).toContain("translateY(calc(-1 * var(--lift)))");
        for (const sel of r.selector.split(",").filter((x) => x.includes(":hover"))) {
          const compound = sel.trim().split(":hover")[0];
          expect(b!.members, `${compound} is in the hit band`).toContain(compound);
          const declared = rules(css).some(
            (x) => x.selector.split(",").some((s) => s.trim() === compound) && /--lift:\s*\dpx/.test(x.body)
          );
          expect(declared, `${compound} declares --lift`).toBe(true);
        }
      }
    });
  }

  it("no TSX uses a hover translate utility", () => {
    const offenders = FILES.filter((p) => !p.endsWith(".css") && /hover:-translate-y-/.test(readFileSync(p, "utf8")));
    expect(offenders.map((p) => relative(ROOT, p))).toEqual([]);
  });
});
