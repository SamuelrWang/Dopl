// @vitest-environment jsdom
/**
 * (2026-09-17) Every class the hero scene emits must resolve in the CSS the
 * landing page actually loads.
 *
 * The two trees load different stylesheets, which is the whole risk. The SPA
 * loads Tailwind + `tokens.css` + `kit.css` plus every CSS module its pages
 * import; the landing page loads only `src/app/globals.css` and
 * `src/features/marketing/marketing.css`. A recipe that lives only in a module or
 * in `kit.css` renders as NOTHING here, silently.
 *
 * The CSS is COMPILED, not grepped: Tailwind v4 generates utilities from a source
 * scan, so "does `bg-[var(--seg-fill)]` exist" is answered by running the same
 * PostCSS plugin the Next build runs over the same two files (~350ms, ~220KB).
 *
 * It asserts per class, not per file, so a failure names the recipe to port into
 * `marketing.css` rather than saying "something is off".
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

/** The two stylesheets the landing page loads, in load order: `src/app/layout.tsx`
 *  imports the first, `src/app/page.tsx` the second. */
const SHEETS = [
  "src/app/globals.css",
  "src/features/marketing/marketing.css",
] as const;

/** Repo root — this file is five levels under it. The specifier is a VARIABLE on
 *  purpose: Vite rewrites `new URL("<literal>", import.meta.url)` into an asset
 *  url, which under vitest comes back on a non-`file:` scheme. */
const UP = "../../../../../";
const ROOT = fileURLToPath(new URL(UP, import.meta.url));

/** The beat where every control the scene can draw is on stage. */
const LAST_STEP = stepIndex("hold");

/**
 * The one exemption, narrow on purpose. `lucide-react` stamps every icon with
 * `lucide` plus a `lucide-<name>` hook, and neither carries any style in this
 * product (`grep -c lucide` is 0 in all three stylesheets), so an icon renders
 * identically with them unresolved.
 *
 * A prefix, not a list, and nothing else may join it: every other unresolved class
 * is a real hole. Adding a second entry is how this gate stops working — port the
 * missing rule into `marketing.css` instead.
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
 * `getAttribute("class")`, never `el.className`: on an SVG element that property
 * is an `SVGAnimatedString`, so `String(el.className)` yields
 * `"[object SVGAnimatedString]"`. The attribute is the same string everywhere.
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
    // Names them: a count says nothing about which recipe to port.
    expect(missing).toEqual([]);
  });

  it("🔒 …and the sheet really did compile, so an empty set cannot pass", () => {
    // A compile that produced a stub could pass the case above vacuously if the
    // scene rendered nothing, so both halves are asserted.
    expect(selectors.size).toBeGreaterThan(500);
    const { container } = render(<DemoScene step={LAST_STEP} />);
    expect(emittedClasses(container).length).toBeGreaterThan(80);
  });

  it("🔒 the recipes that live ONLY in a CSS module or kit.css are named", () => {
    // The specific trap, pinned by name: faces the SPA gets from a file the
    // landing page never loads (`account-rail.module.css`,
    // `pages/home/home.module.css`), ported into `marketing.css` under the demo's
    // own prefix. The check is that the port is there.
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

