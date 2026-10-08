// THE SELF-UPDATING RUNTIME — `main/runtime/updates/` and the adapters that read it.
//
// The registry and `codesign` are stubbed; `tar` is real (the package is a real .tgz built here), so the
// unpack and the renames run against a real temp tree. No network, no model turn. The four closed risks
// (prune, Keychain, probe timeouts, copy) are pinned in `runtime-updates-risks.test.mjs`.
//
// Run: `node --test dopl-desktop-app/test/runtime-updates.test.mjs`

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  require, MAIN, updates, verify, TEAM, MACHO, registry, runner, source, h, setup, record, entries, REQUIRED,
} from "./_runtime-updates-harness.mjs";

beforeEach(() => updates.inject());

test("a newer build is unpacked, verified, renamed into place and pointed at; launches move to it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const run = runner();
  setup(registry(dir, "0.3.10"), run);
  const src = source();
  assert.equal(updates.activeFor(src), null, "nothing downloaded: the bundle");
  assert.equal(await updates.check(src), "updated");
  const active = updates.activeFor(src);
  assert.equal(active.version, "0.3.10");
  assert.equal(active.path, join(h.base, "runtimes", "fake", "0.3.10", "fake"));
  assert.deepEqual(record(), { version: "0.3.10", previous: null, rejected: [] });
  assert.deepEqual(entries(), ["0.3.10", "active.json"], "the staging directory is gone");
  assert.deepEqual(h.invalidated, ["fake"], "the roster re-reads");
  // Every Mach-O, and only Mach-O, against the pinned team's Developer ID requirement.
  assert.equal(run.log.length, 1);
  assert.ok(run.log[0].includes("--strict"));
  assert.ok(run.log[0].some((a) => a.startsWith("-R=") && a.includes(`leaf[subject.OU] = "${TEAM}"`)));
});

test("versions compare numerically, and an equal or older build is left alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  for (const published of ["0.3.9", "0.3.8", "0.2.99"]) {
    const reg = registry(dir, published);
    setup(reg, runner());
    assert.equal(await updates.check(source()), "current", published);
    assert.equal(reg.calls.tarball, 0, "nothing is downloaded");
  }
});

test("SHAPE, not version, is the gate: a candidate missing a safety/core item is refused for good", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const reg = registry(dir, "0.4.0");
  setup(reg, runner());
  const src = source({ probeShape: async () => ({ methods: ["thread/start"] }) }); // core notification gone
  assert.equal(await updates.check(src), "incompatible-shape");
  assert.equal(updates.activeFor(src), null, "launches keep the bundle");
  assert.equal(record().rejected.length, 1);
  assert.match(record().rejected[0], /^0\.4\.0#shape:[0-9a-f]{12}$/, "recorded against THIS requirement");
  assert.equal(await updates.check(src), "rejected", "and never downloaded again by this Dopl");
  assert.equal(reg.calls.tarball, 1);
  assert.deepEqual(h.invalidated, []);
  // A Dopl whose requirement CHANGED (relaxed) checks the same build afresh (cross-review M4).
  setup(reg, runner(), { requiredShape: () => ({ safety: { methods: ["thread/start"] } }) });
  assert.equal(await updates.check(src), "updated");
});

test("a cosmetic-only gap does not refuse a build", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  setup(registry(dir, "0.3.10"), runner());
  // The default probe covers safety + core and lacks the cosmetic result field.
  assert.equal(await updates.check(source()), "updated");
});

test("a probe that FAILS is not a verdict: the check fails, nothing is rejected, the next check retries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const reg = registry(dir, "0.3.10");
  setup(reg, runner());
  let calls = 0;
  const src = source({ probeShape: async () => { calls += 1; throw new Error("schema command timed out"); } });
  assert.equal(await updates.check(src), "failed");
  assert.equal(updates.activeFor(src), null);
  assert.deepEqual(entries(), [], "staging discarded, nothing recorded");
  assert.equal(await updates.check(src), "failed", "retried, not remembered as rejected");
  assert.equal(calls, 2);
});

test("SEMANTICS: a candidate that breaks a safety restriction is refused for good (2026-10-08)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const reg = registry(dir, "0.4.0");
  setup(reg, runner());
  const src = source({ verifySemantics: async () => ({ refuse: ["a write ran without asking Dopl's gate"], inconclusive: [] }) });
  assert.equal(await updates.check(src), "incompatible-shape");
  assert.equal(updates.activeFor(src), null, "launches keep what they run");
  assert.deepEqual(record().rejected, ["0.4.0"], "the verdict is the build's: recorded");
  assert.equal(await updates.check(src), "rejected", "and never downloaded again");
});

test("SEMANTICS: an inconclusive probe proves nothing — not admitted, not rejected, retried", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  setup(registry(dir, "0.3.10"), runner());
  let calls = 0;
  const src = source({ verifySemantics: async () => { calls += 1; return { refuse: [], inconclusive: ["the model did not try the Bash tool"] }; } });
  assert.equal(await updates.check(src), "failed");
  assert.equal(updates.activeFor(src), null);
  assert.equal(await updates.check(src), "failed", "retried, not remembered as rejected");
  assert.equal(calls, 2);
});

test("SEMANTICS: a clean probe admits the build", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  setup(registry(dir, "0.3.10"), runner());
  assert.equal(await updates.check(source({ verifySemantics: async () => ({ refuse: [], inconclusive: [] }) })), "updated");
});

test("a source that cannot describe a build, or an adapter that declares nothing, is never auto-updated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const reg = registry(dir, "0.3.10");
  setup(reg, runner());
  assert.equal(await updates.check(source({ probeShape: undefined })), "unsupported");
  setup(reg, runner(), { requiredShape: () => null });
  assert.equal(await updates.check(source()), "unsupported");
  assert.equal(reg.calls.meta + reg.calls.tarball, 0, "not even asked");
});

test("an integrity mismatch keeps what launches run and leaves nothing behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  setup(registry(dir, "0.3.10", { tamper: true }), runner());
  const src = source();
  assert.equal(await updates.check(src), "failed");
  assert.equal(updates.activeFor(src), null);
  assert.deepEqual(entries(), [], "no version, no pointer, no staging");
  assert.deepEqual(h.invalidated, []);
});

test("a signature from any other team, or a CLI that will not run, is discarded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  for (const opts of [{ unsigned: true }, { mute: true }]) {
    setup(registry(dir, "0.3.10"), runner(opts));
    const src = source();
    assert.equal(await updates.check(src), "failed", JSON.stringify(opts));
    assert.equal(updates.activeFor(src), null);
    assert.deepEqual(entries(), []);
  }
});

test("the last good build is kept, older ones are pruned at start, and a rejected build falls back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const run = runner();
  setup(registry(dir, "0.3.10"), run);
  const src = source();
  assert.equal(await updates.check(src), "updated");
  updates.inject({ baseDir: () => join(h.base, "runtimes"), fetchImpl: registry(dir, "0.3.11").fetchImpl, run: run.run, invalidate: (id) => h.invalidated.push(id), runningExecutables: async () => [], requiredShape: () => REQUIRED });
  assert.equal(await updates.check(src), "updated");
  assert.deepEqual(record(), { version: "0.3.11", previous: "0.3.10", rejected: [] });

  // A stray older version and a crashed install's staging directory go at start; active + last good stay.
  mkdirSync(join(h.base, "runtimes", "fake", "0.3.5"));
  mkdirSync(join(h.base, "runtimes", "fake", ".staging-crashed"));
  await updates.start([src]);
  assert.deepEqual(entries(), ["0.3.10", "0.3.11", "active.json"]);

  // Only the ACTIVE download can be rejected; anything else is ignored.
  assert.equal(updates.reject(src, "/somewhere/else/fake"), false);
  const active = updates.activeFor(src);
  assert.equal(updates.reject(src, active.path), true);
  assert.equal(updates.activeFor(src).version, "0.3.10", "back to the last good build");
  assert.deepEqual(record().rejected, ["0.3.11"]);
  // …and the rejected build is never fetched again.
  const again = registry(dir, "0.3.11");
  updates.inject({ baseDir: () => join(h.base, "runtimes"), fetchImpl: again.fetchImpl, run: run.run, invalidate: () => {}, runningExecutables: async () => [], requiredShape: () => REQUIRED });
  assert.equal(await updates.check(src), "rejected");
  assert.equal(again.calls.tarball, 0);

  // Rejecting the last good one too leaves the bundle.
  assert.equal(updates.reject(src, updates.activeFor(src).path), true);
  assert.equal(updates.activeFor(src), null);
});

test("the bundle is the floor: a download no newer than it is never used", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  setup(registry(dir, "0.3.10"), runner());
  assert.equal(await updates.check(source()), "updated");
  // A Dopl release that ships 0.3.10 or later outranks the download with no cleanup step.
  assert.equal(updates.activeFor(source({ bundledVersion: () => "0.3.10" })), null);
  assert.equal(updates.activeFor(source({ bundledVersion: () => "0.3.12" })), null);
  assert.equal(updates.activeFor(source({ pkg: null })), null, "an unsupported platform always runs its bundle");
});

test("checkNow joins a check already running for the same runtime", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const reg = registry(dir, "0.3.10");
  setup(reg, runner());
  updates.start([source()]);
  const [a, b] = await Promise.all([updates.checkNow("fake"), updates.checkNow("fake")]);
  assert.equal(a, "updated");
  assert.equal(b, "updated");
  assert.equal(reg.calls.meta, 1);
  assert.equal(await updates.checkNow("unknown"), "unsupported");
});

test("resolveClaudeExecutable runs a newer verified download, else the bundle", () => {
  const loader = require(join(MAIN, "runtime", "claude", "loader.js"));
  const bundled = loader.bundledClaude();
  if (!bundled) {
    console.log("      ℹ no bundled Claude platform package here — case skipped");
    return;
  }
  h.base = mkdtempSync(join(tmpdir(), "dopl-runtime-updates-"));
  updates.inject({ baseDir: () => join(h.base, "runtimes") });
  const [major, minor, patch] = bundled.version.split(".").map(Number);
  const plant = (version) => {
    updates.inject({ baseDir: () => join(h.base, "runtimes") }); // drop the read-once cache
    mkdirSync(join(h.base, "runtimes", "claude", version), { recursive: true });
    writeFileSync(join(h.base, "runtimes", "claude", version, "claude"), MACHO);
    writeFileSync(join(h.base, "runtimes", "claude", "active.json"), JSON.stringify({ version, previous: null, rejected: [] }));
  };
  assert.equal(loader.resolveClaudeExecutable(), bundled.path);
  const newer = `${major}.${minor}.${patch + 1}`;
  plant(newer);
  assert.equal(loader.resolveClaudeExecutable(), join(h.base, "runtimes", "claude", newer, "claude"));
  assert.equal(loader.claudeRuntime().version, newer, "the roster key's version is the ACTIVE binary's");
  plant(`${major}.${minor}.${patch - 1}`);
  assert.equal(loader.resolveClaudeExecutable(), bundled.path);
});

test("codex: a verified download outranks the bundle, and a refused one falls back to it", () => {
  const resolver = require(join(MAIN, "runtime", "codex", "resolve-bin.js"));
  const root = mkdtempSync(join(tmpdir(), "dopl-codex-"));
  const pkgJson = join(root, "bundle", "package.json");
  const bundledBin = join(root, "bundle", "vendor", "aarch64-apple-darwin", "bin", "codex");
  const downloaded = join(root, "runtimes", "codex", "9.9.9", "vendor", "aarch64-apple-darwin", "bin", "codex");
  for (const bin of [bundledBin, downloaded]) {
    mkdirSync(dirname(bin), { recursive: true });
    writeFileSync(bin, MACHO, { mode: 0o755 });
  }
  const resolve = (extra) => resolver.resolveWith({
    env: { PATH: "" }, home: root, io: { realpathSync, statSync, accessSync }, uid: process.getuid(),
    platform: "darwin", arch: "arm64", resolvePackage: () => pkgJson, ...extra,
  });
  const picked = resolve({ downloaded });
  assert.equal(picked.source, "downloaded", picked.reason);
  assert.equal(picked.path, realpathSync(downloaded));
  assert.equal(resolve({ downloaded: null }).source, "bundled");
  // Walked like every other candidate: a tree others can write to is refused, and the bundle answers.
  chmodSync(dirname(downloaded), 0o777);
  const refused = resolve({ downloaded });
  assert.equal(refused.source, "bundled");
  assert.equal(refused.rejected[0].path, downloaded);
});

test("the codex source strips the platform suffix the vendor versions its builds with", () => {
  const codex = require(join(MAIN, "runtime", "codex", "update-source.js"));
  assert.equal(codex.versionOf(`0.159.3-${process.platform}-${process.arch}`), "0.159.3");
  assert.equal(codex.compatible, undefined, "no version range: the shape gate decides");
});

test("verify finds every Mach-O and refuses a symlink in the package", () => {
  const root = mkdtempSync(join(tmpdir(), "dopl-verify-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "cli"), MACHO);
  writeFileSync(join(root, "notes.txt"), "text");
  assert.deepEqual(verify.machOFiles(root), [join(root, "bin", "cli")]);
  execFileSync("/bin/ln", ["-s", "/bin/sh", join(root, "bin", "sh")]);
  assert.throws(() => verify.machOFiles(root), /symlink/);
});

// ── THE OUTDATED-RUNTIME ERROR ─────────────────────────────────────────────────────────────────

const OUTDATED_TEXT = "API Error: 400 Claude Code 2.1.220 does not support this model; version 2.1.251 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.";
const assistantMsg = (text, error) => ({
  type: "assistant",
  parent_tool_use_id: null,
  ...(error ? { error } : {}),
  message: { content: [{ type: "text", text }] },
});

test("the CLI's outdated-model refusal becomes one runtime_outdated event, and only when the CLI flagged it", () => {
  // A verified session (2026-10-08: nothing renders before the launch contract checks out).
  const claude = require(join(MAIN, "runtime", "claude", "normalize.js"));
  const normalize = (msg) => claude.normalize(msg, { launchContract: false });
  assert.deepEqual(normalize(assistantMsg(OUTDATED_TEXT, "invalid_request")), [{ type: "runtime_outdated" }]);
  // A reply that merely QUOTES the sentence is content, and renders as content.
  const quoted = normalize(assistantMsg(OUTDATED_TEXT));
  assert.equal(quoted[0].type, "assistant");
  assert.equal(quoted[0].payload.text, OUTDATED_TEXT);
  // Another API error is not this one.
  assert.equal(normalize(assistantMsg("API Error: 500 overloaded", "server_error"))[0].type, "assistant");
});

test("core answers runtime_outdated with an update check and Dopl's own sentence", async () => {
  const io = require(join(MAIN, "session-io.js"));
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const reg = registry(dir, "0.3.10");
  setup(reg, runner());
  updates.start([source({ id: "claude" })]);
  const sent = [];
  const out = io.applyCoreEvents({ runtimeId: "claude" }, [{ type: "runtime_outdated" }], (_s, ev) => sent.push(ev), {});
  assert.equal(out, null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "assistant");
  const text = sent[0].payload.text;
  assert.match(text, /^.+ is out of date for this model\. Relaunch the agent\.$/);
  assert.doesNotMatch(text, /claude update|desktop app|in a minute/i);
  assert.equal(await updates.checkNow("claude"), "updated", "the check it started is the one joined here");
  assert.equal(reg.calls.meta, 1);
  assert.equal(updates.lastOutcome("claude"), "updated");
});
