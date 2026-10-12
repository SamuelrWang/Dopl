/**
 * **THE LAW: A DISPLAY NUMBER MAY NEVER BE COMPUTED INTO A CURSOR** (Review 33,
 * 2026-10-12).
 *
 * `channel-numbering.test.ts` pins the four surfaces that exist today. This pins
 * the ones nobody has written yet — and that is the half that matters, because
 * the defect Review 33 found was not a wrong line, it was an ABSENT assertion:
 * routing `lastSeq` through `channelNoOf` on three of four surfaces left 2,963
 * tests green. A hold re-arms on its cursor every turn, so the cost of getting it
 * wrong is a watermark that is permanently off by the gap between a channel's own
 * count and the table's, silently skipping or replaying another room's history.
 *
 * THE RULE: in one statement, `channelNoOf` / `threadNoOf` may not appear beside
 * `lastSeq`, `cursor` or `since`. A display number and a cursor are different
 * namespaces; any statement touching both is either a bug or needs rewriting so
 * that it isn't.
 *
 * ⚠ **IT SCANS CODE, NOT COMMENTS, AND THAT IS NOT A CONVENIENCE.**
 * `channel-numbering.ts`'s docblock says "NEVER FEED THE RESULT TO `since=`" and
 * names `cursor=` beside `channelNoOf` — correctly, because explaining the law is
 * its job. A raw-text scan would go red on a clean tree, and the only ways out
 * would be to weaken the rule or delete the warning. So comments come off first,
 * and the prose stays exactly as written.
 *
 * ⚠ **THE STRIPPER FAILS CLOSED, WHICH IS THE WHOLE REASON IT IS TESTED HERE
 * TOO.** A scanner that silently produces nothing reports a clean tree — the
 * worst possible failure for a gate, and the shape this repo has already paid for
 * (the CSS-slice tests that failed open). So: a file whose stripped output is
 * blank while its source was not throws; an empty file list throws; and the
 * anchor file going missing or being renamed throws rather than passing by
 * absence.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * `src/` of this package — the whole surface, not just `tools/`.
 *
 * ⚠ **OFF `process.cwd()` (package root under vitest), NOT `import.meta`.**
 * `import.meta` is disallowed by this package's CommonJS `tsc` target, and
 * vitest transforms it happily — so a scan written that way passes every test
 * run and fails the BUILD, which is the worst place to find out. The rule and
 * its reason are already written down in `law-scan.test.ts` and `parity.test.ts`;
 * this follows them.
 */
const SRC = resolve(process.cwd(), "src");

/** The file whose existence proves the scan is pointed at the right tree. */
const ANCHOR = "tools/channel-numbering.ts";

const DISPLAY = /\b(?:channelNoOf|threadNoOf)\b/;
const CURSOR = /\b(?:lastSeq|cursor|since)\b/;

/**
 * Comments out, code in.
 *
 * ⚠ **STRING-AWARE ON PURPOSE.** A `//` inside a string literal or a template is
 * not a comment, and a stripper that treated it as one would delete the rest of a
 * real line of code — which would hide violations rather than find them, the
 * failure this gate exists to prevent.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      // Keep newlines so statement boundaries and line counts survive.
      if (c === "\n") out += c;
      i += 1;
      continue;
    }
    // Inside a string: copy verbatim, honour escapes, end on the delimiter.
    if (c === "\\") {
      out += c + (next ?? "");
      i += 2;
      continue;
    }
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

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
      continue;
    }
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    out.push(full);
  }
  return out;
}

/** Statements, so a multi-line expression stays ONE unit rather than splitting. */
function statementsOf(code: string): string[] {
  return code.split(";");
}

export function violationsIn(
  source: string,
  label: string
): Array<{ file: string; statement: string }> {
  return statementsOf(stripComments(source))
    .filter((s) => DISPLAY.test(s) && CURSOR.test(s))
    .map((statement) => ({ file: label, statement: statement.trim() }));
}

/**
 * **FAIL CLOSED BEFORE SCANNING ANYTHING.**
 *
 * ⚠ **AND NOT BY "DID A FILE STRIP TO EMPTY", WHICH WAS THIS GATE'S FIRST AND
 * UNSOUND ATTEMPT.** An all-comment file legitimately strips to nothing, so that
 * guard went red on a clean tree for a correct stripper — a false alarm, which
 * erodes a gate as surely as a false pass. The sound signals are structural: is
 * there a tree here at all, and is the file this law is ABOUT still in it.
 */
export function assertScannable(files: string[], root: string): void {
  if (files.length === 0) {
    throw new Error(
      `no source files found under ${root} — the scan would pass by emptiness.`
    );
  }
  if (!files.some((f) => relative(root, f) === ANCHOR)) {
    throw new Error(
      `${ANCHOR} is not in the scanned set. It was renamed, moved or deleted — ` +
        `re-point this gate rather than leave it passing over a tree without it.`
    );
  }
}

describe("the stripper is honest about what it removes", () => {
  it("removes line and block comments and keeps the code", () => {
    const code = stripComments(
      "const a = 1; // channelNoOf cursor\n/* channelNoOf since */ const b = 2;"
    );
    expect(code).toContain("const a = 1;");
    expect(code).toContain("const b = 2;");
    expect(code).not.toContain("channelNoOf");
  });

  it("🔒 does NOT treat a `//` inside a string as a comment", () => {
    // Eating the rest of this line would hide any violation after it.
    const code = stripComments('const u = "https://x"; const n = channelNoOf(m);');
    expect(code).toContain("channelNoOf(m)");
    expect(code).toContain("https://x");
  });

  it("🔒 an all-comment file is not an error — the unsound guard's lesson", () => {
    // The first version of this gate threw here, on a clean tree, for a correct
    // stripper. Recorded so nobody re-adds it.
    expect(() => violationsIn("// just a note\n", "note.ts")).not.toThrow();
    expect(violationsIn("// just a note\n", "note.ts")).toEqual([]);
  });

  it("🔒 FAILS CLOSED on an empty tree and on a missing anchor", () => {
    expect(() => assertScannable([], SRC)).toThrow(/pass by emptiness/);
    expect(() => assertScannable([join(SRC, "tools/other.ts")], SRC)).toThrow(
      /not in the scanned set/
    );
    // And passes on the real set, which the scan below depends on.
    expect(() => assertScannable(tsFiles(SRC), SRC)).not.toThrow();
  });
});

describe("no statement mixes a display number with a cursor", () => {
  const files = tsFiles(SRC);

  it("🔒 the scan is pointed at a real tree — fails closed, never by absence", () => {
    assertScannable(files, SRC);
    expect(files.length).toBeGreaterThan(20);
  });

  it("🔒 stripping PRESERVES code in the real anchor file", () => {
    // The sound version of "the stripper did not eat the file": the anchor's own
    // code must survive stripping. An over-eager stripper reports a clean tree,
    // and this is the assertion that refuses to let it.
    const code = stripComments(readFileSync(join(SRC, ANCHOR), "utf8"));
    expect(code).toContain("export function channelNoOf");
    expect(code).toContain("export function threadNoOf");
  });

  it("🔒 holds across every source file in the package", () => {
    const found = files.flatMap((f) =>
      violationsIn(readFileSync(f, "utf8"), relative(SRC, f))
    );
    expect(
      found,
      found
        .map(
          (v) =>
            `${v.file}: a display number and a cursor in one statement —\n    ${v.statement}`
        )
        .join("\n")
    ).toEqual([]);
  });

  it("🔒 and it BITES — a planted violation is caught", () => {
    // The rule's own red case, so a future refactor that neuters the regexes
    // fails here rather than going quietly green over the whole package.
    const planted = "const lastSeq = channelNoOf(messages[0]);";
    expect(violationsIn(planted, "planted.ts")).toHaveLength(1);
    expect(violationsIn("const x = threadNoOf(m); const cursor = y;", "p.ts")).toHaveLength(0);
    expect(violationsIn("const cursor = threadNoOf(m);", "p.ts")).toHaveLength(1);
  });

  it("🔒 and it does NOT bite the docblock that explains the law", () => {
    // `channel-numbering.ts` names `since=` and `cursor=` beside `channelNoOf`
    // in prose. A raw-text scan would call that a violation; this one must not,
    // and the prose must stay exactly as written.
    const anchor = readFileSync(join(SRC, ANCHOR), "utf8");
    expect(anchor).toContain("NEVER FEED THE RESULT TO");
    expect(violationsIn(anchor, ANCHOR)).toEqual([]);
  });
});
