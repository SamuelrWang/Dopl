/**
 * Catch drift between the two hand-copied DESIGN layers — the TOKENS, and since
 * 2026-09-17 (Samuel's ruling R-41) the `@layer components` CLASS SET.
 *
 *   tokens:  src/app/globals.css                    (source of truth)
 *        vs  apps/desktop-ui/src/styles/tokens.css  + apps/desktop-ui/src/styles/kit.css
 *            (the SPA's two copies — a `--*` declared inside a KIT RULE lives in
 *             the second one; see `main`)
 *   classes: src/app/globals.css `@layer components`   (source of truth)
 *        vs  apps/desktop-ui/src/styles/kit.css        (its verbatim hand copy)
 *
 * ⚠ THIS WAS A "LEAVE" UNTIL 2026-08-30 AND IT WAS RAISED TO A GATE BY TWO LIVE
 * BUGS. `tokens.css`'s own header carries the standing instruction — *"any edit
 * to globals.css's token layers MUST be mirrored here, same change"* — and
 * `docs/DESIGN-SYSTEM.md` repeats it as prose for the duplicated kit recipes.
 * The drift ledger then found `.menu-card`'s `pointer-events: none` present in
 * one copy and absent in the other (a landing nav that swallows the next click
 * for 140ms) and `.lightScope` silently reverting a secondary-ink darkening.
 * **A prose "edit both together" instruction demonstrably fails.** F-074.
 *
 * ⚠ WHAT IS COMPARED: `--*` CUSTOM PROPERTY DECLARATIONS ONLY — name and value,
 * including multiplicity (a token redeclared in a second block must be
 * redeclared in both). Not selectors, not rules, not `@media` structure. The
 * two files are NOT the same file: `tokens.css` deliberately omits the
 * landing/login-only rules (`.design-grid`, the login orbs, `logo-scroll`) and
 * has no reason to carry them, so a whole-file diff would be noise. The token
 * layer is the part both trees claim is one palette.
 *
 * ⚠ WHAT THE CLASS HALF COMPARES: **SELECTOR NAMES INSIDE `@layer components`,
 * AND NOTHING ELSE** — not declarations, not order, not `@media` structure. A
 * recipe present in one kit and absent from the other is the failure it was
 * bought for: `.glass-panel` was declared in `globals.css` and missing from
 * `kit.css` for weeks, so the SPA could not render `/link/{token}`'s card, and
 * the token gate could not see it because a class name is not a `--*`
 * declaration (parity audit 03 §B22/§D12; P24).
 *
 * ⚠ **THE LAYER IS THE BOUNDARY AND THAT IS A REAL BOUND ON THIS GATE.** Rules
 * OUTSIDE `@layer components` are not compared in either file: `globals.css`
 * carries a landing/login set the SPA has no reason to own, and both files keep
 * keyframes and a few auth-adjacent rules outside the layer on purpose. So this
 * finds a missing KIT RECIPE and says nothing about anything else.
 * (`.hairline` / `.hairline-strong` were the other two names the audit listed;
 * both sat outside the layer, both had ZERO users in either tree, and they were
 * DELETED from `globals.css` on 2026-09-17 under the dead-code rule rather than
 * copied into a second file.)
 *
 * ⚠ BOTH ALLOWLISTS MAY ONLY EVER SHRINK, and every entry names the file that
 * documents it. An intentional deviation belongs in BOTH the CSS comment and
 * the list; a deviation that appears in only one of them is the thing this
 * script exists to find.
 *
 * Exits non-zero with a diff summary. Run via:
 *   npx tsx scripts/check-css-token-drift.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const WEB = "src/app/globals.css";
const SPA = "apps/desktop-ui/src/styles/tokens.css";
/** The SPA's copy of `globals.css`'s `@layer components` kit. */
const KIT = "apps/desktop-ui/src/styles/kit.css";

/**
 * 🔒 THE THREE DOCUMENTED DEVIATIONS (measured 2026-08-30: 220 shared
 * declarations, 220 identical once these are set aside).
 */
const ALLOWED_DRIFT: Record<string, string> = {
  // `tokens.css` states it: a Vite SPA has no `next/font`, and the SPA is
  // system-fonts-only on purpose (CSP `font-src 'self'`, offline-safe).
  // globals.css: `var(--font-geist-mono), …`.
  "--font-mono": "SPA is system-fonts-only (tokens.css names it; do not 'fix')",
  // Declared ONLY in tokens.css. On the web the same variable is minted by
  // `next/font` in `src/app/layout.tsx` (`Newsreader`, whose `variable:` is
  // `--font-playfair` — the name predates the switch), so there is nothing for
  // globals.css to declare.
  "--font-playfair": "minted by next/font in src/app/layout.tsx on the web",
  // Real geometry difference: the web chrome has no account rail (0px), the SPA
  // has one (54px, 2026-08-21). Both files say so in place.
  "--shell-rail-w": "the account rail exists in the SPA and not on the web",
};

/**
 * 🔒 THE DOCUMENTED CLASS DEVIATIONS — EMPTY, measured 2026-09-17 (33 recipes in
 * each kit, 33 shared once `.glass-panel` was mirrored down).
 *
 * ⚠ **AN EMPTY LIST IS THE HONEST STARTING STATE AND IT IS NOT DECORATION.**
 * The kit's whole contract is that `kit.css` IS `globals.css`'s `@layer
 * components` — "verbatim hand-copy", in that file's own header — so a recipe
 * in one and not the other has no legitimate form yet. An entry here needs a
 * reason in the CSS as well, exactly like `ALLOWED_DRIFT`.
 */
const ALLOWED_CLASS_DRIFT: Record<string, string> = {};

/** Every `--name: value;` declaration, in order, comments removed. */
function declarations(source: string): Map<string, string[]> {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, string[]>();
  for (const m of clean.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+);/g)) {
    const value = m[2].replace(/\s+/g, " ").trim();
    const list = out.get(m[1]);
    if (list) list.push(value);
    else out.set(m[1], [value]);
  }
  return out;
}

/**
 * The body of the file's `@layer components { … }` block, brace-matched.
 * ⚠ BRACE-MATCHED, NOT REGEXED TO THE FIRST `}` — the layer contains nested
 * rules and `@media` blocks, and a lazy match would compare its first recipe
 * against the other file's whole kit.
 */
function componentLayer(source: string, rel: string): string {
  const open = source.indexOf("@layer components {");
  if (open < 0) throw new Error(`${rel}: no \`@layer components\` block`);
  let depth = 0;
  for (let i = open + "@layer components".length; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + "@layer components {".length, i);
    }
  }
  throw new Error(`${rel}: \`@layer components\` is never closed`);
}

/**
 * Every class NAME used in a selector inside the component layer.
 *
 * ⚠ SELECTOR POSITION ONLY. The scanner accumulates a prelude and flushes it at
 * the `{` that opens a block, so `.foo` inside a declaration VALUE (a
 * `content:` string, a `url()`) is never mistaken for a recipe, and an at-rule
 * prelude (`@media …`) contributes nothing while the rules nested inside it
 * still do.
 */
function componentClasses(source: string, rel: string): Set<string> {
  const body = componentLayer(source, rel).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Set<string>();
  let prelude = "";
  for (const ch of body) {
    if (ch === "{") {
      if (!prelude.trim().startsWith("@")) {
        for (const m of prelude.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(m[1]);
      }
      prelude = "";
    } else if (ch === "}") prelude = "";
    else prelude += ch;
  }
  return out;
}

function main(): void {
  const root = resolve(__dirname, "..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
  const web = declarations(read(WEB));
  // ⚠ THE SPA's TOKEN SIDE IS TWO FILES SINCE 2026-09-17 (R-38), AND THAT IS
  // COVERAGE, NOT A LOOSENING. `globals.css` holds the tokens AND the kit, so a
  // `--*` declared inside a KIT RULE (the account palette skin's
  // `--channel-divider-w`) has its SPA copy in `kit.css`, not `tokens.css` —
  // and comparing against `tokens.css` alone reported a real, mirrored
  // declaration as missing. Concatenating is safe because the two SPA files
  // partition the layers: `kit.css` carried exactly ONE `--*` when this landed
  // (`grep -c -- '--[a-z-]*:' apps/desktop-ui/src/styles/kit.css` is the
  // re-derive) and `globals.css`'s `@layer components` carried none, so nothing
  // can be double-counted into a false multiplicity mismatch.
  const spa = declarations(`${read(SPA)}\n${read(KIT)}`);

  const names = new Set([...web.keys(), ...spa.keys()]);
  const problems: string[] = [];
  let allowedSeen = 0;

  for (const name of [...names].sort()) {
    if (name in ALLOWED_DRIFT) {
      allowedSeen += 1;
      continue;
    }
    const a = web.get(name);
    const b = spa.get(name);
    if (!a) problems.push(`${name}: declared in ${SPA}/${KIT} only`);
    else if (!b) problems.push(`${name}: declared in ${WEB} only`);
    else if (a.join(" | ") !== b.join(" | ")) {
      problems.push(`${name}:\n    ${WEB}: ${a.join(" | ")}\n    ${SPA}: ${b.join(" | ")}`);
    }
  }

  // ⚠ The allowlist may not outlive its entries. A name that no longer appears
  // in either file is a comment claiming a fact, which is the failure mode this
  // whole script is about.
  for (const name of Object.keys(ALLOWED_DRIFT)) {
    if (!names.has(name)) {
      problems.push(`${name}: allowlisted as a deviation but declared in NEITHER file`);
    }
  }

  if (problems.length) {
    console.error("[drift] design tokens disagree across the two copies:");
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      `\n❌ CSS token drift detected. \`${WEB}\` is the source of truth; the SPA's copy is \`${SPA}\` plus the kit rules in \`${KIT}\` (F-074): change both in ONE edit. If a difference is DELIBERATE, say so in BOTH the CSS comment and \`ALLOWED_DRIFT\` in this file — an undocumented one is indistinguishable from the bug.`
    );
    process.exit(1);
  }

  const shared = [...names].filter((n) => !(n in ALLOWED_DRIFT)).length;
  console.log(
    `✅ ${shared} design tokens identical across ${WEB} and ${SPA}+${KIT}; ${allowedSeen} documented deviation(s): ${Object.keys(ALLOWED_DRIFT).join(", ")}.`
  );

  checkClassSet(read(WEB), read(KIT));
}

/** R-41: the `@layer components` recipe NAMES, in both directions. */
function checkClassSet(webSource: string, kitSource: string): void {
  const web = componentClasses(webSource, WEB);
  const kit = componentClasses(kitSource, KIT);
  const all = new Set([...web, ...kit]);
  const problems: string[] = [];

  for (const name of [...all].sort()) {
    if (name in ALLOWED_CLASS_DRIFT) continue;
    if (!web.has(name)) problems.push(`.${name}: in ${KIT} only`);
    else if (!kit.has(name)) problems.push(`.${name}: in ${WEB} only`);
  }

  // ⚠ Same rule as the token allowlist: an entry naming a class that is in
  // NEITHER kit is a comment claiming a fact.
  for (const name of Object.keys(ALLOWED_CLASS_DRIFT)) {
    if (!all.has(name)) {
      problems.push(`.${name}: allowlisted as a deviation but in NEITHER kit`);
    }
  }

  // ⚠ A scan that found nothing is not a gate. Both kits are ~30 recipes; a
  // parse that quietly returned an empty set would report perfect parity.
  if (web.size < 10 || kit.size < 10) {
    problems.push(
      `the component-layer scan found ${web.size} / ${kit.size} recipes — too few to be a real kit; the parse is broken, not the CSS`
    );
  }

  if (problems.length) {
    console.error("[drift] the @layer components KIT disagrees across the two copies:");
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      `\n❌ Kit class drift detected. \`${KIT}\`'s own header says it is a VERBATIM hand-copy of \`${WEB}\`'s \`@layer components\` kit: add the recipe to the other file in the SAME change, or — if it is dead in both trees — delete it. A deliberate one-sided recipe belongs in BOTH the CSS comment and \`ALLOWED_CLASS_DRIFT\` in this file.`
    );
    process.exit(1);
  }

  const deviations = Object.keys(ALLOWED_CLASS_DRIFT);
  console.log(
    `✅ ${web.size} @layer components recipes identical across ${WEB} and ${KIT}; ${deviations.length} documented deviation(s)${deviations.length ? `: ${deviations.join(", ")}` : ""}.`
  );
}

main();
