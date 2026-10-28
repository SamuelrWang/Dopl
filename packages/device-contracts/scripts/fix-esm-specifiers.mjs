#!/usr/bin/env node
/**
 * Post-build: append `.js` to extensionless relative specifiers in emitted `.js` and `.d.ts`.
 * Source stays extensionless (the Next app bundles it from source; Turbopack does not map
 * `./x.js` to `x.ts`), while Node ESM and `node16` type resolution need explicit extensions.
 * Usage: node scripts/fix-esm-specifiers.mjs <dir>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: fix-esm-specifiers.mjs <dir>");
  process.exit(1);
}

const SPEC = /((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']+?)(["'])/g;

function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js") || p.endsWith(".d.ts")) {
      const src = readFileSync(p, "utf8");
      const out = src.replace(SPEC, (m, pre, spec, post) => (/\.(c|m)?js$/.test(spec) ? m : `${pre}${spec}.js${post}`));
      if (out !== src) writeFileSync(p, out);
    }
  }
}
walk(dir);
