/**
 * THE DESKTOP'S COPY OF THE GRANULAR MANIFEST (DMP-013 B4), pinned byte-for-byte. The desktop app
 * ships only `dopl-desktop-app/main/**`, so it cannot import this package at runtime; it reads
 * `main/dopl-tool-table.json`, which is this projection of `tool-manifest.ts` and nothing else.
 * `main/mcp-tool-names.js › canonicalDoplCall` turns a granular call back into its legacy key with
 * it, so every desktop gate list keeps reading legacy keys.
 *
 * Regenerate after a manifest change: `UPDATE_DESKTOP_TOOL_TABLE=1 npx vitest run src/desktop-tool-table.test.ts`
 * (from packages/mcp-server).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GRANULAR_TOOLS, isReadOnlyTool, selectorOf, type GranularTool } from "./tool-manifest.js";

const TABLE_PATH = path.resolve(__dirname, "../../../dopl-desktop-app/main/dopl-tool-table.json");

/** Only what the desktop reads: the jobs, how a call picks one, and the read/write class. */
function row(t: GranularTool) {
  const select = selectorOf(t);
  return {
    name: t.name,
    bind: t.bind,
    ...(select && { select }),
    ...(t.selectDefault && { default: t.selectDefault }),
    ...(t.preset && { preset: t.preset }),
    ...(t.pulled && { pulled: Object.keys(t.pulled) }),
    read: isReadOnlyTool(t),
  };
}

function table() {
  return {
    _source: "GENERATED from packages/mcp-server/src/tool-manifest.ts by desktop-tool-table.test.ts; do not edit.",
    tools: GRANULAR_TOOLS.map(row),
  };
}

describe("desktop tool table", () => {
  it("is the manifest's projection, byte for byte", () => {
    const want = `${JSON.stringify(table(), null, 2)}\n`;
    if (process.env.UPDATE_DESKTOP_TOOL_TABLE === "1") writeFileSync(TABLE_PATH, want);
    expect(readFileSync(TABLE_PATH, "utf8")).toBe(want);
  });

  it("names every job a call can pick, and a pulled job is never also bound", () => {
    for (const t of table().tools) {
      if (typeof t.bind === "string") expect(t.select).toBeUndefined();
      else expect(t.select).toBeTruthy();
      for (const job of t.pulled ?? []) expect(typeof t.bind === "string" ? undefined : t.bind[job]).toBeUndefined();
    }
  });
});
