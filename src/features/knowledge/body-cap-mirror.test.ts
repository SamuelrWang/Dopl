/**
 * 🔒 **THE MCP PACKAGE'S HAND-MIRRORED KNOWLEDGE CAPS, PINNED TO THEIR SOURCES.**
 *
 * `packages/mcp-server` cannot import `src/`, so it restates two numbers:
 * `tools/knowledge-validation.ts › MB_LIMIT_CHARS` and `› KB_TEXT_FIELD_MAX`
 * (quoted in the refusals it writes), plus `tools/knowledge.ts`'s
 * `body: z.string().max(…)`. Its own comment said a `knowledge-validation.test.ts`
 * pinned the pair; no such file ever existed (cleanup K05). A refusal quoting a
 * number BELOW the server's real bound refuses a legal write, so a drift here is
 * a wrong answer, not a cosmetic one.
 *
 * The package files are read as TEXT: importing them would pull the package's
 * own dependency tree into this suite.
 *
 * MUTATION-VERIFY (each alone turns the named case red):
 *  - `MB_LIMIT_CHARS = 1_000_000` in knowledge-validation.ts → "body cap".
 *  - `KB_TEXT_FIELD_MAX = 200` → "text-field cap".
 *  - `body: z.string().max(2_000_000)` in knowledge.ts → "input shape".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DESCRIPTION_MAX } from "@/config";
import { MAX_BODY_BYTES } from "./schema";

const TOOLS = join(process.cwd(), "packages", "mcp-server", "src", "tools");
const read = (file: string) => readFileSync(join(TOOLS, file), "utf8");

/** The integer a `const NAME = 1_234;` declares, required to exist. */
function constOf(src: string, name: string): number {
  const m = new RegExp(String.raw`const ${name} = ([\d_]+);`).exec(src);
  expect(m, `${name} must still be declared as a number literal`).not.toBeNull();
  return Number(m![1].replace(/_/g, ""));
}

describe("packages/mcp-server knowledge caps mirror the server's", () => {
  const validation = read("knowledge-validation.ts");

  it("body cap: MB_LIMIT_CHARS equals schema.ts › MAX_BODY_BYTES", () => {
    expect(constOf(validation, "MB_LIMIT_CHARS")).toBe(MAX_BODY_BYTES);
  });

  it("text-field cap: KB_TEXT_FIELD_MAX equals config › DESCRIPTION_MAX", () => {
    expect(constOf(validation, "KB_TEXT_FIELD_MAX")).toBe(DESCRIPTION_MAX);
  });

  it("input shape: knowledge.ts's body `.max(…)` equals MAX_BODY_BYTES", () => {
    const m = /^\s*body: z\.string\(\)\.max\(([\d_]+)\)/m.exec(read("knowledge.ts"));
    expect(m, "control: knowledge.ts still declares a capped body field").not.toBeNull();
    expect(Number(m![1].replace(/_/g, ""))).toBe(MAX_BODY_BYTES);
  });
});
