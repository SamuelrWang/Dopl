/**
 * THE VOCABULARY GATE — **a cluster is an "ontology" and a column is an
 * "object"; a card is an ITEM of that object** (Samuel, 2026-09-11: *"any
 * wording that's called 'cluster' should not be there. It's like 'ontology',
 * right? … it's not a column, it's an object"*).
 *
 * ⚠ **THE RULING IS ABOUT WHAT A PERSON READS, NOT WHAT THE CODE IS CALLED.**
 * `clusterId`, `CLUSTER_ADD`, `ontology_clusters`, the `create_column` op name,
 * the `/api/ontology/clusters` routes and every DB column STAY — renaming them
 * is a migration, not a wording fix, and this file is deliberately blind to
 * them. What it reads is STRING LITERALS and JSX TEXT, which is the only place
 * the board's private word can leak into the operator's.
 *
 * ⚠ **THE ALLOW-LIST IS EXACT TEXT, NOT A PATTERN, AND THAT IS THE GATE.** A
 * rule like "single lowercase word is fine" would wave through the next
 * `"column"` fallback label; an exact set fails on any literal that is not
 * already known to be an identifier, which is what makes a NEW one a decision
 * rather than an accident. Module specifiers and `/api/` paths are the two
 * carve-outs taken by rule, because neither can ever be prose.
 *
 * ⚠ Comments are stripped before the scan. They carry the history of the
 * rename — "it was a column" is the sentence a future reader needs — and a gate
 * that banned the old word from comments would delete its own explanation.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The two surfaces the ruling covers: the feature, and the page that mounts it. */
const ROOTS = ["src/features/ontology", "apps/desktop-ui/src/pages/ontology"];

/** ⚠ Test files, fixtures and harnesses are EXCLUDED: a fixture's job is to
 *  speak the server's shape, ids and all, and a rename there proves nothing. */
const SKIP = /(\.test\.[tj]sx?$)|(^test-fixtures\.ts$)|(-harness\.ts$)/;

const BANNED = /\b(clusters?|columns?)\b/i;

/** Literals that are IDENTIFIERS, one by one. ⚠ Add to this only with a reason
 *  a reader can check — a new entry is the claim that nobody reads the string. */
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

/** ⚠ Block comments first, then line comments — the other order leaves the
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
