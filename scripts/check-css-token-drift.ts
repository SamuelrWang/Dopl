/**
 * Catch drift between the two hand-copied DESIGN-TOKEN layers.
 *
 *   - src/app/globals.css                    (source of truth)
 *   - apps/desktop-ui/src/styles/tokens.css  (the SPA's only other copy)
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
 * ⚠ THE ALLOWLIST MAY ONLY EVER SHRINK, and every entry names the file that
 * documents it. An intentional deviation belongs in BOTH the CSS comment and
 * this list; a deviation that appears in only one of them is the thing this
 * script exists to find.
 *
 * Exits non-zero with a diff summary. Run via:
 *   npx tsx scripts/check-css-token-drift.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const WEB = "src/app/globals.css";
const SPA = "apps/desktop-ui/src/styles/tokens.css";

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

function main(): void {
  const root = resolve(__dirname, "..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
  const web = declarations(read(WEB));
  const spa = declarations(read(SPA));

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
    if (!a) problems.push(`${name}: declared in ${SPA} only`);
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
      `\n❌ CSS token drift detected. \`${WEB}\` is the source of truth and \`${SPA}\` is its only other copy (F-074): change both in ONE edit. If a difference is DELIBERATE, say so in BOTH the CSS comment and \`ALLOWED_DRIFT\` in this file — an undocumented one is indistinguishable from the bug.`
    );
    process.exit(1);
  }

  const shared = [...names].filter((n) => !(n in ALLOWED_DRIFT)).length;
  console.log(
    `✅ ${shared} design tokens identical across ${WEB} and ${SPA}; ${allowedSeen} documented deviation(s): ${Object.keys(ALLOWED_DRIFT).join(", ")}.`
  );
}

main();
