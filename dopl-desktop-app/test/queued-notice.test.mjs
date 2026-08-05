// The in-thread "queued, not ignored" milestone (main/queued-notice.js, 2026-07-31).
//
// The desktop defers an ACCEPTED trigger when the slot it needs is busy (engine: the same
// (channel, thread) is already running; headless: the one-active-spawn-per-CHANNEL guard),
// and until now the only answer was the RESEND bubble, which carries no thread tag and so
// never appears in the thread the requester is watching. This suite pins the milestone that
// closes that hole, and — just as load-bearing — pins that it can never post twice, never
// posts for a legacy thread id, and can never throw back into the defer path.
//
// Run: `node --test dopl-desktop-app/test/queued-notice.test.mjs`
//
// SOURCE EXTRACTION with INJECTION (the SESSION-DISPATCH idiom): main/queued-notice.js
// requires channel-post -> electron, so the BEGIN/END QUEUED-NOTICE-PURE block references
// postTaskEvent / sessionKey / diag as FREE variables. We slice it, prove it holds no
// electron/fs/require, and drive the REAL `announce` with fakes. Each harness evaluates the
// block afresh, so the module-scope `announced` set starts empty per test rather than leaking
// across them. D1 (2026-07-31): the dedupe key is no longer a local `${channel}:${task}`
// concat — it is the shared sessionKey (session-store.js), injected here, so the notice, the
// spawn pool and the engine registry all name a session the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "queued-notice.js"), "utf8");

const BEGIN = "// ─── BEGIN QUEUED-NOTICE-PURE";
const END = "// ─── END QUEUED-NOTICE-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
// A missing / inverted sentinel would slice "" and pass every negative assertion
// VACUOUSLY, so this throws rather than handing an empty block to the suite.
assert.notEqual(from, -1, "BEGIN QUEUED-NOTICE-PURE sentinel missing");
assert.notEqual(to, -1, "END QUEUED-NOTICE-PURE sentinel missing");
assert.ok(to > from, "queued-notice sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The REAL sessionKey (session-store's own pure block), so this suite drives the shipped key
// rather than a lookalike — a divergent second definition would show up here as a changed
// dedupe scope, not as a green test.
const STORE_SRC = readFileSync(join(HERE, "..", "main", "session-store.js"), "utf8");
const sFrom = STORE_SRC.indexOf("// ─── BEGIN SESSION-STORE-PURE");
const sTo = STORE_SRC.indexOf("// ─── END SESSION-STORE-PURE");
assert.ok(sFrom !== -1 && sTo > sFrom, "SESSION-STORE-PURE sentinels missing or out of order");
const { sessionKey } = new Function(
  `${STORE_SRC.slice(sFrom, sTo)}\n return { sessionKey };`
)();

const CHANNEL = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TASK = "11111111-2222-3333-4444-555555555555";
const OTHER_TASK = "99999999-8888-7777-6666-555555555555";
const LEGACY = `task-${CHANNEL}-42`;

const entry = { channel: { id: CHANNEL, name: "Test" }, workspaceId: "ws-1" };
const msg = { seq: 7 };

// Fresh module state + recorded calls per test.
function harness(over = {}) {
  const cfg = { postReturn: true, postThrows: null, ...over };
  const calls = { post: [], diag: [] };
  const postTaskEvent = async (e, m, kind, taskId, extra, bodyText, opts) => {
    calls.post.push({ e, m, kind, taskId, extra, bodyText, opts });
    if (cfg.postThrows) throw new Error(cfg.postThrows);
    return cfg.postReturn;
  };
  const diag = (...a) => calls.diag.push(a.join(" "));
  const api = new Function(
    "postTaskEvent",
    "sessionKey",
    "diag",
    `${BLOCK}\n return { announce, QUEUED_BODY, QUEUED_SUMMARY, MAX_ANNOUNCED };`
  )(postTaskEvent, sessionKey, diag);
  return { api, calls, cfg };
}

// ── containment ──────────────────────────────────────────────────────────────

test("the pure block reaches no host binding (it is driven, not stubbed around)", () => {
  for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "process."]) {
    assert.ok(!BLOCK.includes(banned), `QUEUED-NOTICE-PURE block must not reference ${banned}`);
  }
});

test("the notice never posts a body, a kind or a client id from outside this module", () => {
  // Everything on the wire is a constant here, so no untrusted message text (nor any local
  // path / machine detail) can ride into the shared channel through this path.
  const { api } = harness();
  assert.match(api.QUEUED_BODY, /^Queued on my side behind an active session/);
  assert.ok(!/[—–]/.test(api.QUEUED_BODY), "product copy carries no em dash (house voice)");
  assert.ok(!/[—–]/.test(api.QUEUED_SUMMARY));
  assert.ok(api.QUEUED_SUMMARY.length <= 200, "summary must fit the server's 200-char cap");
});

// ── the busy defer posts exactly one milestone, into the thread ──────────────

test("a busy defer posts one task_progress into the deferred thread", async () => {
  const { api, calls } = harness();
  const ok = await api.announce(entry, msg, TASK, "session");

  assert.equal(ok, true);
  assert.equal(calls.post.length, 1);
  const p = calls.post[0];
  assert.equal(p.kind, "task_progress");
  assert.equal(p.taskId, TASK, "the milestone threads under the DEFERRED thread's uuid");
  assert.equal(p.bodyText, api.QUEUED_BODY);
  assert.equal(p.opts.summary, api.QUEUED_SUMMARY);
  assert.equal(p.opts.clientMsgId, `queued-${TASK}`, "idempotency keys on the THREAD, not the seq");
  assert.equal(p.extra, undefined, "no extra metadata rides along");
  assert.equal(p.e, entry);
});

test("the client id is derived from the thread, so a resend under a new seq dedupes", async () => {
  // The peer answers RESEND by resending: same thread, NEW seq. A seq-derived id would post
  // a second milestone; the thread-derived one collides with the first server-side.
  const { api, calls } = harness();
  await api.announce(entry, { seq: 7 }, TASK, "session");
  const first = calls.post[0].opts.clientMsgId;
  const { api: api2, calls: calls2 } = harness();
  await api2.announce(entry, { seq: 999 }, TASK, "headless");
  assert.equal(calls2.post[0].opts.clientMsgId, first);
});

test("exactly ONE post per (channel, thread): a second defer does not even attempt one", async () => {
  const { api, calls } = harness();
  assert.equal(await api.announce(entry, msg, TASK, "session"), true);
  assert.equal(await api.announce(entry, msg, TASK, "session"), false);
  assert.equal(await api.announce(entry, { seq: 12 }, TASK, "headless"), false);
  assert.equal(calls.post.length, 1, "the local guard blocks the attempt, not just the duplicate");
  assert.ok(calls.diag.some((l) => l.includes("already announced")));
});

test("the guard is per (channel, thread), not per channel", async () => {
  const { api, calls } = harness();
  await api.announce(entry, msg, TASK, "session");
  await api.announce(entry, msg, OTHER_TASK, "session");
  assert.deepEqual(calls.post.map((p) => p.taskId), [TASK, OTHER_TASK]);

  // ...and the same thread in a DIFFERENT channel is its own episode.
  const other = { channel: { id: "ffffffff-0000-1111-2222-333333333333", name: "Other" }, workspaceId: "ws-1" };
  await api.announce(other, msg, TASK, "session");
  assert.equal(calls.post.length, 3);
});

test("a claimed thread stays claimed even when the post failed (one attempt, never two)", async () => {
  const { api, calls } = harness({ postReturn: false });
  assert.equal(await api.announce(entry, msg, TASK, "session"), false);
  assert.equal(await api.announce(entry, msg, TASK, "session"), false);
  assert.equal(calls.post.length, 1);
  assert.ok(calls.diag.some((l) => l.includes("post failed")));
});

// ── the skips ────────────────────────────────────────────────────────────────

test("a LEGACY task-<channel>-<seq> id is skipped: it groups into no thread", async () => {
  const { api, calls } = harness();
  assert.equal(await api.announce(entry, msg, LEGACY, "headless"), false);
  assert.equal(calls.post.length, 0);
  assert.ok(calls.diag.some((l) => l.includes("not a first-class thread id")));
});

test("an absent / malformed thread id is skipped too, and says so once", async () => {
  for (const id of ["", null, undefined, "not-a-uuid", `${TASK}-extra`]) {
    const { api, calls } = harness();
    assert.equal(await api.announce(entry, msg, id, "session"), false, `id ${String(id)}`);
    assert.equal(calls.post.length, 0);
    assert.equal(calls.diag.length, 1);
  }
});

// ── fail-soft ────────────────────────────────────────────────────────────────

test("a THROWING post is swallowed: the defer path can never be broken by this notice", async () => {
  const { api, calls } = harness({ postThrows: "socket hang up" });
  const ok = await api.announce(entry, msg, TASK, "session"); // must not reject
  assert.equal(ok, false);
  assert.ok(calls.diag.some((l) => l.includes("queued notice error")));
});

test("every path logs exactly one diag line, and never a token-shaped value", async () => {
  // GUI apps have no console: listener.log is the only visibility, and a defer that logged
  // nothing is exactly the invisibility this change exists to end.
  for (const cfg of [{}, { postReturn: false }, { postThrows: "boom" }]) {
    const { api, calls } = harness(cfg);
    await api.announce(entry, msg, TASK, "session");
    assert.equal(calls.diag.length, 1, JSON.stringify(cfg));
    assert.ok(calls.diag[0].includes("session"), "the defer point is named in the log");
    assert.ok(!calls.diag[0].includes(TASK), "the full thread id is truncated, like every other diag");
  }
});

// ── the call sites (static): both defers announce, and nothing else does ──────

test("both busy defers announce, ahead of the RESEND bubble", () => {
  // §2 SPLIT (2026-08-04): the HEADLESS FALLBACK lane moved to trigger-headless.js, so
  // the two defer sites now live in two files — the SESSION lane's in trigger.js, the
  // headless one next door. Read both: the invariant is about the pair of defers, not
  // about which file they happen to sit in, and scanning only trigger.js after the
  // split would have quietly stopped covering half of it.
  const trigger = readFileSync(join(HERE, "..", "main", "trigger.js"), "utf8");
  const headless = readFileSync(join(HERE, "..", "main", "trigger-headless.js"), "utf8");
  const both = [trigger, headless];
  const sites = both.flatMap((src) => src.match(/queued\.announce\([^)]*\)/g) || []);
  assert.equal(sites.length, 2, "one per busy defer (engine session + headless spawner)");

  // The engine defer threads under the FIRST-CLASS id when the record carries one.
  assert.ok(trigger.includes("queued.announce(entry, m, rec.taskId || taskId, 'session')"));
  assert.ok(headless.includes("queued.announce(entry, m, taskId, 'headless')"));

  // Ordered: the milestone lands in the thread BEFORE the untagged resend bubble, so a
  // requester reading top-down sees the reason before the ask.
  for (const src of both) {
    for (const site of src.match(/queued\.announce\([^)]*\)/g) || []) {
      const at = src.indexOf(site);
      // P1-5: the bubble goes out through `postCourtesy` now (intent "chat", so a
      // no-op cannot trigger the peer). Same post, same position, named for what
      // it is.
      const resend = src.indexOf("postCourtesy(entry, m, RESEND)", at);
      assert.ok(resend > at && resend - at < 200, `${site} must precede its RESEND post`);
    }
  }

  // NOT on the declined / auth-held / fyi paths — those are answers, not defers.
  const denied = trigger.slice(trigger.indexOf("AUTH_HELD_REPLY)"));
  assert.ok(!denied.slice(0, 200).includes("queued.announce"));
});
