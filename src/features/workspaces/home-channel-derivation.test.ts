/**
 * 🔒 **THE `20260920120000` PRECONDITION, AS A GATE INSTEAD OF A PARAGRAPH**
 * (F-564; added 2026-09-02 in the batch-2 review).
 *
 * ⚠ **THE RULE.** `isStandardWorkspace` is the LISTING predicate — "does this
 * row belong in the rail". Its NEGATION is not "therefore a home channel", and
 * a growing number of sites read it that way. That is correct BY ACCIDENT while
 * `standard` and `link` are the only two kinds. **`20260920120000` adds a third
 * (`personal`) for every user at once**, and each of these sites then advertises
 * a person's own container as a home channel — a MISLABEL, not a leak, which is
 * why it does not block the code landing and does block the migration RUNNING.
 *
 * ⚠ **WHY A TEST AND NOT THE HEADER'S SENTENCE.** The migration said EIGHT
 * sites and told the reader to re-derive with `grep -rn '!isStandardWorkspace'`
 * — which answers FOUR, because half of them are the ELSE BRANCH of a ternary
 * (`isStandardWorkspace(w) ? "workspace" : "home channel"`) or an early return,
 * and a negation grep cannot see either. **So the count was wrong, the command
 * under it disagreed with the count, and the precondition on an unapplied
 * migration was prose.** The number is derived here now and never written down:
 * the gate answers "which files", the declaration says what happens to each,
 * and both directions fail.
 *
 * ⚠ IT IS A FILE-LEVEL SET, NOT A LINE-LEVEL ONE — line numbers rot within a
 * day (CLAUDE.md doc rule 2), and the disposition is per FILE anyway: a slice
 * either repoints that file at `kind === "link"` or deletes it.
 *
 * **WHEN THIS SET IS EMPTY, `20260920120000` MAY BE APPLIED.** That is the whole
 * contract of this file, and it is the only place the two facts are joined.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The three trees that can hold one. `dopl-desktop-app` has no copy. */
const TREES = ["src", "packages/mcp-server/src", "apps/desktop-ui/src"];

/**
 * A site that derives "home channel" from "not standard", in the three shapes
 * that occur. ⚠ THE TERNARY AND THE EARLY RETURN ARE THE HALF A NEGATION GREP
 * MISSES, which is the whole reason this file exists.
 */
const SHAPES: ReadonlyArray<[string, RegExp]> = [
  ["negation", /!\s*isStandardWorkspace\s*\(/],
  ["ternary else-branch", /isStandardWorkspace\s*\([^;]*?\)\s*\?/],
  ["early return", /if\s*\(\s*isStandardWorkspace\s*\([^;]*?\)\s*\)\s*return\s*;/],
];

/**
 * EVERY FILE that still derives it, and what closes each one.
 *
 * ⚠ **A DECLARATION, NOT AN ALLOWLIST.** The set below must EQUAL what the scan
 * finds. A NEW site fails this gate (nobody may add a ninth quietly); a site
 * that is FIXED or DELETED also fails it, so the entry leaves in the same change
 * as the code — which is how the migration's precondition stays true rather than
 * becoming another paragraph nobody re-derived.
 */
const OPEN_SITES: Record<string, string> = {
  // ⚠ Not in ANY slice's `Owns` column, and the migration header says so. It
  // needs assigning before either half of F-564 can be called finished.
  "packages/mcp-server/src/tools/confirm-token.ts":
    "UNASSIGNED — needs an owner before B13/B15 can close F-564",
  "packages/mcp-server/src/factory.ts": "B13 — the `workspace=` retirement repoints it",
  "packages/mcp-server/src/meta-tools.ts": "B13 — same",
  "packages/mcp-server/src/server.ts": "B13 — same",
  "packages/mcp-server/src/tools/home-scopes.ts": "B13 DELETES the file with `dopl_home`",
  "packages/mcp-server/src/tools/copy-target.ts": "B15 DELETES the file with the copy ops",
  // ⚠ The refusal is RIGHT for a personal container (nobody may be added to
  // one); the SENTENCE is what mislabels it. A fix here is a copy change, not a
  // fence change.
  "src/features/workspaces/server/authz.ts":
    "B13/B15 — the refusal holds, the sentence names the wrong kind",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Comments are stripped line-wise: a comment may DISCUSS the pattern. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      const at = line.search(/(^|\s)(\/\/|\*)/);
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const tree of TREES) {
    for (const file of walk(join(ROOT, tree))) {
      const text = code(file);
      const shapes = SHAPES.filter(([, re]) => re.test(text)).map(([label]) => label);
      if (shapes.length > 0) {
        found.set(relative(ROOT, file).split("\\").join("/"), shapes);
      }
    }
  }
  return found;
}

const FOUND = scan();

describe("🔒 F-564 — `!isStandardWorkspace` is not `kind === 'link'`", () => {
  it("the scan can SEE all three shapes (a scan that finds nothing is not a gate)", () => {
    // Red proof, over lines from the real files rather than invented ones.
    const samples = [
      'active && !isStandardWorkspace(active) && (active.memberCount ?? 0) !== 1',
      'kind: isStandardWorkspace(w) ? "workspace" : "home channel",',
      "if (isStandardWorkspace(workspace)) return;",
    ];
    for (const [i, sample] of samples.entries()) {
      expect(SHAPES[i][1].test(sample), SHAPES[i][0]).toBe(true);
    }
    // …and that a POSITIVE filter is not one of them: `.filter(isStandardWorkspace)`
    // is the predicate used for what it means, and there are many.
    for (const [, re] of SHAPES) {
      expect(re.test("(body.workspaces ?? []).filter(isStandardWorkspace);")).toBe(false);
    }
  });

  it("EVERY site is declared, and every declared site is still there", () => {
    // ⚠ EQUALS, NOT INCLUDES, in both directions. A new site is a regression; a
    // disappeared one is a fix whose record has to leave with it.
    expect([...FOUND.keys()].sort()).toEqual(Object.keys(OPEN_SITES).sort());
  });

  it("🔒 the migration may be applied only when this set is EMPTY", () => {
    // ⚠ THE PRECONDITION ITSELF, and the ONE place the code and the migration
    // are joined. `20260920120000` adds `personal` for every user at once; while
    // any site above stands, applying it makes each of them advertise a person's
    // own container as a home channel.
    //
    // ⚠ **THIS ASSERTION IS EXPECTED TO BE RED-ON-INVERSION, NOT RED NOW.** It
    // records the count rather than demanding zero, because F-564 is batch 3's
    // and this branch does not fix it — what the gate buys today is that the
    // number cannot drift and cannot be quoted wrong again. **When the sites are
    // gone, delete this case and the map with them; that deletion IS the
    // sign-off for applying the migration.**
    expect(FOUND.size).toBeGreaterThan(0);
    expect(FOUND.size).toBe(Object.keys(OPEN_SITES).length);
  });

  it("the ternary and the early-return shapes are why a negation grep undercounts", () => {
    // The header told readers to `grep -rn '!isStandardWorkspace'`, which sees
    // only the first shape. Measured here rather than asserted in prose.
    const byShape = [...FOUND.values()].flat();
    expect(byShape.filter((s) => s === "negation").length).toBeLessThan(FOUND.size);
    expect(byShape).toContain("ternary else-branch");
    expect(byShape).toContain("early return");
  });
});
