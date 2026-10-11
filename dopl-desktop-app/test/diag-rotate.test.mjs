// main/diag.js — listener.log past ~1MB ROTATES to listener.log.1 instead of being truncated,
// so the newest diagnostics history survives one wrap (KB dopl-development "Silent Agent Drops
// 2026-10-11"). Drives the real module over a temp userData dir.
//
// Run: `node --test dopl-desktop-app/test/diag-rotate.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWithStubs } from "./helpers/module-sandbox.mjs";

const CAP = 1_000_000;

function setup(fsImpl = fs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dopl-diag-"));
  const { diag } = loadWithStubs("diag.js", {
    fs: fsImpl,
    path,
    electron: { app: { getPath: (name) => (name === "userData" ? dir : assert.fail(name)) } },
  });
  const log = path.join(dir, "listener.log");
  return { dir, diag, log, prior: log + ".1" };
}

// Fill the log past the cap with a recognizable tail, then write once more.
function overfill(log) {
  const filler = "x".repeat(CAP) + "\n";
  fs.writeFileSync(log, filler + "OLD-TAIL-LINE\n");
  // Control: the write really crossed the cap, so the branch under test is the one taken.
  assert.ok(fs.statSync(log).size > CAP, "control: the log must start above the cap");
}

test("a write past the cap keeps the old log as listener.log.1 and starts a fresh file", () => {
  const { diag, log, prior } = setup();
  overfill(log);
  diag("NEW-LINE", "after-wrap");

  assert.ok(fs.existsSync(prior), "the previous log must survive as listener.log.1");
  assert.match(fs.readFileSync(prior, "utf8"), /OLD-TAIL-LINE\n$/, "the old tail is kept");
  const fresh = fs.readFileSync(log, "utf8");
  assert.match(fresh, /NEW-LINE after-wrap\n$/);
  assert.ok(fresh.length < 200, "the live log restarts small");
  assert.doesNotMatch(fresh, /OLD-TAIL-LINE/);
});

test("a second wrap overwrites the prior .1 (at most one prior file kept)", () => {
  const { diag, log, prior } = setup();
  fs.writeFileSync(prior, "ANCIENT\n");
  overfill(log);
  diag("again");
  const kept = fs.readFileSync(prior, "utf8");
  assert.doesNotMatch(kept, /ANCIENT/);
  assert.match(kept, /OLD-TAIL-LINE\n$/);
});

test("under the cap nothing rotates", () => {
  const { diag, log, prior } = setup();
  diag("one");
  diag("two");
  assert.equal(fs.existsSync(prior), false);
  assert.match(fs.readFileSync(log, "utf8"), /one\n.*two\n$/s);
});

test("a failed rename falls back to truncation and never throws", () => {
  const broken = { ...fs, renameSync: () => { throw new Error("EPERM"); } };
  const { diag, log, prior } = setup(broken);
  overfill(log);
  assert.doesNotThrow(() => diag("after-failed-rename"));
  assert.equal(fs.existsSync(prior), false);
  const fresh = fs.readFileSync(log, "utf8");
  assert.ok(fresh.length < 200, "the log is still bounded");
  assert.match(fresh, /after-failed-rename\n$/);
});
