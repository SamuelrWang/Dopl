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
 * ⚠ **REVIEW 36 (2026-10-12) FOUND THIS GATE WRONG IN BOTH DIRECTIONS AT ONCE**,
 * which is the worst state for a gate and the reason the scanners below are
 * FUNCTIONS exercised on planted probes rather than one regex trusted over a
 * tree that happens to be clean:
 *   1. **It could be evaded by a single quote.** `from('channel_messages')` is
 *      identical Supabase and the scan only knew double quotes. Nothing in the
 *      tree writes it that way today, so the hole was invisible — 7/7 green with
 *      a planted single-quote insert sitting in the source.
 *   2. **It falsely accused.** A fixed 240-character window from a channel_messages
 *      READ reaches into the NEXT statement, so an unrelated `.insert()` on
 *      another table a line later read as a bypass. A gate that cries wolf is
 *      removed by the next person in a hurry.
 *   3. **It looked in the wrong place.** The caller scan read this feature only,
 *      while `channel_messages` is touched from six features (display, glasses,
 *      home, search, workspaces, channels) and `packages/` ships code too. The
 *      one scope both scans now share is src + every package's own `src`.
 *
 * ⚠ A deliberate twin of `packages/mcp-server/src/tools/channel-numbering-law.test.ts`'s
 * stripper. The two trees are separate `tsc` programs and the MCP package may not
 * import the app, so sharing it is not available; thirty lines duplicated beats a
 * scan that cannot run where it is needed.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = process.cwd();

const REPOSITORY = "src/features/channels/server/repository-messages.ts";
const THE_ONE_CALLER = "src/features/channels/server/service-writes.ts";

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
 * The same code with every STRING LITERAL'S CONTENTS blanked, character for
 * character, so offsets still line up with the unmasked copy.
 *
 * ⚠ **IT EXISTS FOR THE WINDOW BOUNDARY AND NOTHING ELSE.** The boundary is "the
 * end of this statement", found by looking for the next `;`. A `;` inside a
 * string literal — an SQL fragment, a message, a regex-ish constant — would end
 * the window early and hide a real insert. Masking contents while KEEPING the
 * quotes means `from("channel_messages")` is still found in the unmasked copy at
 * the same index, while punctuation inside literals cannot be mistaken for
 * syntax.
 */
function maskStringContents(code: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < code.length) {
    const c = code[i];
    if (quote === null) {
      if (c === "'" || c === '"' || c === "`") quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "\\") { out += "xx"; i += 2; continue; }
    if (c === quote) { quote = null; out += c; i += 1; continue; }
    // Newlines are preserved so a template literal cannot swallow line structure.
    out += c === "\n" ? "\n" : "x";
    i += 1;
  }
  return out;
}

/** `from("channel_messages")` or `from('channel_messages')` — both are Supabase. */
const TABLE_RE = /from\(\s*["']channel_messages["']\s*\)/g;

/**
 * **DOES THIS SOURCE INSERT INTO `channel_messages`?**
 *
 * ⚠ **THE WINDOW IS THE STATEMENT, NOT A CHARACTER COUNT.** From the table
 * reference it runs to whichever comes first: the end of the statement (`;`) or
 * the next `from(` — because a second `from(` is a second query whatever the
 * punctuation looks like. That is what makes it accurate in both directions: a
 * real `.insert(` stays caught however far down its own chain it sits, across
 * newlines and `.select()` steps, while an `.insert()` on a DIFFERENT table in
 * the NEXT statement is no longer this statement's problem.
 *
 * ⚠ **KNOWN AND ACCEPTED LIMIT**: a chain broken across statements through a
 * variable (`const q = db.from("channel_messages"); await q.insert(…)`) is not
 * seen by any text scan. The DB-level guard is the real backstop — the client
 * role has no INSERT on this table — and this gate is the cheap one that catches
 * the way a human would actually write it.
 */
function insertsChannelMessages(source: string): boolean {
  const code = stripComments(source);
  const masked = maskStringContents(code);
  TABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_RE.exec(code)) !== null) {
    const after = m.index + m[0].length;
    const semi = masked.indexOf(";", after);
    const nextFrom = masked.indexOf("from(", after);
    const ends = [semi, nextFrom].filter((n) => n !== -1);
    const end = ends.length > 0 ? Math.min(...ends) : code.length;
    if (/\.insert\s*\(/.test(code.slice(after, end))) return true;
  }
  return false;
}

/** Does this source CALL `insertMessage(…)` in code (not merely name it in prose)? */
function callsInsertMessage(source: string): boolean {
  return /\binsertMessage\s*\(/.test(stripComments(source));
}

/** Does this source call the insert RPC? */
function callsInsertRpc(source: string): boolean {
  return /rpc\(\s*["']channel_message_insert["']/.test(stripComments(source));
}

/**
 * Shipped `.ts` / `.tsx` under `dir`.
 *
 * ⚠ **FIXTURES ARE EXCLUDED ALONGSIDE TESTS.** `_service-writes-metadata-*-fixtures.ts`
 * files `vi.mocked(repoMessages.insertMessage)` — test scaffolding that is not a
 * production insert path, and counting it would make this gate permanently red
 * for the wrong reason.
 * ⚠ **AND `dist` IS EXCLUDED**, which matters now that packages are in scope: a
 * committed `dist` holds `.d.ts` files (they end in `.ts`) and compiled copies of
 * the same source, so including it would double-count every finding.
 */
function shippedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "dist" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...shippedFiles(full));
      continue;
    }
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    if (name.endsWith(".d.ts")) continue;
    if (name.startsWith("_")) continue;
    out.push(full);
  }
  return out;
}

/**
 * **THE ONE SCOPE BOTH SCANS SHARE** (Review 36, item 3): the app tree plus every
 * package's own `src`. Two scans with two scopes is how "nothing else inserts"
 * ended up checked more widely than "nothing else calls the funnel".
 */
function treeFiles(): string[] {
  const roots = [resolve(REPO, "src")];
  const pkgs = resolve(REPO, "packages");
  if (existsSync(pkgs)) {
    for (const name of readdirSync(pkgs)) {
      const src = join(pkgs, name, "src");
      if (existsSync(src) && statSync(src).isDirectory()) roots.push(src);
    }
  }
  return roots.flatMap(shippedFiles);
}

const TREE = treeFiles();
const rel = (f: string) => relative(REPO, f);
const read = (f: string) => readFileSync(f, "utf8");

describe("the scan is pointed at a real tree — fails closed, never by absence", () => {
  it("🔒 reads a real app tree AND the packages", () => {
    expect(TREE.length).toBeGreaterThan(200);
    expect(
      TREE.some((f) => rel(f).startsWith("packages/")),
      `Review 36 item 3: packages ship code too, and a scan that silently covered ` +
        `only src would pass while a package inserted rows.`
    ).toBe(true);
  });

  it("🔒 the scope reaches OTHER features that touch this table", () => {
    // Measured 2026-10-12: `channel_messages` is read from six features. The
    // caller scan used to see only `features/channels`, so a bypass written in
    // any of the other five was invisible to it.
    for (const f of [
      "src/features/display/server/repository.ts",
      "src/features/workspaces/server/repository-overview.ts",
      "src/features/search/server/repository-channel-rows.ts",
    ]) {
      expect(TREE.map(rel), `${f} must be in scope`).toContain(f);
    }
  });

  it("🔒 the repository it is about is still there, under that name", () => {
    expect(
      TREE.map(rel).includes(REPOSITORY),
      `${REPOSITORY} was renamed, moved or deleted. Re-point this gate — do NOT ` +
        `leave it passing over a tree that no longer has the funnel it pins.`
    ).toBe(true);
  });

  it("🔒 stripping PRESERVES code in that file", () => {
    // The sound form of "the stripper did not eat the file": an over-eager
    // stripper would report zero callers and a clean funnel.
    expect(stripComments(read(resolve(REPO, REPOSITORY)))).toContain(
      "export async function insertMessage"
    );
  });
});

describe("exactly one way in", () => {
  it("🔒 `insertMessage` has ONE production caller, tree-wide", () => {
    const callers = TREE.filter(
      (f) => rel(f) !== REPOSITORY && callsInsertMessage(read(f))
    ).map(rel);
    expect(
      callers,
      `Every write must funnel through insertMessage so the grammar stamp cannot ` +
        `be missed. A NEW caller is fine — add it here deliberately. A caller that ` +
        `writes the table ANOTHER way is the bug.`
    ).toEqual([THE_ONE_CALLER]);
  });

  it("🔒 nothing else INSERTS into channel_messages", () => {
    const offenders = TREE.filter((f) => insertsChannelMessages(read(f))).map(rel);
    expect(
      offenders,
      `A direct INSERT on channel_messages bypasses the grammar stamp, so the row ` +
        `renders as a LEGACY message with its typed numbers linkified.`
    ).toEqual([]);
  });

  it("🔒 the insert RPC is called from ONE file", () => {
    const callers = TREE.filter((f) => callsInsertRpc(read(f))).map(rel);
    expect(callers).toEqual([REPOSITORY]);
  });
});

/**
 * **THE SCANNERS' OWN RED CASES** (Review 36). Each probe is source the gate MUST
 * judge a particular way, so a refactor that neuters a pattern fails here rather
 * than going quietly green over a tree that happens not to contain the shape.
 */
describe("the scanners bite, and only where they should", () => {
  it("🔒 a SINGLE-QUOTED insert is caught — the Review 36 evasion", () => {
    expect(
      insertsChannelMessages(`await db.from('channel_messages').insert({ body });`),
      `Identical Supabase, invisible to the old double-quote-only scan.`
    ).toBe(true);
  });

  it("double quotes are still caught", () => {
    expect(
      insertsChannelMessages(`await db.from("channel_messages").insert({ body });`)
    ).toBe(true);
  });

  it("🔒 an insert FAR DOWN THE SAME CHAIN is caught", () => {
    // @batch-reviewer-3's addendum: the window fix must not overshoot into
    // under-reporting. Line breaks, a `.select()`, and a comment in the middle
    // are all ordinary in this codebase.
    const src = `
      const { data, error } = await db
        .from("channel_messages")
        // a comment that sits inside the chain
        .select("id, seq")
        .eq("channel_id", channelId)
        .insert({ body })
        .single();
    `;
    expect(insertsChannelMessages(src)).toBe(true);
  });

  it("🔒 an insert on ANOTHER table after a read is NOT caught", () => {
    // The false accusation: `repository-artifacts.ts` reads channel_messages and
    // separately inserts channel_artifacts. A fixed character window reached
    // across the statement boundary and called it a bypass.
    const src = `
      await db.from("channel_messages").select("id").eq("channel_id", id);
      await db.from("channel_artifacts").insert({ name });
    `;
    expect(insertsChannelMessages(src)).toBe(false);
  });

  it("🔒 and not caught even when the other insert is 60 characters later", () => {
    const src =
      `await db.from("channel_messages").select("id");` +
      ` await db.from("other").insert({ a: 1 });`;
    expect(insertsChannelMessages(src)).toBe(false);
  });

  it("🔒 a `;` inside a STRING does not end the window early", () => {
    // Which is why the boundary is found on a string-masked copy.
    const src = `await db.from("channel_messages").eq("note", "a; b").insert({ body });`;
    expect(insertsChannelMessages(src)).toBe(true);
  });

  it("a plain READ is not an insert", () => {
    expect(
      insertsChannelMessages(`await db.from("channel_messages").select("id");`)
    ).toBe(false);
  });

  it("🔒 the word `insert` in a COMMENT is not an insert", () => {
    expect(
      insertsChannelMessages(
        `// we never .insert() here\nawait db.from("channel_messages").select("id");`
      )
    ).toBe(false);
  });

  it("🔒 a planted CALLER is caught, in code and not in prose", () => {
    expect(callsInsertMessage(`await insertMessage({ body });`)).toBe(true);
    expect(callsInsertMessage(`// await insertMessage({ body });\n`)).toBe(false);
    // ⚠ THE CASE THE WHOLE STRIPPER EXISTS FOR: a DOCBLOCK that shows the call
    // in its explanation. A dozen files in this feature do exactly this,
    // including the one you are reading.
    expect(
      callsInsertMessage("/**\n * `insertMessage({ body })` is the one funnel.\n */\n")
    ).toBe(false);
  });

  it("🔒 the RPC scan takes either quote too", () => {
    expect(callsInsertRpc(`db.rpc("channel_message_insert", {})`)).toBe(true);
    expect(callsInsertRpc(`db.rpc('channel_message_insert', {})`)).toBe(true);
    expect(callsInsertRpc(`// db.rpc("channel_message_insert", {})`)).toBe(false);
  });
});
