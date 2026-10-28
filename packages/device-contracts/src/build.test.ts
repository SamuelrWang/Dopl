/**
 * The published shape works: `npm run build` emits `dist/`, every relative specifier there carries
 * `.js`, and plain Node ESM can import the package entry and parse with its schemas.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

describe("dist build", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "pipe" });
  }, 120_000);

  it("emits only .js-suffixed relative specifiers", () => {
    const files = readdirSync(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".d.ts"));
    expect(files).toContain("index.js");
    expect(files).toContain("index.d.ts");
    const bare = files.flatMap((f) =>
      [...readFileSync(join(DIST, f), "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)]
        .map((m) => m[1])
        .filter((s) => !s.endsWith(".js"))
        .map((s) => `${f}: ${s}`)
    );
    expect(bare).toEqual([]);
  });

  it("imports under plain Node ESM and its schemas parse", () => {
    const entry = join(DIST, "index.js");
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(entry)});` +
          `const r = m.DisplayBlockSchema.safeParse({ id: "h", type: "heading", text: "hi" });` +
          `console.log(JSON.stringify({ ok: r.success, keys: Object.keys(m).length }));`,
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    const res = JSON.parse(out.trim()) as { ok: boolean; keys: number };
    expect(res.ok).toBe(true);
    expect(res.keys).toBeGreaterThan(10);
  });
});
