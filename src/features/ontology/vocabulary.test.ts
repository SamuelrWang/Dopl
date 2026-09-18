/**
 * The vocabulary gate (Samuel, 2026-09-11): a cluster is an "ontology" and a column
 * an "object"; a card is an item of that object.
 *
 * The ruling is about what a person reads, not what the code is called. Identifiers,
 * op names, routes and DB columns stay — renaming them is a migration. This gate
 * reads only string literals and JSX text.
 *
 * The allow-list is exact text, not a pattern: a loose rule would wave through the
 * next `"column"` fallback label, while an exact set makes each new entry a
 * decision. Module specifiers and `/api/` paths are carved out by rule.
 *
 * Comments are stripped before the scan — they carry the history of the rename.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The two surfaces the ruling covers: the feature, and the page that mounts it. */
const ROOTS = ["src/features/ontology", "apps/desktop-ui/src/pages/ontology"];

/** Test files, fixtures and harnesses are excluded: a fixture speaks the server's
 *  shape, ids and all, so a rename there proves nothing. */
const SKIP = /(\.test\.[tj]sx?$)|(^test-fixtures\.ts$)|(-harness\.ts$)/;

const BANNED = /\b(clusters?|columns?)\b/i;

/** Literals that are identifiers, one by one. Add only with a reason a reader can
 *  check — a new entry is the claim that nobody reads the string. */
const ALLOWED_LITERALS = new Set([
  "cluster", // `slugify(name, "cluster", …)` fallback — a URL slug, not a label.
  "cluster:", // reducer/debounce timer-key prefix (`use-ontology.ts`).
  "cluster:${clusterId}", // …and its two interpolated forms.
  "cluster:${action.id}",
  "column-details-${column.id}", // the lane header's `aria-controls` DOM id.
  "${column.template.length}", // pure interpolation: a COUNT, no word in it.
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || SKIP.test(entry)) continue;
    out.push(path);
  }
  return out;
}

/** Block comments first, then line comments — the other order leaves the
 *  inside of a `/* … // … *\/` block behind as loose text. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Never prose: an import specifier, or a route this repo does not rename. */
function isIdentifierByRule(text: string): boolean {
  return /^[.@]{1,2}\//.test(text) || text.startsWith("/api/");
}

function offendingStrings(src: string): string[] {
  const found: string[] = [];
  for (const match of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const text = match[2];
    if (!BANNED.test(text)) continue;
    if (isIdentifierByRule(text) || ALLOWED_LITERALS.has(text)) continue;
    found.push(text);
  }
  return found;
}

/** Text between tags — a label a component writes straight into the DOM. */
function offendingJsxText(src: string): string[] {
  const found: string[] = [];
  for (const match of src.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].trim();
    if (text && BANNED.test(text)) found.push(text);
  }
  return found;
}

describe("no user-facing 'cluster' or 'column' survives in the ontology", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("scans the ontology sources at all (a sweep over nothing is not a gate)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s says ontology/object, not cluster/column", (file) => {
    const src = stripComments(readFileSync(file, "utf8"));
    expect(
      [...offendingStrings(src), ...offendingJsxText(src)],
      `${file}: a string a person reads still says "cluster"/"column". Say "ontology"/"object" — or, if nobody reads it, add the exact text to ALLOWED_LITERALS with the reason.`
    ).toEqual([]);
  });
});
