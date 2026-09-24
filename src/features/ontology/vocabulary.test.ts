/**
 * THE VOCABULARY GATE, IN TWO HALVES.
 *
 * 1. REPO-WIDE (Samuel, 2026-09-23): *"The word "cluster" is obsolete, so it needs to be completely
 *    removed."* The graph's top level is an ONTOLOGY in the UI, the code, the API, the SDK, the MCP
 *    surface and the database. This half supersedes the 2026-09-11 ruling, which renamed only what a
 *    person reads and kept identifiers, routes and DB names on the old word. Every tracked (or
 *    untracked, not ignored) file is scanned — contents AND path — and the only files that may still
 *    carry the word are {@link EXEMPT}, each with the reason a reader can check. An exemption that no
 *    longer carries the word fails too, so the list can only shrink toward empty.
 *
 * 2. USER-FACING `column` (Samuel, 2026-09-11, still standing): a lane is an "object" to the reader.
 *    The code keeps its `column` identifiers (`create_column`, `columnIds`), so this half reads only
 *    string literals and JSX text in the ontology feature and its page, against an EXACT allow-list.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ─── Half 1: the retired word, repo-wide ────────────────────────────────────

const RETIRED = /clust/i;

/**
 * The files that may still spell the retired word. A trailing `/` exempts a directory. Add only
 * with a reason — a new entry is the claim that the word CANNOT leave that file.
 */
const EXEMPT: ReadonlyArray<readonly [path: string, reason: string]> = [
  // History is never rewritten.
  ["supabase/migrations/", "applied migrations are never edited (INVARIANTS §12); the 2026-09-23 rename migration must name what it renames"],
  ["packages/dopl-client/CHANGELOG.md", "release history — entries before 2026-09-23 describe what shipped under the old names"],
  ["packages/mcp-server/CHANGELOG.md", "release history — as above"],
  ["docs/ENGINEERING.md", "the archaeology doc (CLAUDE.md): dated strata, never rewritten"],
  ["docs/REFACTOR-FINDINGS.md", "append-only findings log; closed entries quote the code as it was"],
  ["docs/WORKFLOW-PIVOT-HANDOFF.md", "archival plan for the legacy graph + workflow feature, deleted 2026-08-11"],
  ["docs/WORKFLOW-BUILDER-PLAN.md", "archival plan, as above"],
  ["docs/RETIREMENT-UNWIRING-PLAN.md", "archival plan for the 2026-08 retirement"],
  ["docs/audit-2026-06-01/", "dated audit snapshot"],
  ["docs/migration-research/", "dated research snapshot"],
  ["docs/specs/ontology-research/", "dated research snapshot"],
  ["docs/specs/mcp-surface-v2.plan.md", "dated plan"],
  ["docs/specs/workspace-parity/06-rulings-archive.md", "rulings archive — quotes Samuel verbatim"],
  ["docs/MCP-AUDIT-FINDINGS.md", "dated audit"],
  ["docs/M5-M6-M10-AUDIT-FINDINGS.md", "dated audit"],
  ["docs/M7-M11-AUDIT-FINDINGS.md", "dated audit"],
  ["docs/AUDIT-FIX-VERIFICATION.md", "dated audit"],
  ["docs/CHANNELS-AUDIT-2026-08-07.md", "dated audit"],
  ["docs/CHANNELS-V2-WIRING-PLAN.md", "dated plan"],
  ["docs/DATA-LOADING-AUDIT.md", "dated audit"],
  ["docs/DRIFT-LEDGER-2026-08-30.md", "dated ledger"],
  ["docs/LAUNCH-READINESS-ROADMAP.md", "dated roadmap"],
  ["docs/MCP-MULTI-WORKSPACE.md", "dated design doc for the legacy graph feature's skills"],
  ["docs/CLEANUP.md", "dated, executed cleanup catalog (2026-06-12)"],
  ["docs/TRACKED-DEBT.md", "dated debt entries naming files deleted with the legacy graph feature"],
  ["RLS-MIGRATION-PLAN.md", "dated plan"],
  ["MCP-GAP-AUDIT.md", "dated audit"],
  ["KB-LOSS-TRACE.md", "dated incident trace"],
  ["scripts/doc-refs-plain-path-baseline.json", "the dangling-reference baseline OF the archival docs above"],
  // Retired tool names stay DENIED, and a deny list must spell what it denies.
  ["dopl-desktop-app/main/tool-profiles.js", "RETIRED_DOPL_TOOLS — deleted tools stay on the deny floor (INVARIANTS §11)"],
  ["dopl-desktop-app/test/session-tool-name-prefix.test.mjs", "asserts a retired admin name normalizes onto the deny floor"],
  ["dopl-desktop-app/test/session-permission-axes.test.mjs", "asserts a retired admin name resolves to deny"],
  ["dopl-desktop-app/test/session-channel-read.test.mjs", "asserts the retired names stay denied in a channel read session"],
  ["packages/mcp-server/src/retirement.test.ts", "asserts the retired tool names are never registered"],
  // One release of compatibility with desktops ≤ 1.36.0 — removal trigger in each file's header.
  ["src/features/ontology/legacy-aliases.ts", "old wire names for desktops ≤ 1.36.0 (removal trigger in its header)"],
  ["src/features/ontology/legacy-aliases.test.ts", "tests the module above"],
  ["src/app/api/ontology/clusters/", "the retired route paths, aliased onto `api/ontology/ontologies/**`"],
  ["packages/mcp-server/src/legacy-aliases.ts", "old MCP arg/op names, refused with their successor (removal trigger in its header)"],
  ["packages/mcp-server/src/legacy-aliases.test.ts", "tests the module above"],
  ["packages/mcp-server/dist/legacy-aliases.js", "the committed build of the module above"],
  ["packages/mcp-server/dist/legacy-aliases.d.ts", "the committed build of the module above"],
  // This gate names the word it bans.
  ["src/features/ontology/vocabulary.test.ts", "this file"],
];

function isExempt(path: string): boolean {
  return EXEMPT.some(([p]) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

/** Tracked files plus untracked-not-ignored ones — a new file is scanned before it is committed. */
function repoFiles(): string[] {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((f) => f.length > 0 && existsSync(f) && statSync(f).isFile());
}

/** Text only: a NUL byte in the first 8 KB is a binary asset, which carries no words. */
function textOf(path: string): string | null {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString("utf8");
}

describe("the retired word is gone from the repo (2026-09-23)", () => {
  const files = repoFiles();

  it("scans the repo at all (a sweep over nothing is not a gate)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("no path outside the exemption list names it", () => {
    expect(files.filter((f) => RETIRED.test(f) && !isExempt(f))).toEqual([]);
  });

  it("no file outside the exemption list contains it", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (isExempt(f)) continue;
      const text = textOf(f);
      if (text === null) continue;
      text.split("\n").forEach((line, i) => {
        if (RETIRED.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    expect(
      hits,
      `the retired word is back. Say "ontology" (or, for the legacy graph feature deleted 2026-08-11, "legacy graph"). Only a file that CANNOT drop it belongs in EXEMPT, with its reason.`
    ).toEqual([]);
  });

  it.each(EXEMPT.map(([p]) => p))("exemption %s still exists and still needs to be one", (p) => {
    if (p.endsWith("/")) {
      expect(files.some((f) => f.startsWith(p)), `${p} has no files left — drop the exemption`).toBe(true);
      return;
    }
    expect(files, `${p} is gone — drop the exemption`).toContain(p);
    expect(RETIRED.test(textOf(p) ?? ""), `${p} no longer carries the word — drop the exemption`).toBe(true);
  });
});

// ─── Half 2: user-facing "column" in the ontology feature ───────────────────

/** The two surfaces the 2026-09-11 ruling covers: the feature, and the page that mounts it. */
const ROOTS = ["src/features/ontology", "apps/desktop-ui/src/pages/ontology"];

/** Test files, fixtures and harnesses are excluded: a fixture speaks the server's
 *  shape, ids and all, so a rename there proves nothing. */
const SKIP = /(\.test\.[tj]sx?$)|(^test-fixtures\.ts$)|(-harness\.ts$)/;

const BANNED = /\bcolumns?\b/i;

/** Literals that are identifiers, one by one. Add only with a reason a reader can
 *  check — a new entry is the claim that nobody reads the string. */
const ALLOWED_LITERALS = new Set([
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

/** Never prose: an import specifier, or an API route. */
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

describe("no user-facing 'column' survives in the ontology", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("scans the ontology sources at all (a sweep over nothing is not a gate)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s says object, not column", (file) => {
    const src = stripComments(readFileSync(file, "utf8"));
    expect(
      [...offendingStrings(src), ...offendingJsxText(src)],
      `${file}: a string a person reads still says "column". Say "object" — or, if nobody reads it, add the exact text to ALLOWED_LITERALS with the reason.`
    ).toEqual([]);
  });
});
