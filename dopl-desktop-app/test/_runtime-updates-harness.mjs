// Shared fixtures for `runtime-updates*.test.mjs`: a real npm-shaped tarball, a stubbed registry, a stubbed
// `codesign` / `--version` runner (real `tar`), and a temp `runtimes/` tree per case. Not a test file.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
export const require = createRequire(import.meta.url);
export const MAIN = join(HERE, "..", "main");
export const updates = require(join(MAIN, "runtime", "updates", "index.js"));
export const verify = require(join(MAIN, "runtime", "updates", "verify.js"));

export const TEAM = "TEAMID1234";
export const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);

/** A real npm-shaped tarball (`package/fake`, a Mach-O-magic file) and its registry integrity. */
export function tarball(dir, version) {
  const src = mkdtempSync(join(dir, "src-"));
  mkdirSync(join(src, "package"));
  writeFileSync(join(src, "package", "fake"), Buffer.concat([MACHO, Buffer.from(version)]), { mode: 0o755 });
  writeFileSync(join(src, "package", "README.md"), "not a binary");
  const tgz = join(dir, `fake-${version}.tgz`);
  execFileSync("/usr/bin/tar", ["-czf", tgz, "-C", src, "package"]);
  const bytes = readFileSync(tgz);
  return { bytes, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

/** The registry: `published` is the version the dist-tag names; `tamper` serves other bytes. */
export function registry(dir, published, opts = {}) {
  const pkg = tarball(dir, published);
  const calls = { meta: 0, tarball: 0 };
  const fetchImpl = async (url) => {
    if (url.endsWith(".tgz")) {
      calls.tarball += 1;
      return new Response(opts.tamper ? Buffer.from("tampered") : pkg.bytes);
    }
    calls.meta += 1;
    return Response.json({
      version: published,
      dist: { tarball: `https://registry.npmjs.org/fake/-/fake-${published}.tgz`, integrity: pkg.integrity },
    });
  };
  return { fetchImpl, calls };
}

/** `codesign` and `--version` stubbed; `tar` real. `log` records every codesign call. */
export function runner(opts = {}) {
  const log = [];
  const run = async (file, args) => {
    if (file === "/usr/bin/tar") {
      try { execFileSync(file, args); return { code: 0, stdout: "" }; } catch (_) { return { code: 1, stdout: "" }; }
    }
    if (file === "/usr/bin/codesign") {
      log.push(args);
      return { code: opts.unsigned ? 3 : 0, stdout: "" };
    }
    return opts.mute ? { code: 1, stdout: "" } : { code: 0, stdout: "1.2.3 (Fake)\n" };
  };
  return { run, log };
}

export function source(over = {}) {
  return {
    id: "fake",
    pkg: "fake",
    tag: "latest",
    versionOf: (v) => v,
    bundledVersion: () => "0.3.9",
    binary: (root) => join(root, "fake"),
    teamId: TEAM,
    // The candidate's own protocol description (`sdk-shape.js` Shape); covers `REQUIRED` below by default.
    probeShape: async () => ({ methods: ["thread/start"], notifications: { "turn/completed": ["params.turn.id"] } }),
    ...over,
  };
}

/** What the adapter under test declares it reads (`descriptor.requiredShape`). */
export const REQUIRED = Object.freeze({
  safety: { methods: ["thread/start"] },
  core: { notifications: { "turn/completed": ["params.turn.id"] } },
  cosmetic: { results: { "model/list": ["data.displayName"] } },
});

export const h = { base: null, invalidated: [], diags: [] };
export function setup(reg, run, over = {}) {
  h.base = mkdtempSync(join(tmpdir(), "dopl-runtime-updates-"));
  h.invalidated = [];
  h.diags = [];
  updates.inject({
    log: (...args) => h.diags.push(args.join(" ")),
    baseDir: () => join(h.base, "runtimes"),
    fetchImpl: reg.fetchImpl,
    run: run.run,
    invalidate: (id) => h.invalidated.push(id),
    runningExecutables: async () => [],
    requiredShape: () => REQUIRED,
    ...over,
  });
}
export const record = (id = "fake") => JSON.parse(readFileSync(join(h.base, "runtimes", id, "active.json"), "utf8"));
export const entries = (id = "fake") => readdirSync(join(h.base, "runtimes", id)).sort();
