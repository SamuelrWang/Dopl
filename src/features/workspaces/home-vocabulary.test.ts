/**
 * THE RETIRED CONTAINER KIND STAYS RETIRED (Samuel, 2026-09-24): *"a personal workspace just means
 * the hjome space? … We should just cut that layer no?"* The Home space is `kind='home'` in the
 * column, `home` on the wire, and "Home space" in prose since `20261023120000_home_vocabulary_rename`.
 *
 * ⚠ IT GUARDS THE KIND, NOT THE ENGLISH WORD. "personal wallet", "Personal Pro", "personal access
 * token" and the wallet value `'personal'` are legitimate and untouched. So the rule is three shapes:
 *   1. the kind noun phrase — `personal` + container/shelf/reach/workspace/ontology, in any casing
 *      or joiner (`personalContainer`, `personal_container`, "personal shelf"). An applied migration's
 *      FILE NAME (`20261009120000_personal_container_permanent.sql`) is history and is skipped;
 *   2. a kind comparison or literal assignment — `kind === "personal"`, `kind='personal'`;
 *   3. the bare value `"personal"` on a line that is not about the wallet (counter, credits).
 * Code only (docs keep their dated prose); applied migrations are never edited (INVARIANTS §12).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CODE = /\.(ts|tsx|js|mjs|cjs|sql)$/;
const PHRASE = /(?<!\d{14}_)personal[ _-]?(container|shelf|reach|workspace|ontolog)/i;
const KIND = /\bkind\s*(=|:|===|!==)\s*['"`]?personal\b/i;
const BARE = /(["'`])personal\1/;
/** A line about the personal WALLET (its counter, its credits) may say the value. */
const WALLET = /wallet|counter|credit/i;

/** Files that must still spell it, each with the reason a reader can check. */
const EXEMPT: ReadonlyArray<readonly [path: string, reason: string]> = [
  ["supabase/migrations/", "applied history is never edited; the rename migration names what it renames"],
  ["src/features/workspaces/home-vocabulary.test.ts", "this gate"],
  ["packages/mcp-server/src/legacy-aliases.ts", "the one-release `container=personal` alias"],
  ["packages/mcp-server/dist/legacy-aliases.js", "the committed build of the alias"],
  ["packages/mcp-server/dist/legacy-aliases.d.ts", "the committed build of the alias"],
  ["scripts/check-role-drift.ts", "a dated note on how the gate once misread an applied rollback"],
  ["src/features/workspaces/b10-no-derived-default.test.ts", "pins 20260922120000's applied text"],
  ["src/shared/tenancy/home-space-schema.test.ts", "pins 20260920120000's applied CHECK"],
  ["src/features/billing/server/credits-audit.test.ts", "the wallet value, split across lines"],
  ["src/features/billing/server/workspace-billing-plan-pro-schema.test.ts", "an applied migration's comment text"],
  ["packages/mcp-server/src/tool-profile.test.ts", "the English word, as a substring test"],
];

const isExempt = (f: string) => EXEMPT.some(([p]) => (p.endsWith("/") ? f.startsWith(p) : f === p));

function hitsIn(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) =>
      PHRASE.test(line) || KIND.test(line) || (BARE.test(line) && !WALLET.test(line))
        ? [`${file}:${i + 1}: ${line.trim().slice(0, 140)}`]
        : []
    );
}

describe("the retired container kind (2026-09-24)", () => {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => CODE.test(f));

  it("scans the code at all (a sweep over nothing is not a gate)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("no code outside the exemption list names it", () => {
    expect(files.filter((f) => !isExempt(f)).flatMap(hitsIn)).toEqual([]);
  });

  it("every exemption is still necessary", () => {
    const stale = EXEMPT.filter(([p]) => !p.endsWith("/") && hitsIn(p).length === 0).map(([p]) => p);
    expect(stale).toEqual([]);
  });
});
