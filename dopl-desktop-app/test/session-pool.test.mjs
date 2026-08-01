// The headless spawn POOL (main/session-pool.js, D1 2026-07-31).
//
// WHAT THIS PINS. The desktop used to allow ONE headless spawn per CHANNEL: a second thread
// in the same channel waited behind the first (measured live: 2m13s to pickup). The
// multiplayer plan needs N agents working in one channel at once, so the per-channel binary
// became a pool keyed by the SESSION KEY with a global cap. Three properties have to hold
// together, and each is the failure mode of the other two if it slips:
//   (1) two DIFFERENT keys in one channel run concurrently        (the point of the change)
//   (2) the SAME key twice is still refused                        (the old bug guard, absolute)
//   (3) the (cap+1)th defers exactly like today's busy path        (the loop-safety ceiling)
// Plus: the key is THE sessionKey definition, and the accounting read has the shape a chips
// UI can list from.
//
// Run: `node --test dopl-desktop-app/test/session-pool.test.mjs`
//
// SOURCE EXTRACTION with INJECTION (the SESSION-REOPEN / QUEUED-NOTICE idiom): the module
// requires session-store, which requires electron-store, so the BEGIN/END SESSION-POOL-PURE
// block references `store` as a FREE variable. We slice it, prove it holds no host binding,
// and drive the REAL pool with the REAL sessionKey — itself sliced out of session-store's own
// pure block, so this suite can never pass against a divergent second copy of the key. Each
// harness evaluates the block afresh, so the module-scope `active` map starts empty per test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");

// A missing / inverted sentinel would slice "" and pass every negative assertion VACUOUSLY,
// so this throws rather than handing an empty block to the suite.
function block(file, name) {
  const src = readFileSync(join(MAIN, file), "utf8");
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing in ${file}`);
  assert.notEqual(to, -1, `END ${name} sentinel missing in ${file}`);
  assert.ok(to > from, `${name} sentinels out of order in ${file}`);
  return src.slice(from, to);
}

const POOL = block("session-pool.js", "SESSION-POOL-PURE");
const STORE = block("session-store.js", "SESSION-STORE-PURE");
const QUEUED = block("queued-notice.js", "QUEUED-NOTICE-PURE");

// The REAL key functions that ship, not lookalikes. FIX S5: the pool keys on `slotKey`, the
// shape that carries an agent, so BOTH are sliced out of session-store's own pure block.
const { sessionKey, slotKey } = new Function(`${STORE}\n return { sessionKey, slotKey };`)();

const CHANNEL = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER = "ffffffff-0000-1111-2222-333333333333";
const T1 = "11111111-2222-3333-4444-555555555555";
const T2 = "99999999-8888-7777-6666-555555555555";

function pool() {
  return new Function(
    "store",
    `${POOL}\n return { MAX_CONCURRENT_SESSIONS, claim, release, isBusy, atCap, size, listActive };`
  )({ sessionKey, slotKey });
}

// ── containment ──────────────────────────────────────────────────────────────

test("the pure block reaches no host binding (it is driven, not stubbed around)", () => {
  for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "process."]) {
    assert.ok(!POOL.includes(banned), `SESSION-POOL-PURE block must not reference ${banned}`);
  }
});

// ── (1) N concurrent sessions in ONE channel ─────────────────────────────────

test("two DIFFERENT threads of ONE channel hold slots at the same time", () => {
  const p = pool();
  const a = p.claim({ channelId: CHANNEL, taskId: T1 });
  const b = p.claim({ channelId: CHANNEL, taskId: T2 });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true, "the second thread of the same channel must NOT defer");
  assert.notEqual(a.key, b.key);
  assert.equal(p.size(), 2);
  // ...and neither one makes the other look busy (the old per-channel question is gone).
  assert.equal(p.isBusy({ channelId: CHANNEL, taskId: T1 }), true);
  assert.equal(p.isBusy({ channelId: CHANNEL, taskId: "33333333-2222-3333-4444-555555555555" }), false);
});

test("the slot is THE sessionKey, so a taskless spawn is its own (collapsed) slot", () => {
  const p = pool();
  assert.equal(p.claim({ channelId: CHANNEL, taskId: T1 }).key, sessionKey(CHANNEL, T1));
  // A legacy / absent thread id collapses to `${channelId}:` — one slot per channel, which is
  // byte-for-byte the OLD behavior, and it does not collide with a first-class thread's slot.
  const taskless = p.claim({ channelId: CHANNEL });
  assert.equal(taskless.ok, true);
  assert.equal(taskless.key, sessionKey(CHANNEL, ""));
  assert.equal(p.claim({ channelId: CHANNEL, taskId: "" }).reason, "same-key");
  // The same thread id in a DIFFERENT channel is a different session.
  assert.equal(p.claim({ channelId: OTHER, taskId: T1 }).ok, true);
});

// FIX S5: the pool keys on slotKey, so a TEAM agent gets its own slot.
test("N agents of ONE channel each hold their own slot (the key is not re-derived here)", () => {
  // This is the failure the pool exists to prevent, in its D2 shape: a team session has NO
  // thread, so a pool that re-derived (channel, thread) collapsed every agent of a channel
  // onto `channelId + ':'` and the first agent's spawn made the rest read as 'same-key' busy.
  const p = pool();
  const a = p.claim({ channelId: CHANNEL, taskId: "", agentId: "agent-quartz" });
  const b = p.claim({ channelId: CHANNEL, taskId: "", agentId: "agent-onyx" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, "a second agent in the SAME channel must not defer behind the first");
  assert.equal(a.key, slotKey({ channelId: CHANNEL, agentId: "agent-quartz" }));
  assert.notEqual(a.key, b.key);
  assert.equal(p.isBusy({ channelId: CHANNEL, taskId: "", agentId: "agent-quartz" }), true);
  assert.equal(p.isBusy({ channelId: CHANNEL, taskId: "", agentId: "agent-onyx" }), true);
  // …and neither of them occupies the channel's TASKLESS pair slot, which is a third session.
  assert.equal(p.isBusy({ channelId: CHANNEL, taskId: "" }), false);
  assert.equal(p.claim({ channelId: CHANNEL, taskId: "" }).ok, true);
  assert.equal(p.size(), 3);
});

// ── (2) same-key exclusivity is absolute ─────────────────────────────────────

test("a second spawn for the SAME session is refused, and says why", () => {
  const p = pool();
  assert.equal(p.claim({ channelId: CHANNEL, taskId: T1 }).ok, true);
  const second = p.claim({ channelId: CHANNEL, taskId: T1 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "same-key");
  assert.equal(second.key, sessionKey(CHANNEL, T1), "a refusal still names the slot it wanted");
  assert.equal(p.size(), 1, "a refused claim takes nothing");
});

test("same-key beats at-cap: a full pool still calls a duplicate what it is", () => {
  // Precedence matters for the log, not the wire (both defer). A duplicate reported as
  // 'at-cap' would send someone looking for a concurrency ceiling that is not the problem.
  const p = pool();
  for (let i = 0; i < p.MAX_CONCURRENT_SESSIONS; i++) p.claim({ channelId: CHANNEL, taskId: `t-${i}` });
  assert.equal(p.claim({ channelId: CHANNEL, taskId: "t-0" }).reason, "same-key");
});

test("release frees the slot, and only that slot", () => {
  const p = pool();
  const a = p.claim({ channelId: CHANNEL, taskId: T1 });
  p.claim({ channelId: CHANNEL, taskId: T2 });
  assert.equal(p.release(a.key), true);
  assert.equal(p.size(), 1);
  assert.equal(p.isBusy({ channelId: CHANNEL, taskId: T2 }), true, "the sibling session kept running");
  assert.equal(p.claim({ channelId: CHANNEL, taskId: T1 }).ok, true, "the freed key is claimable again");
});

test("release is idempotent and never throws on a key that holds nothing", () => {
  // The spawner's retry path releases once for several attempts, and a future caller may
  // release in a finally; a double release must not free somebody else's slot.
  const p = pool();
  const a = p.claim({ channelId: CHANNEL, taskId: T1 });
  assert.equal(p.release(a.key), true);
  assert.equal(p.release(a.key), false);
  assert.equal(p.release("nothing-here"), false);
  assert.equal(p.release(undefined), false);
  assert.equal(p.size(), 0);
});

// ── (3) the global cap ───────────────────────────────────────────────────────

test("the cap is global and defaults to 4", () => {
  const p = pool();
  assert.equal(p.MAX_CONCURRENT_SESSIONS, 4);
});

test("the (cap+1)th claim defers, across channels, and one release admits exactly one", () => {
  const p = pool();
  const claims = [];
  for (let i = 0; i < p.MAX_CONCURRENT_SESSIONS; i++) {
    const c = p.claim({ channelId: `chan-${i}`, taskId: T1 }); // different CHANNELS: the cap is not per channel
    assert.equal(c.ok, true, `claim ${i} must fit under the cap`);
    claims.push(c);
  }
  assert.equal(p.atCap(), true);
  const over = p.claim({ channelId: OTHER, taskId: T2 });
  assert.equal(over.ok, false);
  assert.equal(over.reason, "at-cap");
  assert.equal(p.size(), p.MAX_CONCURRENT_SESSIONS, "a refused claim never grows the pool");

  p.release(claims[0].key);
  assert.equal(p.atCap(), false);
  assert.equal(p.claim({ channelId: OTHER, taskId: T2 }).ok, true);
  assert.equal(p.claim({ channelId: OTHER, taskId: "one-too-many" }).reason, "at-cap");
});

// ── the defer is answered by the queued-notice path ──────────────────────────

test("an at-cap defer runs the SAME queued-notice path today's busy defer runs", () => {
  // The pool refuses; the caller (trigger.js) answers a 'busy' skip with the in-thread
  // milestone before the resend bubble. queued-notice.test.mjs pins that both trigger call
  // sites exist; this composes the two REAL modules so the cap defer is shown to end in a
  // posted milestone for the deferred thread rather than in silence.
  const p = pool();
  for (let i = 0; i < p.MAX_CONCURRENT_SESSIONS; i++) p.claim({ channelId: `chan-${i}`, taskId: T1 });
  const refused = p.claim({ channelId: CHANNEL, taskId: T2 });
  assert.equal(refused.ok, false);

  const posts = [];
  const notice = new Function(
    "postTaskEvent",
    "sessionKey",
    "diag",
    `${QUEUED}\n return { announce, QUEUED_BODY };`
  )(async (e, m, kind, taskId, extra, bodyText) => { posts.push({ kind, taskId, bodyText }); return true; }, sessionKey, () => {});

  return notice.announce({ channel: { id: CHANNEL, name: "Test" }, workspaceId: "ws-1" }, { seq: 7 }, T2, "headless")
    .then((ok) => {
      assert.equal(ok, true);
      assert.deepEqual(posts, [{ kind: "task_progress", taskId: T2, bodyText: notice.QUEUED_BODY }]);
    });
});

// ── (4) accounting ───────────────────────────────────────────────────────────

test("listLiveSessions-shaped accounting: one row per key, with channel, thread and status", () => {
  const p = pool();
  p.claim({ channelId: CHANNEL, taskId: T1 });
  p.claim({ channelId: CHANNEL, taskId: T2 });
  const rows = p.listActive();

  assert.equal(rows.length, 2, "one row PER KEY, not per channel");
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ["channelId", "key", "startedAt", "status", "taskId"]);
    assert.equal(r.channelId, CHANNEL);
    assert.equal(r.status, "running");
    assert.equal(r.key, sessionKey(r.channelId, r.taskId), "the row is addressable by the shared key");
    assert.ok(Number.isFinite(r.startedAt) && r.startedAt > 0);
  }
  assert.deepEqual(rows.map((r) => r.taskId).sort(), [T1, T2].sort());

  // A pure read: the caller cannot mutate the pool through it.
  rows.length = 0;
  assert.equal(p.listActive().length, 2);
  assert.equal(p.listActive().length, p.size());
});

test("an empty pool lists nothing (and is not at the cap)", () => {
  const p = pool();
  assert.deepEqual(p.listActive(), []);
  assert.equal(p.size(), 0);
  assert.equal(p.atCap(), false);
});

// ── sessionKey has exactly ONE definition (source probe) ─────────────────────

test("sessionKey is defined once, in session-store.js, and everyone else imports it", () => {
  // Source-probed on purpose: "no second definition anywhere in main/" is a property of the
  // TREE, not of any one module's behavior, so nothing you can call proves it. Every other
  // assertion in this suite is behavioral.
  const files = readdirSync(MAIN).filter((f) => f.endsWith(".js"));
  const DEFINE = /(?:function\s+sessionKey\s*\(|(?:const|let|var)\s+sessionKey\s*=)/g;
  // This codebase documents itself heavily, so a `store.sessionKey(...)` inside a comment is
  // prose, not a call site. Strip line comments before asking who CALLS it.
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const definers = [];
  const users = [];
  for (const f of files) {
    const src = code(readFileSync(join(MAIN, f), "utf8"));
    if (src.match(DEFINE)) definers.push(f);
    if (/(?:^|[^A-Za-z.])(?:store|sessionStore)?\.?sessionKey\(/m.test(src) && f !== "session-store.js") users.push(f);
  }
  assert.deepEqual(definers, ["session-store.js"], "the (channel, thread/agent) key has ONE definition");
  assert.ok(users.length >= 4, `expected several importers, found ${users.length}`);
  for (const f of users) {
    const src = readFileSync(join(MAIN, f), "utf8");
    assert.match(src, /require\('\.\/session-store'\)/, `${f} calls sessionKey but does not import it`);
  }
});
