// WHEN THE APP LOOKS — the update-discovery cadence (2026-08-22, Samuel's ruling).
//
// ⚠ SPLIT OUT OF `update-restart-prompt.test.mjs` at the 500-line cap `test/**` is linted under,
// and the seam is SUBJECT rather than arithmetic: that suite is about what happens once a
// download lands (the note, the banner, the dialog, `quitAndInstall`), this one is about when the
// question is asked at all. They share `_updater-harness.mjs`, so both drive one program.
//
// THE COMPLAINT. A release published while the app was open went unnoticed for hours, and the
// operator's workaround was to QUIT AND REOPEN Dopl to force the boot check. **An app that has to
// be restarted for its updater to work is the feature failing at its one job.**
//
// TWO CHANGES, and the interval is the SMALLER one. It dropped 4h → 30m as a backstop for an app
// nobody is looking at; the FOCUS CHECK is what makes discovery near-immediate, because the app
// now looks whenever the operator does. The gap's whole truth table lives in
// update-policy.test.mjs (it is pure); this is the wiring.
//
// Run: `node --test dopl-desktop-app/test/update-focus-check.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./_updater-harness.mjs";

// ── The interval: the backstop ──────────────────────────────────────────────

// ⚠ THIS CASE ASSERTED 4h UNTIL 2026-08-22. The interval is the backstop for an app nobody is
// looking at; the focus check below is what makes discovery near-immediate. Neither replaces the
// other, and tuning this number is not a substitute for the focus path.
test("with no override the production interval is 30 minutes", () => {
  const h = harness();
  assert.equal(h.seen.intervalMs, 30 * 60 * 1000);
});

test("DOPL_UPDATE_CHECK_MS is READ, so a publish loop can look every couple of minutes", () => {
  assert.equal(harness({ interval: 120_000 }).seen.intervalMs, 120_000);
});

test("…and CLAMPED, so `=5` is 60s rather than a hot loop against the feed", () => {
  assert.equal(harness({ interval: 5 }).seen.intervalMs, 60_000);
  assert.equal(harness({ interval: "soon" }).seen.intervalMs, 30 * 60 * 1000);
});

// ── UPDATE DISCOVERY LATENCY: the focus check (2026-08-22, Samuel's ruling) ──
//
// THE COMPLAINT. A release published while the app is open went unnoticed for hours, and the
// operator's workaround was to QUIT AND REOPEN Dopl to force the boot check. An app that has to
// be restarted for its updater to work is the feature failing at its one job.
//
// TWO CHANGES, and the interval is the smaller one: it dropped 4h → 30m as a backstop for an app
// nobody is looking at, while the FOCUS CHECK is what makes discovery near-immediate — the app
// looks whenever the operator does. The gap's truth table lives in update-policy.test.mjs; this
// is the wiring, driven against the real module.

test("FOCUS: the updater arms BOTH app-level signals, and nothing per-window", () => {
  // ⚠ APP-LEVEL, DELIBERATELY. `browser-window-focus` covers the SPA shell, the pop-out, the
  // agent window and the update screen at once — a per-window `win.on('focus')` would be the
  // same event plus a registration to keep in sync with `app-windows.js`, and the F-228 sweep is
  // the record of what happens when one of those is missed. `activate` is the macOS bring-forward
  // (a dock click, or a cmd-tab into a run that has no focused window yet).
  const h = harness();
  assert.deepEqual(h.seen.appEvents.sort(), ["activate", "browser-window-focus"]);
});

test("FOCUS: an unpackaged run arms nothing — there is no updater to check with", () => {
  const h = harness({ packaged: false });
  assert.deepEqual(h.seen.appEvents, []);
  assert.equal(h.updater.checkOnFocus(), false, "…and the call itself is a silent no-op");
});

test("FOCUS: focusing INSIDE the gap asks nothing (the boot check just ran)", () => {
  // `init()` issues a check immediately, which stamps the gap. Every focus event in the next ten
  // minutes must cost nothing — this is the case that stops cmd-tab from becoming a request loop.
  const h = harness();
  assert.equal(h.seen.checks, 1, "the boot check");
  for (let i = 0; i < 20; i += 1) {
    h.emitApp("browser-window-focus");
    h.emitApp("activate");
  }
  assert.equal(h.seen.checks, 1, "twenty focus events, zero extra requests");
});

test("FOCUS: past the gap, focusing DOES ask — that is the whole feature", () => {
  const h = harness();
  h.autoUpdater.emit("update-not-available");
  const before = h.seen.checks;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000; // eleven minutes on
    assert.equal(h.updater.checkOnFocus(), true, "it reports that it issued one");
  } finally {
    Date.now = realNow;
  }
  assert.equal(h.seen.checks, before + 1);
});

test("FOCUS: it is NOT a manual check — a no-op says nothing to the operator", () => {
  // ⚠ THE OPERATOR DID NOT ASK A QUESTION, so nothing may answer one. A manual check reports
  // every outcome (that is what stops the tray button reading as dead); a focus check is
  // ambient and must not push notes for states the operator never enquired about.
  const h = harness();
  h.autoUpdater.emit("update-not-available");
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000;
    // A download in flight: a manual check would note "Downloading…"; this must not.
    h.autoUpdater.emit("update-available", { version: "9.9.9" });
    const notesBefore = h.noteTexts().length;
    assert.equal(h.updater.checkOnFocus(), false, "mid-download is a no-op");
    assert.equal(h.noteTexts().length, notesBefore, "and a silent one");
  } finally {
    Date.now = realNow;
  }
});

test("FOCUS: a STAGED update is left alone — no re-check, no prompt, no second dialog", () => {
  // ⚠ A manual check on a staged update goes straight to the restart PROMPT (an explicit ask
  // deserves the action). A focus check must not: the operator merely looked at the app, and a
  // modal thrown over that is the interruption the whole restart design avoids.
  const h = harness();
  h.autoUpdater.emit("update-downloaded", { version: "2.0.0" });
  const dialogsBefore = h.seen.dialogs.length;
  const checksBefore = h.seen.checks;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(h.updater.checkOnFocus(), false);
  } finally {
    Date.now = realNow;
  }
  assert.equal(h.seen.checks, checksBefore, "nothing re-asked");
  assert.equal(h.seen.dialogs.length, dialogsBefore, "and no extra dialog");
});

test("FOCUS: the gap is SHARED with the interval — one stamp, both paths", () => {
  // A focus a second after a scheduled sweep must ask nothing, and a scheduled sweep must not
  // reset the operator's gap either. `updater.js` stamps ONE `lastCheckAt` from both.
  const h = harness();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(h.updater.checkOnFocus(), true, "past the gap: this one asks");
    assert.equal(h.updater.checkOnFocus(), false, "…and immediately re-stamps it");
  } finally {
    Date.now = realNow;
  }
});
