// A HOVER LIFT MUST NOT MOVE THE HIT BOX OUT FROM UNDER THE CURSOR.
//
// Samuel, 2026-10-26: the cursor *"will start flashing and glitching in between the hand and the
// normal arrow cursor a ton"*. Root cause: every lift recipe translated the hovered element, and
// the hit box moves with a transform, so a cursor on the bottom `--lift` px left the element, lost
// `:hover`, the element dropped back under it and was hovered again — a loop. The kit fills the
// vacated strip with a transparent `::after` band while hovered; this file pins that every lift
// is a kit recipe that has the band.

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

function hitBoxClasses(css: string) {
  const band = rules(css).find((r) => r.selector.endsWith(":hover:not(:disabled)::after"));
  expect(band, "the hit band rule").toBeTruthy();
  return { band: band!, classes: [...band!.selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]) };
}

describe("the kit's lift recipes keep a still hit box", () => {
  for (const file of KITS) {
    const css = readFileSync(join(ROOT, file), "utf8");
    const { band, classes } = hitBoxClasses(css);

    it(`${file}: the band fills the vacated strip below the face`, () => {
      expect(band.body).toContain('content: ""');
      expect(band.body).toContain("position: absolute");
      expect(band.body).toContain("top: 100%");
      expect(band.body).toContain("height: calc(var(--lift) + 1px)");
      const anchor = rules(css).find((r) => r.selector === band.selector.replace(":hover:not(:disabled)::after", ""));
      expect(anchor?.body, "the band's containing block").toContain("position: relative");
    });

    it(`${file}: every hover lift is a banded recipe that rises by its own --lift`, () => {
      const lifts = rules(css).filter((r) => r.selector.includes(":hover") && LIFT.test(r.body));
      expect(lifts.length).toBeGreaterThan(0);
      for (const r of lifts) {
        expect(r.body, r.selector).toContain("translateY(calc(-1 * var(--lift)))");
        for (const sel of r.selector.split(",")) {
          const cls = /^\.([\w-]+):hover/.exec(sel.trim())?.[1];
          expect(cls && classes.includes(cls), `${sel.trim()} is in the hit band`).toBe(true);
        }
      }
      for (const cls of classes) {
        const declared = rules(css).some(
          (r) => r.selector.split(",").some((s) => s.trim() === `.${cls}`) && /--lift:\s*\dpx/.test(r.body)
        );
        expect(declared, `.${cls} declares --lift`).toBe(true);
      }
    });
  }
});

// Marketing, the landing-scene staging and install animations are page-scoped and outside the kit.
const EXEMPT = /\/(marketing|ui-staging|get-started)\//;

function walk(dir: string, acc: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(css|tsx|ts)$/.test(name) && !/\.test\./.test(name)) acc.push(path);
  }
  return acc;
}

describe("no surface hand-rolls a hover lift outside the kit", () => {
  it("no CSS module lifts on :hover and no TSX uses a hover translate utility", () => {
    const offenders: string[] = [];
    for (const path of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "apps/desktop-ui/src"))]) {
      const rel = relative(ROOT, path);
      if (EXEMPT.test(path) || KITS.includes(rel)) continue;
      const text = readFileSync(path, "utf8");
      if (path.endsWith(".css")) {
        for (const r of rules(text)) if (r.selector.includes(":hover") && LIFT.test(r.body)) offenders.push(`${rel} ${r.selector}`);
      } else if (/hover:-translate-y-/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
