// @vitest-environment jsdom
/**
 * 🔒 **EVERY CLASS THE HERO SCENE EMITS MUST RESOLVE IN THE CSS THE LANDING PAGE
 * ACTUALLY LOADS.** Samuel, 2026-09-17, after rejecting the scene: *"AUDIT EVERY
 * CLASS the demo emits against the CSS the marketing page actually loads … This
 * is the gate that would have caught this."*
 *
 * ⚠ **THE TWO TREES LOAD DIFFERENT STYLESHEETS, AND THAT IS THE WHOLE RISK.**
 * The SPA's entry is `apps/desktop-ui/src/styles/index.css` — Tailwind, then
 * `tokens.css`, then `kit.css`, plus every CSS MODULE its pages import
 * (`pages/home/home.module.css`, `app-shell/account-rail.module.css`, …). The
 * landing page loads `src/app/globals.css` (from the root layout) and
 * `src/features/marketing/marketing.css` (from `src/app/page.tsx`) and **nothing
 * else** — no kit copy, and no CSS module, because a module's class names are
 * hashed and belong to the file that imports them. **A recipe that lives only in
 * a module or only in `kit.css` renders as NOTHING in this scene**, silently,
 * which is exactly how a scene can look "super off" while every component in it
 * is the product's own.
 *
 * ⚠ **THE CSS IS COMPILED, NOT GREPPED.** Tailwind v4 generates utilities from a
 * source scan, so the question "does `bg-[var(--seg-fill)]` exist" cannot be
 * answered by reading `globals.css` — it is answered by running the same
 * PostCSS plugin the Next build runs, over the same two files, and looking at
 * the output. Measured 2026-09-17: ~350ms, ~220KB.
 *
 * ⚠ **IT ASSERTS PER CLASS, NOT PER FILE.** A missing selector names itself, so
 * a failure here tells you which recipe to port into `marketing.css` (scoped to
 * the demo root, byte-identical, with a comment naming its source rule) rather
 * than that "something is off".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { DemoScene } from "./demo-scene";
import { stepIndex } from "./demo-steps";

/** The two stylesheets the landing page loads, in load order.
 *  ⚠ `src/app/layout.tsx` imports the first; `src/app/page.tsx` the second. */
const SHEETS = [
  "src/app/globals.css",
  "src/features/marketing/marketing.css",
] as const;

/** Repo root — this file is five levels under it.
 *  ⚠ THE SPECIFIER IS A VARIABLE ON PURPOSE. Vite rewrites
 *  `new URL("<literal>", import.meta.url)` into an ASSET url, which under vitest
 *  comes back on a non-`file:` scheme; held in a const, the call is left alone.
 *  The same guard `pages/home/panel-buttons.test.tsx` carries. */
const UP = "../../../../../";
const ROOT = fileURLToPath(new URL(UP, import.meta.url));

/** The beat where every control the scene can draw is on stage. */
const LAST_STEP = stepIndex("hold");

/**
 * THE ONE EXEMPTION, AND IT IS NARROW ON PURPOSE.
 *
 * `lucide-react` stamps every icon it renders with `lucide` plus a
 * `lucide-<name>` identity hook. **Neither carries any style in this product** —
 * measured 2026-09-17: `grep -c lucide` is `0` in `src/app/globals.css`,
 * `src/features/marketing/marketing.css` AND `apps/desktop-ui/src/styles/kit.css`,
 * so an icon renders identically on both hosts with them unresolved. They are a
 * library's own marker, not a recipe this scene is missing.
 *
 * ⚠ **A PREFIX, NOT A LIST, AND NOTHING ELSE MAY JOIN IT.** Every other
 * unresolved class in this scene is a real hole — one was found the first time
 * this gate ran (`lp-demo-rail-create`, emitted and defined nowhere). **Adding a
 * second entry here is how that gate stops working**; port the missing rule into
 * `marketing.css` instead.
 */
const UNSTYLED = (c: string) => c === "lucide" || c.startsWith("lucide-");

let selectors = new Set<string>();

beforeAll(async () => {
  const css = SHEETS.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
  const out = await postcss([tailwind({ base: ROOT })]).process(css, {
    from: join(ROOT, SHEETS[0]),
  });
  // Every class selector the compiled sheet defines, un-escaped back to the
  // spelling a `class` attribute uses (`.bg-\[var\(--x\)\]` → `bg-[var(--x)]`).
  selectors = new Set(
    [...out.css.matchAll(/\.((?:[\w-]|\\.)+)/g)].map((m) =>
      m[1].replace(/\\(.)/g, "$1")
    )
  );
}, 120_000);

afterAll(cleanup);

/**
 * Every distinct class name in a rendered subtree.
 *
 * ⚠ **`getAttribute("class")`, NEVER `el.className`.** On an SVG element that
 * property is an `SVGAnimatedString`, so `String(el.className)` yields
 * `"[object SVGAnimatedString]"` — which this check then reported as two missing
 * classes. The attribute is the same string on every element type.
 */
function emittedClasses(root: HTMLElement): string[] {
  const out = new Set<string>();
  for (const el of root.querySelectorAll("[class]")) {
    for (const c of (el.getAttribute("class") ?? "").split(/\s+/))
      if (c) out.add(c);
  }
  return [...out].sort();
}

describe("the hero scene's CSS is all present on the landing page", () => {
  it("🔒 every class it renders resolves in globals.css + marketing.css", () => {
    const { container } = render(<DemoScene step={LAST_STEP} />);
    const missing = emittedClasses(container).filter(
      (c) => !selectors.has(c) && !UNSTYLED(c)
    );
    // ⚠ NAMES THEM. A count tells you nothing about which recipe to port.
    expect(missing).toEqual([]);
  });

  it("🔒 …and the sheet really did compile, so an empty set cannot pass", () => {
    // A compile that produced nothing would make EVERY class "missing", not
    // zero — but a compile that produced a stub could pass the case above
    // vacuously if the scene rendered nothing. Both halves are asserted.
    expect(selectors.size).toBeGreaterThan(500);
    const { container } = render(<DemoScene step={LAST_STEP} />);
    expect(emittedClasses(container).length).toBeGreaterThan(80);
  });

  it("🔒 the recipes that live ONLY in a CSS module or kit.css are named", () => {
    // ⚠ THE SPECIFIC TRAP, PINNED BY NAME. These are the faces the scene wears
    // that the SPA gets from a file the landing page never loads — the rail's
    // tiles (`account-rail.module.css`) and the record pane's account palette
    // (`pages/home/home.module.css`). They are ported into `marketing.css` under
    // the demo's own prefix, so the check is that the PORT is there.
    for (const ported of [
      "lp-demo-rail",
      "lp-demo-rail-tile",
      "lp-demo-rail-mark",
      "lp-demo-record",
      "lp-demo-panel",
      "lp-demo-home",
    ]) {
      expect(`${ported}: ${selectors.has(ported)}`).toBe(`${ported}: true`);
    }
  });
});

