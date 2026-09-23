// EVERY `require('<literal>')` IN main/ RESOLVES (P4-01 / P3-01).
//
// The desktop suites mostly slice source and inject its dependencies, so a module is rarely loaded
// the way Node loads it. Two classes shipped green that way: a relative require of a deleted file
// (`./sdk-loader`, reached only inside a try/catch that turned the throw into "no runtime"), and a
// free variable the module never required (lint's `no-undef` covers that one). This resolves every
// literal require path statically, lazy ones included, so a dead path fails here instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const MAIN = join(APP, "main");
const require_ = createRequire(import.meta.url);
const PKG = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));

// Packaged with the app: `dependencies` only (electron-builder drops devDependencies), plus
// electron itself, which the runtime provides.
const PACKAGED = new Set([...Object.keys(PKG.dependencies || {}), "electron"]);
// A bare package main/ may require although it is not packaged, because the require is guarded
// and a throw is the designed answer ("not bundled"). Each entry names where and why.
const OPTIONAL_PACKAGES = new Map([
  ["undici", "main/api.js › a fresh dispatcher when undici is present; falls back without it"],
]);
// Relative paths known dead on this branch and owned by another fix. Keyed by file + specifier so
// an entry can never excuse a different require. Delete an entry when its fix lands.
const KNOWN_DEAD = new Map([
  ["main/claude-runtime.js ./sdk-loader", "P3-01 (deleted module; the fix asks the runtime registry)"],
  ["main/claude-signin-op.js ./sdk-loader", "P3-01"],
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** Literal require specifiers in code (a match on a comment line, or after `//` on its line, is skipped). */
function literalRequires(src) {
  const out = [];
  const re = /require\(\s*(['"])([^'"\n]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const before = src.slice(lineStart, m.index);
    const trimmed = before.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (/(^|\s)\/\/\s/.test(before)) continue;
    out.push({ spec: m[2], line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

const FILES = walk(MAIN);

test("the scan sees main/ (a scan of nothing proves nothing)", () => {
  assert.ok(FILES.length > 100, `only ${FILES.length} files under main/`);
  const total = FILES.reduce((n, f) => n + literalRequires(readFileSync(f, "utf8")).length, 0);
  assert.ok(total > 500, `only ${total} literal requires found`);
});

test("every relative require in main/ resolves to a file that exists", (t) => {
  const dead = [];
  const seenKnown = new Set();
  for (const file of FILES) {
    const rel = relative(APP, file).split("\\").join("/");
    for (const { spec, line } of literalRequires(readFileSync(file, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      try {
        require_.resolve(join(dirname(file), spec));
      } catch (_) {
        const key = `${rel} ${spec}`;
        if (KNOWN_DEAD.has(key)) { seenKnown.add(key); continue; }
        dead.push(`${rel}:${line} require('${spec}')`);
      }
    }
  }
  for (const key of KNOWN_DEAD.keys()) {
    if (!seenKnown.has(key)) t.diagnostic(`KNOWN_DEAD entry no longer needed — delete it: ${key}`);
  }
  assert.deepEqual(dead, [], "dead require paths in main/");
});

test("every bare require in main/ is a Node builtin or a packaged dependency", () => {
  const bad = [];
  for (const file of FILES) {
    const rel = relative(APP, file).split("\\").join("/");
    for (const { spec, line } of literalRequires(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) continue;
      const bare = spec.replace(/^node:/, "");
      if (builtinModules.includes(bare) || builtinModules.includes(bare.split("/")[0])) continue;
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (PACKAGED.has(pkg) || OPTIONAL_PACKAGES.has(pkg)) continue;
      bad.push(`${rel}:${line} require('${spec}')`);
    }
  }
  assert.deepEqual(bad, [], "requires of packages the packaged app does not ship");
});
