/**
 * **ONE WAY INTO `channel_messages`, AND THE GRAMMAR STAMP DEPENDS ON IT**
 * (grammar B, 2026-10-12).
 *
 * `repository-messages.ts › insertMessage` writes `metadata.citeMode` on every
 * new row, and a row WITHOUT that stamp is rendered under the legacy prose-pill
 * grammar. So an insert path that bypassed this function would not merely miss a
 * field — it would silently publish a NEW message that renders as an OLD one,
 * with its typed numbers linkified. That is the failure this file refuses.
 *
 * ⚠ **THE ENUMERATION WAS MEASURED, WHICH IS EXACTLY WHY IT NEEDS A TEST.** On
 * 2026-10-12 the funnel was three layers and each was one: one database function
 * inserts (`channel_message_insert`, the only `public` function whose body
 * matches, from a `pg_proc` scan), one call site of that RPC, one production
 * caller of `insertMessage`. A measurement is true on the day it is taken; this
 * is what keeps it true, and what turns a comment claiming a chokepoint into a
 * fact somebody has to break on purpose.
 *
 * ⚠ **CODE, NOT COMMENTS.** `insertMessage` is discussed by name in a dozen
 * docblocks — including the ones explaining this very rule — so a raw-text scan
 * would count prose as callers and go red on a clean tree. Comments come off
 * first and the prose stays as written.
 *
 * ⚠ A deliberate twin of `packages/mcp-server/src/tools/channel-numbering-law.test.ts`'s
 * stripper. The two trees are separate `tsc` programs and the MCP package may not
 * import the app, so sharing it is not available; thirty lines duplicated beats a
 * scan that cannot run where it is needed.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** `src/features/channels` — the feature that owns the table. */
const ROOT = resolve(process.cwd(), "src", "features", "channels");
/** The whole app tree, for the "nothing else writes it" half. */
const SRC = resolve(process.cwd(), "src");

const REPOSITORY = "server/repository-messages.ts";

/** Comments out, code in — string-aware, so a `//` in a literal is not a comment. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
      if (c === "\n") out += c;
      i += 1;
      continue;
    }
    if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`")
    ) {
      mode = "code";
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Shipped `.ts` under `dir`.
 *
 * ⚠ **FIXTURES ARE EXCLUDED ALONGSIDE TESTS.** `_service-writes-metadata-*-fixtures.ts`
 * files `vi.mocked(repoMessages.insertMessage)` — test scaffolding that is not a
 * production insert path, and counting it would make this gate permanently red
 * for the wrong reason.
 */
function shippedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...shippedFiles(full));
      continue;
    }
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    if (name.startsWith("_")) continue;
    out.push(full);
  }
  return out;
}

const channelFiles = shippedFiles(ROOT);
const appFiles = shippedFiles(SRC);

describe("the scan is pointed at a real tree — fails closed, never by absence", () => {
  it("🔒 reads a real feature and a real app tree", () => {
    expect(channelFiles.length).toBeGreaterThan(50);
    expect(appFiles.length).toBeGreaterThan(200);
  });

  it("🔒 the repository it is about is still there, under that name", () => {
    const found = channelFiles.some((f) => relative(ROOT, f) === REPOSITORY);
    expect(
      found,
      `${REPOSITORY} was renamed, moved or deleted. Re-point this gate — do NOT ` +
        `leave it passing over a tree that no longer has the funnel it pins.`
    ).toBe(true);
  });

  it("🔒 stripping PRESERVES code in that file", () => {
    // The sound form of "the stripper did not eat the file": an over-eager
    // stripper would report zero callers and a clean funnel.
    const code = stripComments(readFileSync(join(ROOT, REPOSITORY), "utf8"));
    expect(code).toContain("export async function insertMessage");
  });
});

describe("exactly one way in", () => {
  it("🔒 `insertMessage` has ONE production caller", () => {
    const callers = channelFiles.filter((f) => {
      if (relative(ROOT, f) === REPOSITORY) return false; // the definition
      return /\binsertMessage\s*\(/.test(stripComments(readFileSync(f, "utf8")));
    });
    expect(
      callers.map((f) => relative(ROOT, f)),
      `Every write must funnel through insertMessage so the grammar stamp cannot ` +
        `be missed. A NEW caller is fine — add it here deliberately. A caller that ` +
        `writes the table ANOTHER way is the bug.`
    ).toEqual(["server/service-writes.ts"]);
  });

  it("🔒 nothing else INSERTS into channel_messages", () => {
    // ⚠ **PER CHAIN, NOT PER FILE, AND THE FIRST VERSION WAS PER FILE AND WRONG.**
    // It flagged `repository-artifacts.ts`, which inserts into
    // `channel_artifacts` and separately UPDATEs `channel_messages` — a false red
    // on a clean tree, which erodes a gate as surely as a false pass. The table
    // and the verb have to be the same query to mean anything, so the window is
    // the chain that follows `from("channel_messages")`.
    const CHAIN = 240;
    const offenders = appFiles.filter((f) => {
      const code = stripComments(readFileSync(f, "utf8"));
      let at = code.indexOf('from("channel_messages")');
      while (at !== -1) {
        if (/\.insert\s*\(/.test(code.slice(at, at + CHAIN))) return true;
        at = code.indexOf('from("channel_messages")', at + 1);
      }
      return false;
    });
    expect(
      offenders.map((f) => relative(SRC, f)),
      `A direct INSERT on channel_messages bypasses the grammar stamp, so the row ` +
        `renders as a LEGACY message with its typed numbers linkified.`
    ).toEqual([]);
  });

  it("🔒 the insert RPC is called from ONE file", () => {
    const callers = appFiles.filter((f) =>
      /rpc\(\s*["']channel_message_insert["']/.test(
        stripComments(readFileSync(f, "utf8"))
      )
    );
    expect(callers.map((f) => relative(SRC, f))).toEqual([
      "features/channels/server/repository-messages.ts",
    ]);
  });

  it("🔒 and it BITES — a planted second caller is caught", () => {
    // The rule's own red case, so a refactor that neuters the regex fails here
    // rather than going quietly green over the whole tree.
    const planted = stripComments(
      "// insertMessage in a comment does not count\nawait insertMessage({ body });"
    );
    expect(/\binsertMessage\s*\(/.test(planted)).toBe(true);
    const commentOnly = stripComments("// await insertMessage({ body });\n");
    expect(/\binsertMessage\s*\(/.test(commentOnly)).toBe(false);
  });
});
