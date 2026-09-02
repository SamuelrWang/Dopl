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

/**
 * Scan of every SHIPPED STRING, not just the description: a tool RESULT is read
 * by the same model at the moment it decides what to do next, so it teaches
 * HARDER than the description does.
 *
 * Reads the AST, not raw text — `ts.createSourceFile` yields string/template
 * literals only, so a COMMENT may still discuss removed vocabulary while a
 * shipped sentence may not. Every non-test `channel-*.ts` in this directory is
 * in scope; descriptions, `.describe()` prose, error copy, render helpers and
 * result lines are all the same lane to a reader.
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

  /** Every non-test `channel-*.ts` module — the tool's whole authored surface. */
  const sources = readdirSync(HERE)
    .filter(
      (f) =>
        (f.startsWith("channel-") || f === "channel.ts") &&
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts"),
    )
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
    expect(shippedStrings("channel-post-linkage.ts").length).toBeGreaterThan(3);
  });

  it("the scan can SEE the defect it was written for", () => {
    // Red proof: a scan that cannot fail is not a guard.
    const shipped =
      'to_agent="<handle>" starts that agent, to="<member>" triggers their machine.';
    const hit = REMOVED_VOCABULARY.filter(([, re]) => re.test(shipped));
    expect(hit.map(([label]) => label)).toEqual(["to_agent / to_agents"]);
  });

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
