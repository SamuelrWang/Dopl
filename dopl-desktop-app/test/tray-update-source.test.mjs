// TWO DEAD EXPORTS NEXT TO THE BUG THEY WERE WRITTEN FOR (2026-07-31).
//
// `updater.isUpdateReady()` / `updater.updateReadyVersion()` were added so the
// "an update is staged" fact could be ASKED FOR rather than only pushed by the
// one-shot `update-downloaded` event. Nothing ever called them: tray.js kept its
// own module-local copy fed exclusively by that event, so the menu could answer
// the question only for a tray that already existed when the download landed.
//
// index.js happens to call `tray.create()` before `updater.init()`, which is the
// single ordering under which the event-only path works, and nothing pinned it.
// Reorder those two lines — or rebuild the tray after a download — and the
// restart item silently disappears while a staged build sits there. That is the
// Q10 failure verbatim: a Mac running a build nobody believes it is running.
//
// So the tray now READS the updater on every menu rebuild and keeps the event
// echo as the fallback. This file pins the read (so the exports cannot go dead
// again) and drives refreshUpdateReady over the orderings that used to matter.
//
// Run: `node --test dopl-desktop-app/test/tray-update-source.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const TRAY = M("tray.js");
const UPDATER = M("updater.js");

// refreshUpdateReady mutates the module-local `updateReadyVersion`, so the slice is
// driven with that binding as a free variable — the value in / value out is the
// whole contract.
function refresh({ updater, echo = null }) {
  return new Function(
    "require", "updateReadyVersion",
    `${fnOf(TRAY, "refreshUpdateReady")}\n refreshUpdateReady();\n return updateReadyVersion;`
  )((id) => {
    if (id === "./updater" && updater) return updater;
    throw new Error(`unexpected require(${id})`);
  }, echo);
}

// ── the exports are alive ───────────────────────────────────────────────────

test("the tray reads the updater's OWN state, not only the event echo", () => {
  const fn = fnOf(TRAY, "refreshUpdateReady");
  assert.match(fn, /require\('\.\/updater'\)/);
  assert.match(fn, /updater\.isUpdateReady\(\)/, "the predicate that was dead code");
  assert.match(fn, /updater\.updateReadyVersion\(\)/, "…and the accessor beside it");
  assert.match(UPDATER, /module\.exports = \{[^}]*\bisUpdateReady\b[^}]*\}/, "still exported");
  assert.match(UPDATER, /module\.exports = \{[^}]*\bupdateReadyVersion\b[^}]*\}/, "…and so is the accessor");
});

test("the rebuild is where it is read — not once at create() time", () => {
  // `readyVersion` is set by an event we do not control, so a one-shot read at
  // tray-create would reproduce the ordering dependency in the other direction.
  assert.match(fnOf(TRAY, "buildMenu"), /^\s*refreshUpdateReady\(\);/m);
});

// ── the orderings ───────────────────────────────────────────────────────────

const staged = (v) => ({ isUpdateReady: () => true, updateReadyVersion: () => v });
const idle = { isUpdateReady: () => false, updateReadyVersion: () => null };

test("a tray built AFTER the download still finds the staged version", () => {
  // The bug: no `onReady` echo ever reached this tray, because the event fired
  // before it existed. The updater still knows.
  assert.equal(refresh({ updater: staged("1.7.16"), echo: null }), "1.7.16");
});

test("a tray built BEFORE the download is unchanged — the event path still works", () => {
  assert.equal(refresh({ updater: idle, echo: "1.7.16" }), "1.7.16", "the echo survives");
  assert.equal(refresh({ updater: idle, echo: null }), null, "and nothing is invented");
});

test("the updater WINS when the two disagree — it owns the fact", () => {
  assert.equal(refresh({ updater: staged("1.7.17"), echo: "1.7.16" }), "1.7.17");
});

test("no updater in this process (harness) degrades to the echo, never a throw", () => {
  assert.equal(refresh({ updater: null, echo: "1.7.16" }), "1.7.16");
  assert.equal(refresh({ updater: null, echo: null }), null);
});

test("an updater that reports ready with no version cannot blank a real echo", () => {
  // isUpdateReady() is `!!readyVersion`, so this pair is unreachable in practice;
  // the guard exists so a future updater change cannot erase the visible item.
  const weird = { isUpdateReady: () => true, updateReadyVersion: () => null };
  assert.equal(refresh({ updater: weird, echo: "1.7.16" }), null,
    "documented behaviour: the owner's answer is taken verbatim, blank included");
});
