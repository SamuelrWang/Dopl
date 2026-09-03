/**
 * **THE SOURCE-WIDE REMOVED-VOCABULARY SCAN.**
 *
 * ⚠ **SPLIT OUT OF `channel-law.test.ts` ON 2026-09-01, AT THE 500-LINE CAP** —
 * that file reached 522 when the `rename_agent` revival needed its ruling written
 * down and a POSITIVE guard put in place of the banned word. The seam is real
 * rather than arithmetic: `channel-law.test.ts` pins PROSE, string-matching ONE
 * value (`CHANNEL_DESCRIPTION`); this file walks the AST of every shipped module
 * in the directory. Different input, different failure mode, different thing to
 * read when it goes red.
 *
 * ⚠ **THE FILENAME HAS NO `channel-` PREFIX AND MUST NOT GET ONE** — the scan
 * below excludes `.test.ts`, so this file is safe either way, but its sibling
 * `law-removed-vocabulary.ts` is not: that module holds the banned words as
 * regexes. The pair is named together so neither drifts into the glob.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import { REMOVED_VOCABULARY } from "./law-removed-vocabulary";
import { RETIRED_OP_NAMES } from "./channel-retired-ops";

/**
 * Scan of every SHIPPED STRING, not just the description: a tool RESULT is read
 * by the same model at the moment it decides what to do next, so it teaches
 * HARDER than the description does.
 *
 * Reads the AST, not raw text — `ts.createSourceFile` yields string/template
 * literals only, so a COMMENT may still discuss removed vocabulary while a
 * shipped sentence may not. **Every non-test `*.ts` in this directory is in
 * scope**; descriptions, `.describe()` prose, error copy, render helpers and
 * result lines are all the same lane to a reader.
 *
 * ⚠ **THE GLOB WAS `channel-*.ts` UNTIL 2026-09-02 (F-592), AND THE HOLE WAS
 * THE SHAPE OF THE PRODUCT.** `dopl_channel` is the tool whose vocabulary keeps
 * changing, so scanning its own modules felt like the whole job — but the
 * sentences that TELL an agent to call `dopl_channel` are written in the OTHER
 * tools: `dopl_agent` says how to launch a template into a channel, `dopl_status`
 * says how to wait instead of polling. Five shipped strings across four such
 * files were routing callers to op names B8 retired, and no scan looked at any
 * of them. A cross-tool pointer is exactly the string a model acts on, because
 * it arrives at the moment it is deciding what to call next.
 *
 * ⚠ NO ALLOWLIST, on purpose — an exemption is how a removed-vocabulary string
 * survived four phases of the rollback. When a legitimate English sentence
 * collides, rephrase it: an agent cannot tell a descriptive use from an
 * instructive one.
 */
describe("no SHIPPED STRING in the channel tool teaches removed vocabulary", () => {
  // ⚠ Off `process.cwd()` (package root under vitest): `import.meta` is
  // disallowed by this package's CommonJS tsc target and `__dirname` is not
  // guaranteed under the ESM-transformed test. Same as `parity.test.ts`.
  const HERE = path.resolve(process.cwd(), "src", "tools");

  /**
   * Every non-test module in the directory — the whole authored surface, not
   * one tool's.
   *
   * ⚠ **ONE EXCLUSION, AND IT IS THE RULE BOOK.**
   * `law-removed-vocabulary.ts` holds the banned words; its REGEXES are not
   * string literals and would not be scanned, but its LABELS are (`"as_agent"`,
   * `"the propose_close op"`), so including it would make the guard fail on the
   * file that defines it. That module's own header says the filename is
   * load-bearing for this reason; now the exclusion is by NAME rather than by
   * the accident of a missing prefix.
   */
  const RULE_BOOK = "law-removed-vocabulary.ts";
  const sources = readdirSync(HERE)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== RULE_BOOK)
    .sort();

  /** Literal TEXT only — comments are not literals, so they are never scanned. */
  function shippedStrings(file: string): Array<{ text: string; line: number }> {
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join(HERE, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const out: Array<{ text: string; line: number }> = [];
    const walk = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        out.push({
          text: node.text,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
    return out;
  }

  it("finds the modules at all (a scan over nothing is not a guard)", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain("channel-post-linkage.ts");
    expect(sources).toContain("channel-ops-write.ts");
    expect(sources).toContain("channel-render-threads.ts");
    // ⚠ THE FOUR THAT THE OLD GLOB MISSED, named so a narrowing shows up here
    // rather than as a quiet drop in the case count (F-592).
    for (const beyond of ["agent.ts", "agent-ops-write.ts", "status.ts", "status-render.ts"]) {
      expect(sources, beyond).toContain(beyond);
    }
    expect(sources).not.toContain(RULE_BOOK);
    expect(shippedStrings("channel-post-linkage.ts").length).toBeGreaterThan(3);
  });

  it("the scan can SEE the defect it was written for", () => {
    // Red proof: a scan that cannot fail is not a guard.
    const shipped =
      'to_agent="<handle>" starts that agent, to="<member>" triggers their machine.';
    const hit = REMOVED_VOCABULARY.filter(([, re]) => re.test(shipped));
    expect(hit.map(([label]) => label)).toEqual(["to_agent / to_agents"]);
  });

  /**
   * 🔒 **A SHIPPED STRING MAY NOT NAME A RETIRED `dopl_channel` OP** (F-592).
   *
   * ⚠ A DIFFERENT QUESTION FROM {@link REMOVED_VOCABULARY}, and it has to be:
   * these twenty-two names still PARSE for one release, so they are not banned
   * words — they are answers to a question nobody should still be asking. A
   * string that TELLS a caller to use one has taught the retired spelling and
   * spent a redirect that exists for callers pinned to an older desktop.
   *
   * ⚠ **SCOPED TO `dopl_channel`, BECAUSE THE NAMES ARE ORDINARY WORDS
   * ELSEWHERE.** `list`, `update`, `open`, `members` and `help` are live ops on
   * other tools, so a bare match would be noise. Two forms count: an explicit
   * `dopl_channel(op="…")` anywhere, and a bare `op="…"` inside a
   * `channel-*.ts` module, where the tool is the file.
   */
  const RETIRED = new Set<string>(RETIRED_OP_NAMES);
  const QUALIFIED = /dopl_channel\(\s*op\s*=\s*"([a-z_]+)"/g;
  const BARE = /\bop\s*=\s*"([a-z_]+)"/g;

  for (const file of sources) {
    it(`${file} routes no caller to a retired dopl_channel op`, () => {
      const ownTool = file.startsWith("channel-") || file === "channel.ts";
      const found: string[] = [];
      for (const { text, line } of shippedStrings(file)) {
        for (const re of ownTool ? [QUALIFIED, BARE] : [QUALIFIED]) {
          re.lastIndex = 0;
          for (const m of text.matchAll(re)) {
            if (RETIRED.has(m[1])) found.push(`${file}:${line} op="${m[1]}"`);
          }
        }
      }
      expect(
        found,
        `a shipped string names an op B8 retired — say the replacement instead (channel-retired-ops.ts has the mapping):\n${found.join("\n")}`,
      ).toEqual([]);
    });
  }

  for (const file of sources) {
    it(`${file} ships no removed vocabulary`, () => {
      const found: string[] = [];
      for (const { text, line } of shippedStrings(file)) {
        for (const [label, re] of REMOVED_VOCABULARY) {
          if (re.test(text)) {
            found.push(`${file}:${line} [${label}] ${JSON.stringify(text.slice(0, 120))}`);
          }
        }
      }
      expect(
        found,
        `a shipped string teaches a surface that no longer exists:\n${found.join("\n")}`,
      ).toEqual([]);
    });
  }
});
