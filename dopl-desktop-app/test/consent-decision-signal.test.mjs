// F-067 — A CONSENT DECISION THAT DID NOT LAND MUST NOT BE SILENT.
//
// THE BUG THIS LOCKS OUT. The native notification's Allow/Send action called
// `consent.patchDecision(...)` with no `await` and no `.catch`, and patchDecision itself
// collapsed every non-ok answer to `false`. So when the PATCH died (offline, 5xx, an
// expired token, a row deleted under us) the operator saw their notification disappear,
// the row stayed `pending`, no spawn happened, and NOTHING anywhere told them. The web
// Pending Requests list was the only recovery, and nothing pointed at it.
//
// THE FIX HAS TWO HALVES AND BOTH ARE PINNED HERE:
//   1. patchDecision returns 'ok' | 'settled' | 'failed' instead of a boolean, because the
//      one distinction that matters is invisible in a boolean: a 409 (the server's
//      CONSENT_ALREADY_DECIDED — the OTHER surface decided first) is a lost race, not a
//      breakage, and re-notifying it would tell the operator something broke when their own
//      web click is what answered.
//   2. submitDecision is the entry point every decision surface calls; on 'failed' ONLY it
//      raises a second notification naming the recovery path. Quiet on 'ok'. Quiet on 409.
//
// WHY SOURCE EXTRACTION: main/consent.js requires electron, so it cannot be imported under
// `node --test`. The four functions are sliced verbatim and driven with fakes — apiFetch,
// Notification, diag are all free variables — so what is tested is what ships.
//
// Run: `node --test dopl-desktop-app/test/consent-decision-signal.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const M = (p) => readFileSync(join(MAIN, p), "utf8");
const SRC = M("consent.js");

// fnOf slices from the `function` keyword, so an `async function` loses its modifier.
// Re-attach it, and assert the shipped function really is async.
function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

// The three outcome constants, taken from the source rather than retyped here: a rename
// that did not reach this file must fail loudly instead of testing a stale vocabulary.
const CONSTS = ["DECISION_OK", "DECISION_SETTLED", "DECISION_FAILED"]
  .map((n) => {
    const m = new RegExp(`^const ${n} = '[a-z-]+';$`, "m").exec(SRC);
    assert.ok(m, `${n} must be declared as a one-line const in consent.js`);
    return m[0];
  })
  .join("\n");

const OK = "ok";
const SETTLED = "settled";
const FAILED = "failed";

// ── harness: the real patchDecision + submitDecision, faked electron/HTTP ────

function harness({ fetch, notifySupported = true, notifyThrows = false } = {}) {
  const calls = { fetches: [], notices: [], clicks: [], logged: [], attention: 0, shown: 0 };
  const apiFetch = (path, opts) => {
    calls.fetches.push({ path, opts });
    return fetch(path, opts);
  };
  class FakeNotification {
    constructor(opts) {
      if (notifyThrows) throw new Error("notification construction blew up");
      this.opts = opts;
      calls.notices.push(opts);
    }
    static isSupported() { return notifySupported; }
    on(evt, fn) { if (evt === "click") calls.clicks.push(fn); }
    show() { calls.shown++; }
  }
  const body = [
    CONSTS,
    asyncFnOf(SRC, "patchDecision"),
    asyncFnOf(SRC, "submitDecision"),
    fnOf(SRC, "notifyDecisionFailed"),
    fnOf(SRC, "decisionFailedCopy"),
  ].join("\n\n");
  const api = new Function(
    "apiFetch", "Notification", "diag", "requestAttention", "CONSENT_PATH", "HTTP_TIMEOUT_MS",
    `${body}\n return { patchDecision, submitDecision, notifyDecisionFailed, decisionFailedCopy };`
  )(
    apiFetch,
    FakeNotification,
    (...a) => calls.logged.push(a.join(" ")),
    () => { calls.attention++; },
    "/api/channels/consent",
    15000
  );
  return { ...api, calls };
}

const res = (status) => ({ ok: status >= 200 && status < 300, status });
const okFetch = () => Promise.resolve(res(200));

// ── 1. the three outcomes ───────────────────────────────────────────────────

test("a recorded decision is 'ok', and it is the ONE surface that PATCHes the row", async () => {
  const h = harness({ fetch: okFetch });
  assert.equal(await h.patchDecision("w1", "row-1", "allow"), OK);
  assert.equal(h.calls.fetches.length, 1);
  const { path, opts } = h.calls.fetches[0];
  assert.equal(path, "/api/channels/consent/row-1");
  assert.equal(opts.method, "PATCH");
  // decidedBy keeps the audit trail honest: a native decision is not a web click (M-8).
  assert.deepEqual(opts.body, { decision: "allow", decidedBy: "desktop" });
});

test("THE DISTINCTION: a 409 is 'settled' — someone already decided it, nothing is broken", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(409)) });
  assert.equal(await h.patchDecision("w1", "row-1", "allow"), SETTLED);
});

test("a 5xx / 401 / 404 is 'failed' — every non-409 failure is one the operator must hear", async () => {
  for (const status of [500, 502, 401, 403, 404, 400]) {
    const h = harness({ fetch: () => Promise.resolve(res(status)) });
    assert.equal(await h.patchDecision("w1", "row-1", "allow"), FAILED, `status ${status}`);
  }
});

test("a rejected request (offline) is a clean 'failed', never a throw", async () => {
  const h = harness({ fetch: () => Promise.reject(new Error("ENOTFOUND")) });
  assert.equal(await h.patchDecision("w1", "row-1", "allow"), FAILED);
});

test("no rowId is 'failed' and asks the server nothing — it recorded no decision either", async () => {
  const h = harness({ fetch: okFetch });
  assert.equal(await h.patchDecision("w1", null, "allow"), FAILED);
  assert.equal(h.calls.fetches.length, 0);
});

// ── 2. who gets told ────────────────────────────────────────────────────────

test("THE FIX: a failed PATCH notifies the operator and names the recovery path", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(500)) });
  const out = await h.submitDecision("w1", "row-1", "allow", { channelName: "design" });
  assert.equal(out, FAILED);
  assert.equal(h.calls.notices.length, 1, "exactly one notification, not zero and not two");
  const n = h.calls.notices[0];
  assert.match(n.title, /decision not recorded/i);
  assert.match(n.title, /"design"/, "the channel the operator was answering");
  assert.match(n.body, /Allow/, "which decision was lost");
  assert.match(n.body, /Pending Requests/, "the recovery path, by name");
  assert.equal(h.calls.shown, 1, "and it is actually shown");
});

test("QUIET ON 409: a settled decision is not an error and must not re-notify", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(409)) });
  assert.equal(await h.submitDecision("w1", "row-1", "allow", { channelName: "design" }), SETTLED);
  assert.equal(h.calls.notices.length, 0, "a lost race is somebody else's Allow, not a failure");
});

test("QUIET ON SUCCESS: a decision that landed says nothing at all", async () => {
  const h = harness({ fetch: okFetch });
  assert.equal(await h.submitDecision("w1", "row-1", "allow", { channelName: "design" }), OK);
  assert.equal(h.calls.notices.length, 0);
});

test("an offline Allow notifies too — the network is the case this finding was written for", async () => {
  const h = harness({ fetch: () => Promise.reject(new Error("offline")) });
  assert.equal(await h.submitDecision("w1", "row-1", "allow", {}), FAILED);
  assert.equal(h.calls.notices.length, 1);
});

test("a failed Deny names Deny, not Allow — the copy must not misreport the decision", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(500)) });
  await h.submitDecision("w1", "row-1", "deny", { channelName: "design" });
  assert.match(h.calls.notices[0].body, /Deny/);
  assert.doesNotMatch(h.calls.notices[0].body, /Allow/);
});

test("with no channel name (the pre-consent window carries none) the copy still stands alone", () => {
  const h = harness({ fetch: okFetch });
  const c = h.decisionFailedCopy(null, "allow");
  assert.doesNotMatch(c.title, /""|undefined|null/, "no empty quotes where a name would be");
  assert.match(c.body, /Pending Requests/);
});

test("house voice: the copy carries no em or en dash", () => {
  const h = harness({ fetch: okFetch });
  for (const decision of ["allow", "deny"]) {
    for (const name of ["design", null]) {
      const c = h.decisionFailedCopy(name, decision);
      assert.doesNotMatch(c.title, /[—–]/, c.title);
      assert.doesNotMatch(c.body, /[—–]/, c.body);
    }
  }
});

// ── 3. the notification is best-effort in every direction ───────────────────

test("clicking the notice opens the channel the request came from", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(500)) });
  let opened = 0;
  await h.submitDecision("w1", "row-1", "allow", { channelName: "design", onOpen: () => { opened++; } });
  assert.equal(h.calls.clicks.length, 1);
  h.calls.clicks[0]();
  assert.equal(opened, 1);
});

test("a click handler that throws (window gone) does not escape", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(500)) });
  await h.submitDecision("w1", "row-1", "allow", { onOpen: () => { throw new Error("gone"); } });
  assert.doesNotThrow(() => h.calls.clicks[0]());
});

test("an unsupported platform is a quiet no-op, not a crash inside a decision", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(500)), notifySupported: false });
  assert.equal(await h.submitDecision("w1", "row-1", "allow", {}), FAILED);
  assert.equal(h.calls.notices.length, 0);
});

test("a Notification constructor that throws is swallowed — the decision path survives", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(500)), notifyThrows: true });
  assert.equal(await h.submitDecision("w1", "row-1", "allow", {}), FAILED);
});

test("submitDecision NEVER rejects, so a fire-and-forget caller cannot leak a rejection", async () => {
  // patchDecision injected as a throwing free variable: the one path the real one
  // cannot produce, and the reason submitDecision has its own try/catch.
  const notices = [];
  class N {
    constructor(o) { notices.push(o); }
    static isSupported() { return true; }
    on() {}
    show() {}
  }
  const api = new Function(
    "patchDecision", "Notification", "diag", "requestAttention",
    `${CONSTS}\n${asyncFnOf(SRC, "submitDecision")}\n${fnOf(SRC, "notifyDecisionFailed")}
     ${fnOf(SRC, "decisionFailedCopy")}\n return { submitDecision };`
  )(
    () => { throw new Error("boom"); },
    N,
    () => {},
    () => {}
  );
  assert.equal(await api.submitDecision("w1", "row-1", "allow", {}), FAILED);
  assert.equal(notices.length, 1, "a thrown PATCH is still told to the operator");
});

test("a failure is diagnosed as well as notified — the log is the second-day evidence", async () => {
  const h = harness({ fetch: () => Promise.resolve(res(500)) });
  await h.submitDecision("w1", "row-1", "allow", {});
  assert.ok(h.calls.logged.some((l) => /did not land/.test(l)), h.calls.logged.join("|"));
});

// ── 4. wiring: every decision surface goes through submitDecision ───────────

test("all four decision sites call submitDecision, and none still calls patchDecision", () => {
  const T = M("trigger.js");
  const TH = M("trigger-headless.js");
  const SC = M("session-consent.js");
  // The notification Allow (inbound) and Send (outbound headless) carry the channel name
  // so the copy can say WHICH request was lost.
  assert.match(T, /consent\.submitDecision\(entry\.workspaceId, created\.rowId, 'allow', \{/);
  assert.match(T, /channelName: entry\.channel\.name/);
  assert.match(TH, /consent\.submitDecision\(rec\.workspaceId, created\.rowId, 'allow', \{/);
  // The pre-consent window's Accept / Deny. No channelName by design (F-118 / B-1: the
  // registry entry holds no peer-typed display strings).
  assert.match(SC, /consent\.submitDecision\(e\.workspaceId, e\.rowId, 'allow'\)/);
  assert.match(SC, /consent\.submitDecision\(e\.workspaceId, e\.rowId, 'deny'\)/);

  for (const f of readdirSync(MAIN).filter((f) => f.endsWith(".js"))) {
    assert.doesNotMatch(
      M(f), /consent\.patchDecision\(/,
      `${f} decides a consent row without the F-067 failure signal`
    );
  }
});

test("the 409 rule is written down where the next reader will look", () => {
  const fn = fnOf(SRC, "patchDecision");
  assert.match(fn, /res\.status === 409/, "the settled case is an explicit branch, not a default");
  assert.match(SRC, /CONSENT_ALREADY_DECIDED/, "and it names the server error it maps to");
});
