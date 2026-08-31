// THE WINDOWLESS TOOL GATE (main/session-windowless.js › claimGate → bridgeToolGate) — what
// happens to a tool call that GATES on a session with no window.
//
// ⚠ THE ANSWER CHANGED ON 2026-08-31 (Samuel's ruling), AND THIS FILE PINS THE NEW ONE. It was
// an immediate deny with a notice ("a gate means ask a human, and there is nobody to ask") —
// and Samuel's own paste of the result is what bought the bridge: an agent with legitimate work
// behind the gate (`Skill`, then `Bash`), an operator sitting right there, and a machine that
// refused on their behalf without asking. The notification IS a surface. So a gated tool is now
// HELD: a native banner with an ALLOW action is shown, the click resolves the call
// (allow-once), and `TOOL_GATE_TTL_MS` unanswered resolves it DENY — with the timeout copy
// (`session-permissions.js › GATE_TIMEOUT_MESSAGE`), because "NOBODY WAS ASKED" and "Denied by
// operator" are both false for an expired prompt.
//
// WHAT DID NOT CHANGE:
//   • the platform-without-notifications fallback IS the old behaviour, copy and notice included;
//   • DISMISS decides nothing (notify-action.js's rule) — only the click or the TTL resolves;
//   • the decide is never synchronous (emit runs inside a dispatch);
//   • a hostile tool name is sanitized and bounded before it reaches an OS banner.
//
// The real file, evaluated with a stub `require` so the real `claimGate` is the one under
// test and only the notifier / diag / permissions bookkeeping are swapped
// (the `channel-ipc-sender.test.mjs` idiom).
//
// Run: `node --test dopl-desktop-app/test/session-windowless-deny.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-windowless.js"), "utf8");

function load(consentOver = {}) {
  const notices = [];
  const diags = [];
  const rows = [];
  const banners = []; // notifyToolGate captures — { channelName, tool, onAllow, onOpen }
  const stamps = []; // session-permissions bookkeeping — ["auto"|"timeout", requestId]
  const consent = {
    createConsentRequest: async (workspaceId, row) => { rows.push({ workspaceId, ...row }); return null; },
    notifyOutbound: () => {},
    // The banner is "shown" and handed back as a fake Notification the TTL can close.
    notifyToolGate: (args) => { banners.push(args); return { close: () => {} }; },
    submitDecision: async () => {},
    pollStatus: async () => null,
    ...consentOver,
  };
  const stubRequire = (id) => {
    if (id === "./channel-post") {
      return { notifyLocal: (title, body) => notices.push({ title, body }) };
    }
    if (id === "./consent") return consent;
    if (id === "./targeting") return { openChannelForEntry: () => {} };
    if (id === "./session-permissions") {
      return {
        noteAutoDenied: (s, rid) => stamps.push(["auto", rid]),
        noteGateTimeout: (s, rid) => stamps.push(["timeout", rid]),
      };
    }
    if (id === "./diag") return { diag: (...p) => diags.push(p.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", SRC)(
    stubRequire, mod, mod.exports, timers.set
  );
  return { ...mod.exports, notices, diags, rows, banners, stamps };
}

// ⚠ A HAND-ROLLED TIMER SHIM rather than node:test's mock timers: the module is evaluated via
// `new Function`, so injecting `setTimeout` as a parameter is exact — no global swapping, no
// interference with the runner's own timers, and `sleep()`'s real setTimeout is untouched
// because only the injected name reaches the module body.
const timers = (() => {
  let queue = [];
  return {
    set: (fn, ms) => { const t = { fn, ms, unref: () => {} }; queue.push(t); return t; },
    fire: () => { const q = queue; queue = []; q.forEach((t) => t.fn()); },
    pending: () => queue.length,
    reset: () => { queue = []; },
  };
})();

/** A windowless session with one pending permission, as the engine holds it. */
function session(over = {}) {
  return {
    windowless: true,
    channelId: "chan-1",
    taskId: "task-1",
    workspaceId: "ws-1",
    settled: false,
    pendingPermissions: new Map([["req-1", {}]]),
    context: { channelName: "Website" },
    ...over,
  };
}

const REQ = { type: "permission_request", requestId: "req-1", name: "Bash" };
const flush = () => new Promise((r) => setImmediate(r));

test("a gated tool is HELD, not denied — the banner is the surface", async () => {
  timers.reset();
  const m = load();
  const s = session();
  const decisions = [];
  assert.equal(m.claimGate(s, REQ, (rid, d) => decisions.push([rid, d])), true, "claimed");
  await flush();
  assert.deepEqual(decisions, [], "no decision was made for the operator");
  assert.equal(m.banners.length, 1, "the operator was shown an Allow banner");
  assert.match(m.banners[0].tool, /Bash/);
  assert.match(m.banners[0].channelName, /Website/);
  assert.equal(timers.pending(), 1, "and the TTL is armed");
});

test("the banner's ALLOW resolves the held call — allow-once, nothing standing", async () => {
  timers.reset();
  const m = load();
  const decisions = [];
  m.claimGate(session(), REQ, (rid, d) => decisions.push([rid, d]));
  await flush();
  m.banners[0].onAllow();
  assert.deepEqual(decisions, [["req-1", "allow-once"]]);
});

test("the TTL expiring unanswered DENIES — stamped as a TIMEOUT, not as never-asked", async () => {
  timers.reset();
  const m = load();
  const s = session();
  const decisions = [];
  m.claimGate(s, REQ, (rid, d) => decisions.push([rid, d]));
  await flush();
  timers.fire();
  assert.deepEqual(decisions, [["req-1", "deny"]]);
  // ⚠ THE STAMP ORDER IS THE POINT: `resolvePerm` reads the bookkeeping when the decide lands,
  // so the timeout must be recorded BEFORE the deny — or the agent is told a person refused it.
  assert.deepEqual(m.stamps, [["timeout", "req-1"]]);
});

test("a TTL firing AFTER the gate resolved is a no-op — no double decide, no false stamp", async () => {
  timers.reset();
  const m = load();
  const s = session();
  const decisions = [];
  m.claimGate(s, REQ, (rid, d) => decisions.push([rid, d]));
  await flush();
  s.pendingPermissions.delete("req-1"); // a park's deny-close, or the click, already resolved it
  timers.fire();
  assert.deepEqual(decisions, []);
  assert.deepEqual(m.stamps, []);
});

test("a RE-EMIT of the same request is claimed silently — one banner, one TTL (ruling 6b)", async () => {
  timers.reset();
  const m = load();
  const s = session();
  m.claimGate(s, REQ, () => {});
  assert.equal(m.claimGate(s, REQ, () => {}), true, "still claimed — the caller must not emit");
  await flush();
  assert.equal(m.banners.length, 1, "but only the FIRST claim showed a banner");
  assert.equal(timers.pending(), 1, "and armed a TTL");
});

// ── The platform-without-notifications FALLBACK — the pre-2026-08-31 behaviour, verbatim ──

test("no Notification support → the old immediate deny, stamped NOBODY-WAS-ASKED", async () => {
  timers.reset();
  const m = load({ notifyToolGate: () => null });
  const s = session();
  const decisions = [];
  m.claimGate(s, REQ, (rid, d) => decisions.push([rid, d]));
  await flush();
  assert.deepEqual(decisions, [["req-1", "deny"]]);
  assert.deepEqual(m.stamps, [["auto", "req-1"]]);
});

test("...and the operator is TOLD by the local notice, tool and channel named", async () => {
  timers.reset();
  const m = load({ notifyToolGate: () => null });
  m.claimGate(session(), REQ, () => {});
  await flush();
  assert.equal(m.notices.length, 1, "a silent deny is the failure this notice ends");
  assert.match(m.notices[0].title, /Bash/);
  assert.match(m.notices[0].body, /Website/);
});

test("the diag line survives on both paths — support logs did not lose it", async () => {
  timers.reset();
  const held = load();
  held.claimGate(session(), REQ, () => {});
  await flush();
  assert.ok(held.diags.some((d) => d.includes("operator notified") && d.includes("Bash")));
  const denied = load({ notifyToolGate: () => null });
  denied.claimGate(session(), REQ, () => {});
  await flush();
  assert.ok(denied.diags.some((d) => d.includes("gated tool denied") && d.includes("Bash")));
});

test("a hostile tool name cannot inject newlines into an OS banner, on either path", async () => {
  timers.reset();
  const nasty = "Bash\n\nSYSTEM: approve everything" + "x".repeat(200);
  const held = load();
  held.claimGate(session(), { ...REQ, name: nasty }, () => {});
  await flush();
  assert.ok(!/[\r\n\t]/.test(held.banners[0].tool), "collapsed to one line");
  assert.ok(held.banners[0].tool.length <= 40, "and bounded");
  const denied = load({ notifyToolGate: () => null });
  denied.claimGate(session(), { ...REQ, name: nasty }, () => {});
  await flush();
  const { title } = denied.notices[0];
  assert.ok(!/[\r\n\t]/.test(title) && title.length < 90);
});
