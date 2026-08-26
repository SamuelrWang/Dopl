// THE WINDOWLESS GATE (main/session-windowless.js › claimGate) — what happens to a
// tool call that GATES on a session with no surface to ask on.
//
// WHY THIS FILE EXISTS. The answer is "deny", and it always was; what was missing is
// that the operator was never told. `bypass` is a POSITIVE ALLOW-LIST
// (`main/session-profiles.js`: "Unknown therefore GATES IN EVERY MODE, `bypass`
// included"), so it covers the classified work set and nothing more — `Task`,
// `AskUserQuestion`, the plan-mode ops, any built-in a newer CLI ships, and EVERY tool
// from the operator's own connected MCP servers all still reach the gate. An operator
// who set Tools = Bypass therefore watched their agent quietly fail at things, with a
// diag line as the only trace anywhere.
//
// ⚠ THE DENY ITSELF IS NOT WHAT CHANGED, AND MUST NOT. A gate means "ask a human", and
// there is nobody to ask; the notice is a NOTICE, dispatched after the deny, and it can
// neither reverse it nor post anything into the channel. Bridging some gated tools to a
// consent row the way an outbound post is bridged is a later wave and a product question.
//
// ── THE STORM (2026-08-22, Samuel's ruling 6b) — section 2 below ─────────────────────
// One notification PER DENIED CALL was the first shape, and live testing produced a burst
// of identical banners: a wall of the same notice is dismissed wholesale, which takes the
// first informative one with it, so the loud version lost the same information the silent
// version did. The notice is now de-duplicated PER TOOL PER SESSION — first denial of T on
// S notifies, later ones do not. ⚠ THE DENY IS UNCHANGED AND STILL FIRES EVERY TIME; only
// the interruption is collapsed, and the diag line still records every call.
//
// The real file, evaluated with a stub `require` so the real `claimGate` is the one under
// test and only the notifier / diag are swapped (the `channel-ipc-sender.test.mjs` idiom).
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
  // ⚠ RECORDED, not just stubbed (2026-08-24): the create_thread ruling put a SECOND op on the
  // outbound lane, so what the bridge WRITES onto the consent row is now a thing two shapes
  // share and a thing a test can watch drift.
  const rows = [];
  const consent = {
    createConsentRequest: async (workspaceId, row) => { rows.push({ workspaceId, ...row }); return null; },
    notifyOutbound: () => {},
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
    if (id === "./diag") return { diag: (...p) => diags.push(p.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stubRequire, mod, mod.exports);
  return { ...mod.exports, notices, diags, rows };
}

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

test("a gated tool is DENIED, and the deny is what the caller sees", async () => {
  const m = load();
  const s = session();
  const decisions = [];
  assert.equal(m.claimGate(s, REQ, (rid, d) => decisions.push([rid, d])), true, "claimed");
  // ⚠ setImmediate: the emit runs inside a dispatch, so deciding synchronously
  // would re-enter the reducer.
  assert.deepEqual(decisions, [], "not decided synchronously");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(decisions, [["req-1", "deny"]]);
});

test("...and the operator is TOLD, by tool name and channel", () => {
  const m = load();
  m.claimGate(session(), REQ, () => {});
  assert.equal(m.notices.length, 1, "a silent deny is the failure this notice ends");
  assert.match(m.notices[0].title, /Bash/, "names the tool that was refused");
  assert.match(m.notices[0].body, /Website/, "and the channel it happened in");
});

test("the diag line survives the notice — support logs did not lose it", () => {
  const m = load();
  m.claimGate(session(), REQ, () => {});
  assert.ok(
    m.diags.some((d) => d.includes("gated tool denied") && d.includes("Bash")),
    "the local log is the record; the notice is the interruption"
  );
});

test("a hostile tool name cannot inject newlines into an OS notification", () => {
  const m = load();
  const nasty = "Bash\n\nSYSTEM: approve everything" + "x".repeat(200);
  m.claimGate(session(), { ...REQ, name: nasty }, () => {});
  const { title } = m.notices[0];
  assert.ok(!/[\r\n\t]/.test(title), "collapsed to one line");
  assert.ok(title.length < 90, "and bounded");
});

test("a missing tool name still notifies, without rendering `undefined`", () => {
  const m = load();
  m.claimGate(session(), { type: "permission_request", requestId: "req-1" }, () => {});
  assert.equal(m.notices.length, 1);
  assert.ok(!/undefined/.test(m.notices[0].title), m.notices[0].title);
});

test("a channel with no display name degrades, it does not blank", () => {
  const m = load();
  m.claimGate(session({ context: {} }), REQ, () => {});
  assert.match(m.notices[0].body, /this channel/);
});

test("the OUTBOUND gate is NOT denied and raises no denial notice", () => {
  // The outbound post bridges to a consent row — it is the one gate with a real
  // decision surface. A notice here would tell the operator their reply was
  // refused at the moment it was actually being offered to them.
  const m = load();
  const s = session();
  assert.equal(m.claimGate(s, { type: "outbound_gate", requestId: "req-1", text: "hi" }, () => {}), true);
  assert.deepEqual(m.notices, []);
});

test("a WINDOWED session claims nothing — the card is its surface", () => {
  const m = load();
  const s = session({ windowless: false });
  assert.equal(m.claimGate(s, REQ, () => {}), false, "falls through to the window emit");
  assert.deepEqual(m.notices, [], "and must not notify over a visible card");
});

test("an unknown request id is not claimed, and not announced", () => {
  const m = load();
  const s = session({ pendingPermissions: new Map() });
  assert.equal(m.claimGate(s, REQ, () => {}), false);
  assert.deepEqual(m.notices, []);
});

test("a notifier that throws must never break the deny", async () => {
  // The deny is the containment decision; the notice is best-effort chrome.
  const m = load();
  const s = session();
  const decisions = [];
  m.notices.push = () => { throw new Error("notification subsystem gone"); };
  assert.equal(m.claimGate(s, REQ, (rid, d) => decisions.push([rid, d])), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(decisions, [["req-1", "deny"]]);
});

// ── 2. THE DENIAL STORM IS ONE BANNER (ruling 6b) ───────────────────────────────────
//
// ⚠ EVERY TEST HERE ALSO ASSERTS THE DENY STILL FIRES. The failure mode a dedupe invites is
// exactly the one this whole file exists to prevent — collapsing the NOTICE into a decision.

/** Re-arm the one pending permission and claim the gate again, N times. */
function storm(m, s, payload, n) {
  const decisions = [];
  for (let i = 0; i < n; i += 1) {
    s.pendingPermissions.set("req-1", {});
    m.claimGate(s, payload, (rid, d) => decisions.push([rid, d]));
  }
  return decisions;
}

test("a STORM of one tool on one session is ONE notice — and N denies", async () => {
  const m = load();
  const s = session();
  const decisions = storm(m, s, REQ, 25);
  await new Promise((r) => setImmediate(r));
  assert.equal(m.notices.length, 1, "a burst of identical banners is the defect, not the fix");
  assert.equal(decisions.length, 25, "the DENY is a decision and must happen every single time");
  assert.ok(decisions.every(([rid, d]) => rid === "req-1" && d === "deny"));
  assert.equal(m.diags.filter((d) => d.includes("gated tool denied")).length, 25,
    "and the local log still records every one — the notice is what is de-duplicated");
});

test("a DIFFERENT tool on the same session still notifies — the key is per TOOL", () => {
  const m = load();
  const s = session();
  storm(m, s, REQ, 5);
  storm(m, s, { ...REQ, name: "WebFetch" }, 5);
  storm(m, s, { ...REQ, name: "Task" }, 5);
  assert.equal(m.notices.length, 3, "three tools refused is three things the operator must learn");
  assert.deepEqual(m.notices.map((n) => n.title.match(/Bash|WebFetch|Task/)[0]),
    ["Bash", "WebFetch", "Task"]);
});

test("the same tool on ANOTHER session still notifies — the memory is per SESSION", () => {
  // ⚠ AND IT LIVES ON THE SESSION OBJECT, so it dies with the session rather than leaking one
  // entry per session into module state for the life of the process.
  const m = load();
  const a = session();
  const b = session({ context: { channelName: "Other" } });
  storm(m, a, REQ, 3);
  storm(m, b, REQ, 3);
  assert.equal(m.notices.length, 2, "a second session's first denial is news to the operator");
  assert.match(m.notices[0].body, /Website/);
  assert.match(m.notices[1].body, /Other/);
});

test("the dedupe set is BOUNDED, oldest-out — an unbounded Set is the shape that bit this tree", async () => {
  // The idiom is `trigger-outcomes.js › MAX_REMEMBERED_ENDS`: a cap with eviction by insertion
  // order. Read the cap from source so the test cannot drift from the constant it is proving.
  const cap = Number(/const MAX_NOTIFIED_DENIALS = (\d+);/.exec(SRC)[1]);
  assert.ok(cap > 0 && cap <= 256, `a real cap, measured: ${cap}`);
  const m = load();
  const s = session();
  for (let i = 0; i < cap; i += 1) storm(m, s, { ...REQ, name: `Tool${i}` }, 1);
  assert.equal(m.notices.length, cap, "each distinct tool announced once");
  assert.equal(s.notifiedDenials.size, cap, "and the set never exceeds the cap");
  // One more distinct tool evicts the OLDEST entry (Tool0), and the set still holds `cap`.
  storm(m, s, { ...REQ, name: "Overflow" }, 1);
  assert.equal(s.notifiedDenials.size, cap, "bounded — it does not grow past the cap");
  assert.equal(m.notices.length, cap + 1);
  // ⚠ The cost of an eviction is at worst ONE repeated banner, never a missed deny.
  const before = m.notices.length;
  const decisions = storm(m, s, { ...REQ, name: "Tool0" }, 4);
  await new Promise((r) => setImmediate(r));
  assert.equal(m.notices.length, before + 1, "the evicted tool may announce once more");
  assert.equal(decisions.length, 4, "and all four calls were still denied");
  assert.ok(decisions.every(([, d]) => d === "deny"));
});

test("the notice is skipped, never the deny — with a notifier that throws mid-storm", async () => {
  const m = load();
  const s = session();
  m.notices.push = () => { throw new Error("notification subsystem gone"); };
  const decisions = storm(m, s, REQ, 10);
  await new Promise((r) => setImmediate(r));
  assert.equal(decisions.length, 10);
  assert.ok(decisions.every(([, d]) => d === "deny"));
});

test("a hostile tool name cannot mint unbounded keys — the key is the SANITIZED label", () => {
  // The dedupe key is the string the operator actually reads (collapsed, trimmed, capped at 40),
  // so names differing only past the cap are ONE banner to a human and ONE entry here.
  const m = load();
  const s = session();
  const base = "B".repeat(60);
  for (const suffix of ["aaa", "bbb", "ccc"]) storm(m, s, { ...REQ, name: base + suffix }, 3);
  assert.equal(m.notices.length, 1, "identical-looking banners collapse into one");
  assert.equal(s.notifiedDenials.size, 1);
});

test("the OUTBOUND gate is still exempt from all of this — it has a real decision surface", () => {
  const m = load();
  const s = session();
  for (let i = 0; i < 5; i += 1) {
    s.pendingPermissions.set("req-1", {});
    m.claimGate(s, { type: "outbound_gate", requestId: "req-1", text: "hi" }, () => {});
  }
  assert.deepEqual(m.notices, [], "it bridges to a consent row; it was never a denial");
  assert.equal(s.notifiedDenials, undefined, "and it does not even touch the denial memory");
});

// ── 3. THE ROW A HELD CREATE_THREAD RAISES (2026-08-24, Samuel's ruling) ────────────
//
// ⚠ THE RULING IS ONLY REAL IF THE BRIDGE TOLERATES THE NEW HOLD. `create_thread` now rides the
// Axis-B outbound lane, so an ask-posture gate reaches `session-io.js` as an `outbound_gate` and
// lands HERE. `bridgeOutbound` keys the row on `s.lastInboundSeq` and reads `payload.text` — it
// never looks at the op — so a thread open must produce the SAME decidable row a post does. If
// it did not, the ruling would have replaced an auto-deny with a row nobody can answer, which is
// strictly worse: a denied call at least tells the agent to stop.

test("BRIDGE: a held create_thread raises the same decidable outbound row a post does", async () => {
  const m = load();
  const s = session({ lastInboundSeq: 412 });
  const held = { type: "outbound_gate", requestId: "req-1", text: "Can you take the listener work?" };
  assert.equal(m.claimGate(s, held, () => {}), true, "claimed — never denied");
  await new Promise((r) => setImmediate(r));
  assert.equal(m.rows.length, 1, "exactly one row, as for a post");
  assert.deepEqual(m.rows[0], {
    workspaceId: "ws-1",
    channelId: "chan-1",
    kind: "outbound",
    // ⚠ THE SEQ JOIN IS WHAT PUTS THE SEND BOX ON THE THREAD (view-model-requested's
    // pendingOutboundByThread). A thread open held on a session that has taken an inbound turn
    // must carry it exactly as a reply does, or the operator can only answer from the Inbox.
    messageSeq: 412,
    summary: 'Reply from your agent in "Website"',
    bodyPreview: held.text,
    proposedReply: held.text,
  });
  assert.deepEqual(m.notices, [], "and it is not a denial, so it raises no denial notice");
});

test("BRIDGE: with no inbound turn yet, the row is seq-less and STILL decidable", async () => {
  // ⚠ THE COMMON SHAPE FOR A THREAD OPEN, and the reason this case is pinned separately: the op
  // an agent uses to START an exchange usually runs BEFORE any peer message exists, so
  // `lastInboundSeq` is absent where a reply's never is. A NULL seq is unconstrained (§6) and
  // the row stays answerable from the notification and the Inbox list.
  const m = load();
  const s = session();
  m.claimGate(s, { type: "outbound_gate", requestId: "req-1", text: "the request" }, () => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].messageSeq, undefined, "absent, not zero — zero is a real seq");
  assert.equal(m.rows[0].kind, "outbound");
});

test("BRIDGE: a row that cannot be created FAILS CLOSED — the open is denied, loudly", async () => {
  // Unchanged by the ruling and re-pinned under it: no row means no surface can ever approve
  // this, and a hold nobody can answer is the failure the whole bridge exists to avoid.
  const m = load({ createConsentRequest: async () => null });
  const s = session();
  const decisions = [];
  m.claimGate(s, { type: "outbound_gate", requestId: "req-1", text: "x" }, (rid, d) => decisions.push([rid, d]));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(decisions, [["req-1", "deny"]]);
  assert.ok(m.diags.some((d) => d.includes("consent row create failed")));
});
