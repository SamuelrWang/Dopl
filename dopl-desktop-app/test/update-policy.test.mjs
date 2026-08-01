// 2026-08-01 — the update policy: how often we look, what the tray says, and the
// exact words of the restart prompt.
//
// THE COMPLAINT. "After a new version is published, closing and reopening the app
// usually does NOT get the new build. It takes several tries over a few minutes."
// Nothing is flaky. autoDownload + autoInstallOnAppQuit make the cycle START
// (download ~200MB) → QUIT (install) → START (new build), so ONE close-and-reopen
// can never suffice, and quitting mid-download throws the partial copy away —
// which is the "several tries" verbatim. On top of that the check interval is 4h,
// so an app that was already running when you published does not even look.
//
// main/update-policy.js is deliberately pure (no electron, no timers, no I/O), so
// every one of those decisions is a truth table here rather than a click test.
// The wiring that consumes them is pinned in update-restart-prompt.test.mjs.
//
// Run: `node --test dopl-desktop-app/test/update-policy.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const policy = require(join(HERE, "..", "main", "update-policy.js"));

const {
  DEFAULT_CHECK_INTERVAL_MS,
  MIN_CHECK_INTERVAL_MS,
  MAX_CHECK_INTERVAL_MS,
  RESTART_BUTTON_INDEX,
  resolveCheckIntervalMs,
  progressPercent,
  progressLabel,
  checkNote,
  liveSessionSummary,
  restartPrompt,
  isRestartChoice,
  downloadedNotification,
} = policy;

// ── The interval, and its clamp ─────────────────────────────────────────────

test("production keeps the 4h default when nothing overrides it", () => {
  assert.equal(DEFAULT_CHECK_INTERVAL_MS, 4 * 60 * 60 * 1000);
  for (const nothing of [undefined, null, "", "   "]) {
    assert.equal(resolveCheckIntervalMs(nothing), DEFAULT_CHECK_INTERVAL_MS, String(nothing));
  }
});

test("an override IS read (that is the whole point of the fast loop)", () => {
  assert.equal(resolveCheckIntervalMs("120000"), 120_000, "2 minutes, as a string from env");
  assert.equal(resolveCheckIntervalMs(300_000), 300_000, "…and as a number");
  assert.equal(resolveCheckIntervalMs("90000.7"), 90_001, "rounded, never fractional ms");
});

test("the clamp is what keeps a typo off GitHub's rate limiter", () => {
  // `DOPL_UPDATE_CHECK_MS=5` reads as "5 minutes" to a human and would be a 5ms
  // hot loop against the release feed. The floor turns it into 60s.
  assert.equal(resolveCheckIntervalMs("5"), MIN_CHECK_INTERVAL_MS);
  assert.equal(resolveCheckIntervalMs(1), MIN_CHECK_INTERVAL_MS);
  assert.equal(resolveCheckIntervalMs(MIN_CHECK_INTERVAL_MS), MIN_CHECK_INTERVAL_MS, "exact floor");
  assert.equal(resolveCheckIntervalMs(MIN_CHECK_INTERVAL_MS + 1), MIN_CHECK_INTERVAL_MS + 1);
  assert.equal(MIN_CHECK_INTERVAL_MS, 60_000);
  // …and a runaway value cannot park the check a month out.
  assert.equal(resolveCheckIntervalMs(999_999_999_999), MAX_CHECK_INTERVAL_MS);
});

test("garbage falls back to the DEFAULT, never to zero", () => {
  // A zero would arm setInterval(fn, 0): the same hot loop by another route.
  for (const junk of ["soon", "0", 0, -1, "-5000", NaN, Infinity, {}, []]) {
    assert.equal(
      resolveCheckIntervalMs(junk),
      DEFAULT_CHECK_INTERVAL_MS,
      `${JSON.stringify(String(junk))} must not become an interval`
    );
  }
});

test("an explicit fallback is honoured, and a bad fallback still degrades to 4h", () => {
  assert.equal(resolveCheckIntervalMs(undefined, 7_000), 7_000);
  assert.equal(resolveCheckIntervalMs(undefined, 0), DEFAULT_CHECK_INTERVAL_MS);
});

// ── Download progress ───────────────────────────────────────────────────────

test("percent comes off the event, and a missing one falls back to the bytes", () => {
  assert.equal(progressPercent({ percent: 43.9 }), 43, "floored, never rounded up past reality");
  assert.equal(progressPercent({ percent: 0 }), 0);
  assert.equal(progressPercent({ percent: 137 }), 100, "clamped");
  assert.equal(progressPercent({ percent: -4 }), 0);
  assert.equal(progressPercent({ transferred: 50, total: 200 }), 25);
  assert.equal(progressPercent({ transferred: 5, total: 0 }), null, "no divide by zero");
  assert.equal(progressPercent(null), null);
  assert.equal(progressPercent({}), null, "unknown stays unknown, never a fake 0%");
});

test("the progress line is the difference between 'working' and 'hung'", () => {
  assert.equal(progressLabel(43), "Downloading update… 43%");
  assert.equal(progressLabel(0), "Downloading update… 0%");
  assert.equal(progressLabel(null), "Downloading update…", "unknown amount, still moving");
  assert.equal(checkNote("downloading", { percent: 43 }).text, "Downloading update… 43%");
  assert.equal(checkNote("downloading", { percent: 43 }).busy, true);
});

// ── The manual check reports EVERY outcome ──────────────────────────────────

test("every outcome of a manual check has a line, so the click is never a no-op", () => {
  assert.deepEqual(checkNote("checking"), { text: "Checking for updates…", busy: true });
  assert.deepEqual(checkNote("up-to-date", { version: "1.7.18" }), {
    text: "Up to date (v1.7.18)",
    busy: false,
  });
  assert.deepEqual(checkNote("downloading", { version: "1.7.19" }), {
    text: "Downloading v1.7.19…",
    busy: true,
  });
  assert.deepEqual(checkNote("ready", { version: "1.7.19" }), {
    text: "Update ready: v1.7.19",
    busy: false,
  });
  assert.deepEqual(checkNote("unsupported"), { text: "Updates are off in this build", busy: false });
  assert.deepEqual(checkNote("idle"), { text: "", busy: false }, "and a way to clear the line");
});

test("a FAILED manual check says so — the one thing the silent handler must not eat", () => {
  const withMessage = checkNote("error", { message: "net::ERR_INTERNET_DISCONNECTED" });
  assert.equal(withMessage.text, "Update check failed: net::ERR_INTERNET_DISCONNECTED");
  assert.equal(withMessage.busy, false, "a failure must release the button, not wedge it");
  assert.match(checkNote("error").text, /^Update check failed\./, "…even with no message");
  assert.match(checkNote("error").text, /try again/);
});

test("busy is only ever true while something is actually in flight", () => {
  for (const settled of ["up-to-date", "ready", "error", "unsupported", "idle"]) {
    assert.equal(checkNote(settled).busy, false, settled);
  }
  for (const inFlight of ["checking", "downloading"]) {
    assert.equal(checkNote(inFlight).busy, true, inFlight);
  }
});

// ── Live sessions ───────────────────────────────────────────────────────────

test("no live session: nothing to warn about", () => {
  assert.equal(liveSessionSummary([]), "");
  assert.equal(liveSessionSummary(null), "");
  assert.equal(liveSessionSummary(undefined), "");
});

test("a live session is NAMED, because restarting kills it mid turn", () => {
  assert.equal(
    liveSessionSummary([{ channelName: "Design" }]),
    "1 session is running right now (Design). Restarting ends it mid turn."
  );
  assert.equal(
    liveSessionSummary([{ channelName: "Design" }, { taskTitle: "Ship the fix" }]),
    "2 sessions are running right now (Design, Ship the fix). Restarting ends them mid turn."
  );
});

test("an unnamed session still counts (the number is the warning)", () => {
  assert.equal(
    liveSessionSummary([{}, {}]),
    "2 sessions are running right now. Restarting ends them mid turn."
  );
});

test("the name list is capped so a long list cannot push the buttons off the dialog", () => {
  const many = ["A", "B", "C", "D", "E"].map((channelName) => ({ channelName }));
  const line = liveSessionSummary(many);
  assert.match(line, /^5 sessions are running right now \(A, B, C, and more\)\./);
});

// ── The restart prompt ──────────────────────────────────────────────────────

test("LATER is the default and the cancel action; only one explicit click restarts", () => {
  const p = restartPrompt({ version: "1.7.19" });
  assert.deepEqual(p.buttons, ["Later", "Restart now"]);
  assert.equal(p.defaultId, 0, "return must not restart");
  assert.equal(p.cancelId, 0, "escape / close must not restart");
  assert.equal(RESTART_BUTTON_INDEX, 1);
  assert.equal(isRestartChoice(1), true);
  for (const other of [0, undefined, null, -1, 2, "1"]) {
    assert.equal(isRestartChoice(other), false, `${String(other)} must read as "later"`);
  }
});

test("the prompt says what it is and what doing nothing costs", () => {
  const p = restartPrompt({ version: "1.7.19" });
  assert.equal(p.type, "info");
  assert.equal(p.title, "Dopl");
  assert.equal(p.message, "Dopl 1.7.19 is ready to install");
  assert.equal(
    p.detail,
    "Restarting takes a few seconds and reopens Dopl on the new build. "
      + "Until you restart, this Mac keeps running the current build."
  );
  assert.equal(p.noLink, true);
});

test("with a session live the prompt LEADS with the warning and escalates to 'warning'", () => {
  const p = restartPrompt({ version: "1.7.19", sessions: [{ channelName: "Design" }] });
  assert.equal(p.type, "warning");
  assert.match(p.detail, /^1 session is running right now \(Design\)\. Restarting ends it mid turn\./);
  assert.match(p.detail, /keeps running the current build\.$/, "the rest of the copy is still there");
  assert.deepEqual(p.buttons, ["Later", "Restart now"], "same buttons, same safe default");
  assert.equal(p.defaultId, 0);
});

test("an unknown version still produces a usable prompt", () => {
  const p = restartPrompt({});
  assert.equal(p.message, "A Dopl update is ready to install");
});

// ── The notification ────────────────────────────────────────────────────────

test("the banner names the action, and names the live session when there is one", () => {
  const plain = downloadedNotification({ version: "1.7.19" });
  assert.equal(plain.title, "Dopl update ready");
  assert.equal(
    plain.body,
    "Version 1.7.19 is downloaded. Restart Dopl to install it. "
      + "Until then this Mac keeps running the old build."
  );
  const busy = downloadedNotification({ version: "1.7.19", sessions: [{ channelName: "Design" }] });
  assert.match(busy.body, /1 session is running right now \(Design\)/);
  assert.match(busy.body, /Click here to restart when you are ready/);
  assert.match(busy.body, /menu bar icon/, "the other way back to it");
});

test("no em dashes in anything the operator reads (repo copy rule)", () => {
  const strings = [
    progressLabel(43),
    progressLabel(null),
    ...["checking", "downloading", "ready", "up-to-date", "error", "unsupported"].map(
      (o) => checkNote(o, { version: "1.7.19", message: "boom" }).text
    ),
    liveSessionSummary([{ channelName: "Design" }]),
    ...Object.values(restartPrompt({ version: "1.7.19", sessions: [{ channelName: "Design" }] }))
      .filter((v) => typeof v === "string"),
    ...restartPrompt({ version: "1.7.19" }).buttons,
    downloadedNotification({ version: "1.7.19" }).title,
    downloadedNotification({ version: "1.7.19" }).body,
    downloadedNotification({ version: "1.7.19", sessions: [{}] }).body,
  ];
  for (const s of strings) {
    assert.equal(s.includes("—"), false, `em dash in: ${s}`);
  }
});
