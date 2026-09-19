/**
 * 🔒 **KNOWLEDGE PINNING IS GONE — IN CODE, IN THE AGENT SURFACE AND IN SQL**
 * (Samuel's ruling, 2026-09-18: *"let's remove pinning for now, remove the code
 * for pinning stuff. lioke kbs. ill reimplement it down the line."*).
 *
 * ⚠ **WHY A GATE AND NOT A DIFF REVIEW** — the `b10-no-derived-default.test.ts`
 * argument, one feature over. The concept was not one function. It was two
 * columns, a repository, a service, a second service that assembled the payload,
 * three REST routes, a sibling key on the base list, two SDK write methods and a
 * read, three exported payload types, an MCP op PAIR with its own launch-cost
 * ceiling and two shared caps, and — the part with real blast radius — a fetch
 * on the desktop's spawn path that folded the answer into every agent's first
 * turn. Removing fourteen things is a diff; keeping them removed is a gate, and
 * the regression shape is a *reintroduction under the old name* in a file nobody
 * re-reads. Samuel intends to rebuild this, so the gate is what makes the
 * rebuild a DECISION rather than an accident.
 *
 * ⚠ **THE SCOPE IS DECLARED, NOT "the repo".** These are the six trees the
 * feature actually lived in. A `chats.pinned`, a "pinned channel" well and a
 * test that "pins" a value are all live, unrelated uses of the word elsewhere in
 * this codebase — which is exactly why the pattern below matches IDENTIFIERS and
 * the route path rather than the word `pin`.
 *
 * ⚠ **IT SCANS COMMENTS TOO, DELIBERATELY** — the same reason B10's does. Six
 * prose sites still pointed at `service-pins.ts` / `prompt-framing-startup.js`
 * after the code was deleted, and a comment naming a module that no longer
 * exists is the next agent's instruction to go and look for it. There is no
 * allowlist: a sentence describing the REMOVAL can be written without naming the
 * thing removed, and every one in this change is.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Every tree the feature had a limb in. */
const SCOPE = [
  "src/features/knowledge",
  "src/app/api/knowledge",
  "src/shared/knowledge",
  "packages/dopl-client/src",
  "packages/mcp-server/src/tools",
  "dopl-desktop-app/main",
];

/**
 * The feature's own spellings — identifiers, module basenames and the endpoint.
 *
 * ⚠ **THE BARE WORD `pin` IS DELIBERATELY ABSENT.** `chats.pinned` is a LIVE
 * column (`dopl_chats(op="update", pinned=…)`), `channel-wells.ts` returns the
 * string `"pinned"`, and a dozen suites say a property is "pinned here". A gate
 * that fired on those would be red on arrival and would get deleted, which is
 * the failure mode B10's header warns about. What is banned is every name that
 * could only ever have meant KNOWLEDGE pinning.
 *
 * ⚠ `startup[ _-]?context` IS THE LOAD-BEARING ONE — it catches the route path,
 * the desktop's context key, the payload type, the cap constant and the English
 * phrase in one, and a reintroduction that keeps none of the identifiers almost
 * certainly keeps the endpoint.
 */
const BANNED =
  /startup[ _-]?context|StartupContext|pinnedBaseIds|setKbBasePinned|setKbEntryPinned|getKbStartupContext|setBasePinned|setEntryPinned|listPinnedBaseIds|listPinnedEntriesForBases|pinBase|pinEntry|KB_PIN_(?:WARN|MAX)_CHARS|knowledge_pinned|repository-pins|service-pins|prompt-framing-startup/i;

function walk(path: string, out: string[] = []): string[] {
  if (statSync(path).isFile()) {
    if (/\.(ts|tsx|js|mjs)$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    walk(join(path, entry.name), out);
  }
  return out;
}

/**
 * ⚠ THE GATE EXCLUDES ITSELF, AND ONLY ITSELF — B10's rule verbatim. A scan has
 * to be able to name what it forbids (the red-proof case below quotes eight of
 * the deleted strings), and a self-match is the one failure this file could
 * never fix. An exclusion of ONE path, not a list that can grow.
 *
 * ⚠ **AND THE FILENAME CARRIES NONE OF THE BANNED WORDS, WHICH COST A RENAME** —
 * B10's own lesson, re-learned here rather than inherited. This file was
 * `no-pinned-startup-context.test.ts` for one commit, and the SDK suite that
 * CITES it thereby reintroduced `startup-context` into a scanned tree. A gate
 * whose own name is the regression is not a gate, and self-exclusion does not
 * save it — the offending string was in the OTHER file.
 */
const SELF = "src/features/knowledge/pinning-stays-removed.test.ts";

const FILES = SCOPE.flatMap((rel) => walk(join(ROOT, rel))).filter(
  (f) => relative(ROOT, f).split(sep).join("/") !== SELF
);

describe("🔒 knowledge pinning stays removed", () => {
  it("the scan reaches real files (a scan that reads nothing is not a gate)", () => {
    // ⚠ RED PROOF. A typo'd path in SCOPE makes every assertion below vacuous.
    // `readdirSync` on a missing directory THROWS rather than returning empty,
    // so what this covers is a scope that quietly shrank to a trivial file.
    expect(FILES.length).toBeGreaterThan(400);
    const posix = FILES.map((f) => relative(ROOT, f).split(sep).join("/"));
    // One landmark per tree, so a scope entry that stops resolving is named.
    for (const landmark of [
      "src/features/knowledge/server/service.ts",
      "src/app/api/knowledge/bases/route.ts",
      "src/shared/knowledge/caps.ts",
      "packages/dopl-client/src/knowledge.ts",
      "packages/mcp-server/src/tools/knowledge.ts",
      "dopl-desktop-app/main/prompt-framing.js",
    ]) {
      expect(posix, landmark).toContain(landmark);
    }
  });

  it("the pattern SEES every spelling it claims to", () => {
    // Over the real strings this change deleted, not invented ones.
    for (const sample of [
      "export const STARTUP_CONTEXT_CHAR_CAP = 8_000;",
      "  return t.request<StartupContext>(\"/api/knowledge/startup-context\", {",
      "      pinnedBaseIds,",
      "      await client.setKbBasePinned(base.id, pinned);",
      "    await client.setKbEntryPinned(read.entry.id, pinned);",
      "  const ctx = await client.getKbStartupContext();",
      "  await repo.setBasePinned(ctx.workspaceId, base.id, pinned);",
      "export async function pinEntry(",
      "const pinned = await repo.listPinnedBaseIds(ctx.workspaceId, [...visible]);",
      "export const KB_PIN_WARN_CHARS = 4_000;",
      "const { startupContextFraming } = require('./prompt-framing-startup');",
      "import type { KnowledgeFolderNode } from \"./repository-pins\";",
    ]) {
      expect(BANNED.test(sample), sample).toBe(true);
    }
    // …and stays off every LIVE use of the word elsewhere in the tree.
    for (const live of [
      'pinned: z.boolean().optional().describe("op=update: pin/unpin the chat.")',
      'return "pinned";',
      " * The folder rail. Two things pinned here:",
      "ALTER TABLE chats ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE;",
    ]) {
      expect(BANNED.test(live), live).toBe(false);
    }
  });

  it("no file in scope matches, in code OR in prose", () => {
    const offenders = FILES.filter((f) => BANNED.test(readFileSync(f, "utf8"))).map((f) =>
      relative(ROOT, f).split(sep).join("/")
    );
    expect(offenders).toEqual([]);
  });

  it("the three routes are gone from the filesystem, not merely unreferenced", () => {
    // ⚠ A ROUTE FILE IS REACHABLE BY ITS PATH ALONE — Next.js needs no import to
    // serve it, so "nothing calls it" is not the same fact as "it is gone", and
    // the prose scan above would never see an untouched handler that still 200s.
    for (const rel of [
      "src/app/api/knowledge/startup-context",
      "src/app/api/knowledge/bases/[baseId]/pin",
      "src/app/api/knowledge/entries/[entryId]/pin",
    ]) {
      expect(() => statSync(join(ROOT, rel)), rel).toThrow();
    }
  });
});

/**
 * The SQL half. `20261014120000_drop_knowledge_pinned.sql` drops both columns;
 * the file that ADDED them stays on disk unedited, because history is the record
 * of what was true and a replay of an older checkout must still work.
 *
 * ⚠ **SO THE SCAN HERE IS "THE DROP IS THE LAST WORD", NOT "the word is
 * absent"** — the adding migration is full of it by construction.
 */
/** SQL with `--` comments stripped line-wise — these headers quote their own
 *  statements at length, so a raw scan reads the PROSE as the code. */
function statementsOf(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

describe("🔒 the pinned columns are dropped in migration order", () => {
  const DIR = join(ROOT, "supabase", "migrations");
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filename order IS apply order

  it("the drop exists and is the LAST file to touch either column", () => {
    const touching = files.filter((f) =>
      /knowledge_(bases|entries)[\s\S]*?pinned|pinned[\s\S]*?knowledge_(bases|entries)/i.test(
        readFileSync(join(DIR, f), "utf8")
      )
    );
    expect(touching.length).toBeGreaterThanOrEqual(2);
    expect(touching.at(-1)).toBe("20261014120000_drop_knowledge_pinned.sql");
  });

  it("the drop is idempotent on both tables", () => {
    const sql = readFileSync(join(DIR, "20261014120000_drop_knowledge_pinned.sql"), "utf8");
    for (const tbl of ["knowledge_bases", "knowledge_entries"]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE\\s+${tbl}\\s+DROP COLUMN IF EXISTS pinned;`, "i")
      );
    }
    // ⚠ NO CASCADE, and that is measured rather than assumed: nothing depends on
    // these columns (no index, policy, routine or view mentions them — read off
    // the live catalog on 2026-09-18), so a CASCADE here could only ever take
    // something nobody predicted.
    // ⚠ **COMMENTS ARE STRIPPED FIRST** (`knowledge/schema-sql.test.ts`'s rule):
    // this file's own header explains that it carries no CASCADE, and an
    // unstripped scan read that sentence as the thing it forbids.
    expect(statementsOf(sql)).not.toMatch(/DROP COLUMN[^;]*CASCADE/i);
  });

  it("the chat-list pin is NOT dropped by it", () => {
    // Same word, different feature, and no ruling covers it.
    const sql = readFileSync(join(DIR, "20261014120000_drop_knowledge_pinned.sql"), "utf8");
    expect(statementsOf(sql)).not.toMatch(/ALTER TABLE\s+chats\s+DROP COLUMN/i);
  });
});
