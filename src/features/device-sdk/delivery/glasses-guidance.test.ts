/**
 * 🔒 The Device SDK's glasses line is byte-equal to the app's MCP copy. Read as a FILE, not
 * imported: a test may compare across the boundary, runtime code may not (Plan §7.2).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GLASSES_REPLY_GUIDANCE } from "./glasses-guidance";

const MCP_LEAF = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/mcp-server/src/tools/glasses-reply-guidance.ts",
);

/** Evaluates the `"…" + "…"` string-literal concatenation of the leaf's export. */
function leafValue(src: string): string {
  const start = src.indexOf("export const GLASSES_REPLY_GUIDANCE =");
  const body = src.slice(start, src.indexOf(";", start));
  const parts = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
  return parts.join("");
}

describe("glasses reply guidance parity", () => {
  it("equals the MCP leaf byte for byte", () => {
    const leaf = leafValue(readFileSync(MCP_LEAF, "utf8"));
    expect(leaf.length).toBeGreaterThan(50);
    expect(GLASSES_REPLY_GUIDANCE).toBe(leaf);
  });
});
