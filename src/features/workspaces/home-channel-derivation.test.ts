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
 * 🔒 **`OPEN_SITES` IS GONE, AND ITS DELETION IS THE SIGN-OFF** (2026-09-02,
 * batch-3 integration). The map's whole contract was *"when this set is EMPTY,
 * `20260920120000` may be applied"*, so an empty map is not a map — it is a
 * migration whose precondition is met. The record of what closed each site is
 * one commit away in `git log` and one paragraph away in F-564; leaving an
 * empty declaration here would be a gate that can only ever pass.
 *
 * ⚠ **THE SCAN AND THE "EQUALS" ASSERTION STAY**, and they are what still
 * earns this file: a NEW site added tomorrow fails `DECLARED`, because
 * `FENCE_SITES` is now the whole of it. That is the half that was always going
 * to matter after the precondition was met.
 *
 * How the eight closed, for the reader who lands here from the migration:
 *   • **B13** repointed `factory.ts`, `meta-tools.ts` and `server.ts` at
 *     `packages/mcp-server/src/workspace-directory.ts › containerKind`, a
 *     positive `switch` on `kind` whose `default` arm answers "workspace", so an
 *     unknown kind is never advertised as somebody's room. Its home-scopes
 *     module was DELETED with `dopl_home`, its lock narrowing moving into
 *     `workspace-directory.ts` and deriving the same label.
 *   • **B15** deleted its copy-target module with the copy ops, and fixed a
 *     NINTH site this scan could never see: `agent-templates/server/
 *     service-resolve-ref.ts › tenancyLabel` read the `home_scoped` BOOLEAN
 *     first and fell through to `!== "standard"`, so the boolean HID the shape.
 *   • **B14** repaired the one FENCE below, where the negation is right.
 *   • **the integration** closed `packages/mcp-server/src/tools/confirm-token.ts`,
 *     which was in no slice's `Owns` column: `resolveConfirmTarget` asked
 *     `!isStandardWorkspace(…)` and was saved only by its member-count term,
 *     which a one-member personal container happens to fail. Correct by
 *     accident is not correct.
 */

/**
 * 🔒 **SITES WHERE THE NEGATION IS CORRECT AND STAYS — ADDED 2026-09-02 (B14).**
 *
 * ⚠ **THIS SET EXISTS BECAUSE THE ORIGINAL GATE COULD NOT GO GREEN.** Its
 * contract was *"the migration may be applied when this set is EMPTY"*, and one
 * of the eight sites is a FENCE rather than a label: `assertMemberAddable`
 * refuses to add a member to a container of ANY kind, and it must go on reading
 * the negation so a fourth kind inherits the refusal instead of opting into it.
 * Repointing it to `kind === "link"` would have OPENED personal containers to
 * member-add — the gate would have gone green by introducing the bug F-295
 * exists to prevent.
 *
 * What was actually wrong at such a site is the SENTENCE, and that is what B14
 * fixed: the message branches on the kind, the predicate does not. Every entry
 * here therefore asserts a REPAIR, not a permission — the scan still finds the
 * shape, and the file states why the shape is right.
 */
const FENCE_SITES: Record<string, string> = {
  "src/features/workspaces/server/authz.ts":
    "B14 — CLOSED: the refusal is kind-agnostic by design, the message branches on `kind`",
};

/** ⚠ `FENCE_SITES` IS THE WHOLE DECLARATION SINCE `OPEN_SITES` EMPTIED. */
const DECLARED = FENCE_SITES;

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

  it("🔒 EVERY site is declared, every declared site is still there — and that IS `20260920120000`'s precondition", () => {
    // ⚠ EQUALS, NOT INCLUDES, in both directions. A new site is a regression; a
    // disappeared one is a fix whose record has to leave with it.
    //
    // ⚠ **AND IT IS ONE ASSERTION, NOT TWO** (de-duplicated 2026-09-02 in
    // review). A second case below restated this line verbatim under the name
    // "the precondition IS MET": `DECLARED` IS `FENCE_SITES` since `OPEN_SITES`
    // emptied at the batch-3 integration, so "every site is declared" and "no
    // site is still open" became the same sentence — and two copies of one
    // assertion is two places for it to be weakened, with a reviewer counting
    // two gates. The migration's header points at this file; this case is what
    // it points at.
    //
    // 🔒 A site is either a LABEL, which must ask `kind === "link"`, or a FENCE,
    // which must keep the negation AND branch its message on the kind. There is
    // no third disposition, which is why an empty third map would be a gate that
    // can only pass.
    expect([...FOUND.keys()].sort()).toEqual(Object.keys(DECLARED).sort());
  });

  it("a FENCE site is declared as repaired, never as merely permitted", () => {
    // ⚠ The two maps are not interchangeable. Moving a mislabel into
    // `FENCE_SITES` would silence this gate, so each entry there has to be a
    // site whose refusal is kind-agnostic AND whose message is not — which the
    // file itself must show.
    for (const file of Object.keys(FENCE_SITES)) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text, `${file} must branch its MESSAGE on the kind`).toMatch(
        /kind === "link"/
      );
    }
  });

  // ⚠ **A CASE MEASURING THE SHAPE MIX OVER `FOUND` LIVED HERE UNTIL
  // 2026-09-02**, asserting that a `!isStandardWorkspace` grep undercounts
  // because half the sites were ternaries or early returns. **It measured the
  // OPEN set, and the open set is empty** — one fence site remains and it is an
  // early return, so the case could only be made green by asserting whatever
  // that one site happens to be. The claim it protected has not gone anywhere:
  // the red-proof case above drives all three shapes through the real regexes
  // over lines taken from real files, which is the half that was ever evidence.
});
