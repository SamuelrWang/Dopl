import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

/**
 * 🔒 ANYTHING CLICKABLE SHOWS THE HAND — ONE RULE, PINNED IN BOTH STYLESHEETS
 * (Samuel, 2026-09-18: *"for a lot of buttons across the desktop app, when I hover over them,
 * the cursor does not change into the clickable cursor. … Is there one way you can set one
 * piece of code that will make it so that, anytime there's a button or something that can be
 * clicked, the cursor should change into the hand cursor? That's super important."*).
 *
 * ⚠ **THIS TEST EXISTS BECAUSE `check-css-token-drift.ts` CANNOT SEE THE RULE.** That gate
 * compares `--*` declarations and `@layer components` selector NAMES; a `cursor` declaration in
 * `@layer base` is neither. `src/app/globals.css` and `apps/desktop-ui/src/styles/tokens.css`
 * are hand-copies of one another (F-074), and a rule Samuel called global that holds on one
 * surface only is the exact defect the drift ledger was bought for — the same argument
 * `menu-item-hover.test.tsx` makes for `.menu-row`, which is why this file copies its shape.
 *
 * ⚠ **THE LAYER AND THE `:where()` ARE THE CONTRACT, NOT DECORATION.** `@layer base` is ordered
 * below `components` and `utilities`, and every compound is `:where()`, so the rule has zero
 * specificity in the weakest layer. That is what lets `cursor-text`, `cursor-col-resize`,
 * `cursor-grabbing`, `cursor-ns-resize` and every `disabled:cursor-*` keep winning. A future
 * edit that moves the rule out of the layer, or drops a `:where()` to "make it stick", silently
 * takes those decisions away — so both facts are asserted, not assumed.
 *
 * ⚠ **AND THE SECOND HALF IS THE SOURCE SCAN.** The rule can only reach an element that says
 * what it is. An `onClick` on a bare `<div>` is invisible to CSS, so those are enumerated here
 * with a reason apiece: a real clickable takes `data-clickable`, and everything that is NOT a
 * clickable (a dismiss backdrop, a `stopPropagation` wrapper, a click-to-focus editor) is named
 * in the allowlist instead. The list may only ever SHRINK.
 */

/** ⚠ Off `process.cwd()` (the vitest root), not `import.meta.url` — `menu-item-hover.test.tsx`
 *  documents the same trap. */
const ROOT = process.cwd();

/** The two hand-copied stylesheets. `globals.css` is the source of truth. */
const CSS = {
  web: "src/app/globals.css",
  spa: "apps/desktop-ui/src/styles/tokens.css",
} as const;

const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * Every selector the one rule must list. ⚠ ADDITIVE ONLY — a name removed from here is a
 * control class that quietly went back to the arrow cursor.
 */
const REQUIRED_SELECTORS = [
  "button",
  "a[href]",
  "summary",
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="treeitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="reset"]',
  "[data-clickable]",
] as const;

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The `@layer base { … }` body, brace-matched (the layer holds nested rules). */
function baseLayer(css: string): string {
  const clean = stripComments(css);
  const open = clean.indexOf("@layer base {");
  if (open === -1) throw new Error("no `@layer base` block");
  let depth = 0;
  for (let i = clean.indexOf("{", open); i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}" && --depth === 0) {
      return clean.slice(clean.indexOf("{", open) + 1, i);
    }
  }
  throw new Error("unterminated `@layer base` block");
}

/** The selector list inside the one `:where(…) { cursor: pointer }` rule. */
function pointerSelectors(layer: string): string[] {
  const m = layer.match(/:where\(([^)]*)\)\s*\{\s*cursor:\s*pointer;\s*\}/);
  if (!m) throw new Error("no zero-specificity `cursor: pointer` rule in `@layer base`");
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("🔒 the clickable-cursor rule — one rule, both stylesheets", () => {
  it.each(Object.entries(CSS))("%s: lists every control class, inside `@layer base`", (_s, rel) => {
    const selectors = pointerSelectors(baseLayer(read(rel)));
    for (const wanted of REQUIRED_SELECTORS) expect(selectors).toContain(wanted);
  });

  it.each(Object.entries(CSS))("%s: the file input's button gets it too", (_s, rel) => {
    expect(baseLayer(read(rel))).toMatch(
      /input\[type="file"\]::file-selector-button\s*\{\s*cursor:\s*pointer;\s*\}/
    );
  });

  it.each(Object.entries(CSS))("%s: disabled reads `not-allowed`, at zero specificity", (_s, rel) => {
    const layer = baseLayer(read(rel));
    const m = layer.match(/:where\(([^)]*)\)\s*\{\s*cursor:\s*not-allowed;\s*\}/);
    expect(m, "no zero-specificity `cursor: not-allowed` rule").toBeTruthy();
    const states = m![1].split(",").map((s) => s.trim());
    expect(states).toEqual([":disabled", '[aria-disabled="true"]', "[data-disabled]"]);
    // ⚠ ORDER IS THE TIE-BREAK. Both rules are specificity 0 in the same layer, so the
    // disabled one only wins by being stated second.
    expect(layer.indexOf("cursor: not-allowed")).toBeGreaterThan(layer.indexOf("cursor: pointer"));
  });

  /**
   * ⚠ THE WHOLE POINT OF `:where()`: an explicit cursor anywhere in the app must still win.
   * A compound that escapes the `:where()` raises the weight and starts overruling components.
   */
  it.each(Object.entries(CSS))("%s: nothing sits outside the `:where()`", (_s, rel) => {
    const layer = baseLayer(read(rel));
    const rule = layer.match(/:where\([^)]*\)\s*\{\s*cursor:\s*pointer;\s*\}/)![0];
    expect(rule.startsWith(":where(")).toBe(true);
    // `:where(…)` then whitespace then `{` — no trailing compound, no `:not()` bolted on.
    expect(rule).toMatch(/^:where\([^)]*\)\s*\{/);
  });

  /**
   * ⚠ MEASURED EXCLUSION, NOT AN OVERSIGHT. Every `htmlFor` in this tree points at a TEXT
   * field (`grep -rn htmlFor src apps --include='*.tsx'`), so `label[for]` in the list would
   * only ever put a hand over a text-field label, where a click is a focus and not a press.
   * A label tied to a checkbox or a radio takes `data-clickable` the day one exists.
   */
  it.each(Object.entries(CSS))("%s: `label[for]` stays out", (_s, rel) => {
    expect(pointerSelectors(baseLayer(read(rel)))).not.toContain("label[for]");
  });

  it("both copies list the SAME selectors, in the same order", () => {
    const web = pointerSelectors(baseLayer(read(CSS.web)));
    const spa = pointerSelectors(baseLayer(read(CSS.spa)));
    expect(spa).toEqual(web);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   The source half: an `onClick` CSS cannot see.
   ──────────────────────────────────────────────────────────────────────────── */

/** Host tags the rule already reaches, or that are never the click target themselves. */
const INTERACTIVE_TAGS = new Set([
  "button",
  "a",
  "summary",
  "select",
  "input",
  "textarea",
  "option",
  "label",
]);

/**
 * 🔒 THE DOCUMENTED NON-CLICKABLES — an `onClick` that must NOT read as a hand.
 * ⚠ MAY ONLY EVER SHRINK, and each entry says why. A new `onClick` in one of these files
 * pushes its count over and fails here, which is the intent: the next one gets a decision,
 * not this file's blessing.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "src/shared/ui/popover-menu.tsx": {
    count: 2,
    why: "the invisible full-screen dismiss backdrops — a hand over the whole page is worse than no cursor at all",
  },
  "src/features/skills/components/skill-history-panel.tsx": {
    count: 1,
    why: "the modal's scrim, same reason as popover-menu's backdrops",
  },
  "src/shared/editor/doc-editor.tsx": {
    count: 2,
    why: "click-to-focus prose; the inner surface already declares `cursor-text`, which is what a click there starts",
  },
  "src/features/ontology/components/kanban-column-header.tsx": {
    count: 1,
    why: "a `stopPropagation` wrapper around the actions menu — it swallows a click, it does not act on one",
  },
  "src/features/members/components/member-bits.tsx": {
    count: 1,
    why: "a `stopPropagation` wrapper around the role menu, same as kanban-column-header's",
  },
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    // ⚠ Tests are excluded: a fixture's `<div onClick>` is a stand-in, not a surface.
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/**
 * Opening tags carrying an `onClick`, by tag name. Comments are blanked first — an apostrophe
 * in prose otherwise opens a "string" the attribute scanner never closes.
 */
function clickTargets(source: string): { tag: string; attrs: string }[] {
  const src = source
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (s, p1: string) => p1 + " ".repeat(s.length - p1.length));
  const found: { tag: string; attrs: string }[] = [];
  const re = /<([a-z][a-zA-Z0-9-]*)(\s|>|\/)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const tag = m[1];
    if (INTERACTIVE_TAGS.has(tag)) continue;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let i = m.index + 1 + tag.length; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    const attrs = src.slice(m.index, end + 1);
    if (/\bonClick\s*=/.test(attrs)) found.push({ tag, attrs });
  }
  return found;
}

describe("🔒 an `onClick` CSS cannot see", () => {
  it("every non-semantic clickable is marked, or named in the allowlist", () => {
    const unmarked = new Map<string, number>();
    for (const dir of ["src", "apps"]) {
      for (const file of tsxFiles(resolve(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const bare = clickTargets(readFileSync(file, "utf8")).filter(
          ({ attrs }) => !/\brole\s*=/.test(attrs) && !/\bdata-clickable\b/.test(attrs)
        );
        if (bare.length) unmarked.set(rel, bare.length);
      }
    }
    const surprises: string[] = [];
    for (const [rel, count] of unmarked) {
      const allowed = ALLOWED[rel];
      if (!allowed) {
        surprises.push(
          `${rel}: ${count} clickable(s) with no role and no data-clickable — add \`data-clickable=""\`, or name the file in ALLOWED with the reason it is not a click target`
        );
      } else if (count > allowed.count) {
        surprises.push(
          `${rel}: ${count} bare onClick(s), allowlisted for ${allowed.count} (${allowed.why}) — the new one needs its own decision`
        );
      }
    }
    expect(surprises).toEqual([]);
  });

  it("the allowlist has no entry the tree has outgrown", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const bare = clickTargets(readFileSync(resolve(ROOT, rel), "utf8")).filter(
        ({ attrs }) => !/\brole\s*=/.test(attrs) && !/\bdata-clickable\b/.test(attrs)
      );
      return bare.length < ALLOWED[rel].count;
    });
    // ⚠ The list may only SHRINK, and it shrinks HERE — a stale count is how an allowlist
    // stops being a ledger and becomes a blanket.
    expect(stale).toEqual([]);
  });
});
