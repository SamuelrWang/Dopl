/**
 * Standalone gate: `@dopl/sdk` and `@dopl/device-contracts` are the public SDK and must build and
 * test with ZERO private imports. Every import specifier in both packages' `src/` must be relative
 * and stay inside its own package, a `node:` builtin, or an allowlisted public dependency; each
 * package.json may declare only allowlisted dependencies.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = {
  sdk: resolve(HERE, ".."),
  "device-contracts": resolve(HERE, "../../device-contracts"),
};
const ALLOWED_DEPS = new Set(["@dopl/device-contracts", "@modelcontextprotocol/sdk", "zod"]);
const ALLOWED_SPECIFIER = /^(node:|vitest(\/|$)|zod(\/|$)|@modelcontextprotocol\/sdk(\/|$)|@dopl\/device-contracts$)/;
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

describe("public SDK packages are standalone", () => {
  for (const [name, root] of Object.entries(PACKAGES)) {
    it(`${name}: every import is internal, node:, or an allowlisted public dep`, () => {
      const files = tsFiles(join(root, "src"));
      expect(files.length).toBeGreaterThan(0);
      const bad: string[] = [];
      for (const file of files) {
        for (const m of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
          const spec = m[1] ?? m[2];
          const where = `${relative(root, file)}: ${spec}`;
          if (spec.startsWith(".")) {
            const target = resolve(dirname(file), spec);
            if (target !== root && !target.startsWith(root + sep)) bad.push(where);
          } else if (!ALLOWED_SPECIFIER.test(spec)) {
            bad.push(where);
          }
        }
      }
      expect(bad).toEqual([]);
    });

    it(`${name}: package.json declares only allowlisted dependencies`, () => {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
      expect(deps.filter((d) => !ALLOWED_DEPS.has(d))).toEqual([]);
    });
  }
});
