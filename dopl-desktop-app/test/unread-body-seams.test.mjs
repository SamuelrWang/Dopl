// AN UNREAD `Response` IS NOT FREE — the seams that were still leaking on 2026-08-30.
//
// THE RULE, stated once in `main/api-repair.js › discardBody`: Node's `fetch` in Electron
// main is undici, and until a body is consumed or cancelled the request counts as IN
// FLIGHT — its socket is never returned to the pool and the next call opens another
// connection, retaining socket buffers and TLS state. All of that is NATIVE memory: no GC
// pressure, nothing in a heap snapshot, visible only as RSS.
//
// ⚠ THE LEAKING BRANCHES ARE THE ERROR BRANCHES, which is backwards from where anyone
// looks: the success path reads `res.json()` and is fine, while `if (!res.ok) return null`
// — the path a saturated server or a stale cookie puts EVERY caller on at once — drops the
// body on the floor. The 2026-08-30 sweep covered the three highest-frequency seams
// (`presence`, `channel-listener`, `listener-io`'s loop) and filed the rest as F-353. This
// suite pins the ones the FAILING-AUTH wave then closed, chosen by measured rate rather
// than by file order:
//
//   listener-io.listWorkspaces  — ~2/min forever behind the self-heal's re-ask
//   listener-io.listChannels    — ×3 per workspace per pass (listChannelsWithRetry)
//   consent.pollStatus          — the highest instantaneous rate in main/
//   session-state-push.send     — leaked on SUCCESS too, the `presence.beatOnce` class
//   version-gate.fetchFloor     — leaks regardless of auth, every 10 minutes, forever
//
// …plus the poll that made `consent.pollStatus` so hot in the first place.
//
// Source-level: every one of these modules requires electron and/or electron-store.
//
// Run: `node --test dopl-desktop-app/test/unread-body-seams.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

// ── ONE implementation, shared — never a private re-spelling ────────────────

test("every seam takes discardBody from api-repair.js; nobody re-implements it", () => {
  for (const file of [
    "listener-io.js",
    "consent.js",
    "session-state-push.js",
    "version-gate.js",
    "ui-bridge.js",
    "presence.js",
  ]) {
    const src = M(file);
    assert.match(src, /require\('\.\/api-repair'\)/, `${file} must import the shared helper`);
    assert.ok(
      !/function discardBody/.test(src),
      `${file}: "a third copy of the rule is the bug" — api-repair.js owns this one`
    );
  }
});

// ── The seams themselves ────────────────────────────────────────────────────

test("listWorkspaces releases the body on BOTH failure exits", () => {
  const fn = fnOf(M("listener-io.js"), "listWorkspaces");
  // The 401 branch is the one a stale credential puts every pass on.
  assert.match(fn, /if \(res\.status === 401\) \{\s*\n\s*discardBody\(res\);/);
  assert.match(fn, /if \(!res\.ok\) \{ discardBody\(res\);/);
  // …and the success path still READS it, which is what makes it safe there.
  assert.match(fn, /normalizeList\(await res\.json\(\)/);
});

test("listChannels releases on all three — and it is amplified by the retry ladder", () => {
  const fn = fnOf(M("listener-io.js"), "listChannels");
  assert.match(fn, /res\.status === 404\) \{ discardBody\(res\);/);
  assert.match(fn, /res\.status === 401\) \{ discardBody\(res\);/);
  assert.match(fn, /!res\.ok\) \{ discardBody\(res\);/);
});

test("consent.pollStatus releases on every exit that does not read the body", () => {
  const fn = fnOf(M("consent.js"), "pollStatus");
  assert.match(fn, /404\) \{ discardBody\(res\); return 'expired'; \}/);
  assert.match(fn, /!res\.ok\) \{ discardBody\(res\); return null; \}/);
  assert.match(fn, /catch \(_\) \{ discardBody\(res\); return null; \}/, "a failed parse too");
});

test("session-state-push releases on SUCCESS as well — the presence.beatOnce class", () => {
  const fn = fnOf(M("session-state-push.js"), "send");
  assert.match(fn, /res\.ok\) \{ discardBody\(res\);/, "the success branch read no body either");
  assert.match(fn, /discardBody\(res\);.*\n\s*if \(retryable/, "…and the retry must not stack sockets");
});

test("version-gate's floor fetch releases — it leaks with or without a credential", () => {
  const fn = fnOf(M("version-gate.js"), "fetchFloor");
  assert.match(fn, /discardBody\(res\)/);
  assert.match(fn, /readFloorResponse\(await res\.json\(\)\)/, "success still reads it");
});

// ── The poll that made one of those seams hot ───────────────────────────────

test("watchRow distinguishes a FAILED read from a pending row, and backs off", () => {
  // `pollStatus` answers null for every transient failure, and this loop treated that as
  // "still waiting" — so a dead API produced a 3-second poll with no backoff and no
  // ceiling for as long as the session lived (F-354).
  const src = M("session-windowless.js");
  const fn = fnOf(src, "watchRow");
  assert.ok(
    !/status === null \|\| status === 'pending'/.test(fn),
    "collapsing null into pending is the defect itself"
  );
  assert.match(fn, /if \(status === null\) \{ failures \+= 1; continue; \}/);
  assert.match(fn, /failures = 0;/, "an answer — pending included — resets the ladder");
  assert.match(fn, /Math\.min\(POLL_MAX_MS/, "and the backoff has a ceiling");
  assert.match(src, /const POLL_MAX_MS = 60_000;/);
});

test("…but it never gives UP: the operator may still decide, and the session ends it", () => {
  const fn = fnOf(M("session-windowless.js"), "watchRow");
  assert.match(fn, /for \(;;\)/, "the loop is ended by the session settling, not by a counter");
  assert.match(fn, /s\.settled \|\| !s\.pendingPermissions\.has\(requestId\)/);
});

test("a row that really is PENDING still polls at the full cadence", () => {
  // The backoff must key on failure, not on waiting — an operator staring at the prompt
  // must not have their decision delayed by a minute.
  const fn = fnOf(M("session-windowless.js"), "watchRow");
  assert.match(fn, /await sleep\(failures \? Math\.min/);
  assert.match(fn, /: POLL_MS\)/, "zero failures means the unchanged 3s cadence");
});
