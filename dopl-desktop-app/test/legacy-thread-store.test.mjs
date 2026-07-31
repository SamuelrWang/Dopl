// Q11 — the legacy-reply registry survives a restart.
//
// WHAT IT COSTS WHEN IT DOES NOT. The registry is the only local record of a
// LEGACY thread this machine opened (see legacy-thread-reply.test.mjs for why the
// wire cannot say it). It was memory-only on the argument that a miss costs only
// a consent prompt — but the miss it actually produced was a SPURIOUS prompt:
// quit the app mid-exchange (or let an update install on quit, which is exactly
// what electron-updater does) and the peer's reply to a question this operator
// already asked came back looking like a brand-new request. One restart, one
// bogus consent, every time.
//
// So the registry round-trips through electron-store. THE PERSISTENCE IS
// INJECTED, not required: targeting.js has to stay dependency-free because the
// classify truth tables slice its LEGACY-THREADS block into a bare `new Function`
// scope. With no store the behavior is byte-for-byte the old in-memory registry.
//
// WHAT MUST HOLD ACROSS THE ROUND TRIP, and is pinned here: the 6h TTL, the
// 500-entry cap, the openers-only rule, the owner binding, the injectable clock,
// and the fail-safe direction — a record that does not come back cleanly is
// DROPPED, which costs a consent prompt, never a swallowed message.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("targeting.js");
const require = createRequire(import.meta.url);
const {
  LEGACY_THREAD_CAP,
  LEGACY_THREAD_TTL_MS,
  LEGACY_THREAD_KEY,
} = require("../main/targeting.js");

// A fresh registry per test: the block is sliced whole (it carries module state),
// exactly as classify.test.mjs does, so no test can leak entries into another.
const LEGACY = SRC.slice(
  SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  SRC.indexOf("// ─── END LEGACY-THREADS")
);
function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in targeting.js`);
  let depth = 0;
  let i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) { i++; break; }
  }
  return SRC.slice(start, i);
}
const boot = () =>
  new Function(
    `${extractFn("metaStr")}\n${LEGACY}\n` +
      `return { legacyThreadId, noteMyLegacyThread, knownLegacyReply, useLegacyThreadStore };`
  )();

// The narrowest possible stand-in for electron-store: get/set over one key. The
// registry duck-types it, so this IS the production contract.
function fakeStore(seed) {
  const data = seed === undefined ? {} : { [LEGACY_THREAD_KEY]: seed };
  return {
    data,
    writes: 0,
    get(k) { return data[k]; },
    set(k, v) { data[k] = v; this.writes++; },
  };
}

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const THIRD = "33333333-3333-3333-3333-333333333333";
const T0 = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const entryFor = (channelId) => ({ channel: { id: channelId, name: "General", memberCount: 2 } });
const ask = (seq, to = PEER) => ({ kind: "message", seq, authorUserId: ME, metadata: { to_user_id: to } });
const reply = (taskId, author = PEER) => ({
  kind: "message", seq: 99, authorUserId: author, authorKind: "agent",
  metadata: { to_user_id: ME, taskId },
});

// A restart: a NEW module scope handed the SAME store file.
function restart(store, nowMs) {
  const app = boot();
  const adopted = app.useLegacyThreadStore(store, nowMs);
  return { app, adopted };
}

// ── the round trip ───────────────────────────────────────────────────────────

test("an in-flight exchange survives a restart: no spurious consent", () => {
  const ch = "ch-restart-1";
  const store = fakeStore();
  const first = boot();
  first.useLegacyThreadStore(store, T0);
  first.noteMyLegacyThread(ask(7), entryFor(ch), ME, T0);
  const id = first.legacyThreadId(ch, 7);
  assert.equal(first.knownLegacyReply(reply(id), ME, T0), true);

  // …the app quits (or an update installs on quit) and comes back.
  const { app, adopted } = restart(store, T0 + HOUR);
  assert.equal(adopted, 1);
  assert.equal(app.knownLegacyReply(reply(id), ME, T0 + HOUR), true,
    "the peer's reply is still recognized as an answer to MY request");
});

test("with NO store injected the registry is exactly the old in-memory one", () => {
  const ch = "ch-nostore";
  const a = boot();
  a.noteMyLegacyThread(ask(7), entryFor(ch), ME, T0);
  assert.equal(a.knownLegacyReply(reply(a.legacyThreadId(ch, 7)), ME, T0), true);
  // A new scope with nothing injected remembers nothing — today's behavior.
  const b = boot();
  assert.equal(b.knownLegacyReply(reply(b.legacyThreadId(ch, 7)), ME, T0), false);
  // …and an unusable "store" is treated as no store at all, never as a crash.
  for (const junk of [null, undefined, {}, { get: 1, set: 2 }, "config.json"]) {
    const c = boot();
    assert.equal(c.useLegacyThreadStore(junk, T0), 0, JSON.stringify(junk));
    assert.doesNotThrow(() => c.noteMyLegacyThread(ask(7), entryFor(ch), ME, T0));
  }
});

// ── the TTL, across the boundary ─────────────────────────────────────────────

test("expired entries are PURGED on load, and the purge is itself durable", () => {
  const ch = "ch-ttl-load";
  const store = fakeStore();
  const first = boot();
  first.useLegacyThreadStore(store, T0);
  first.noteMyLegacyThread(ask(7), entryFor(ch), ME, T0); // will expire
  first.noteMyLegacyThread(ask(8), entryFor(ch), ME, T0 + 5 * HOUR); // will not

  const later = T0 + 7 * HOUR; // 7h: seq 7 is past the 6h TTL, seq 8 is not
  const { app, adopted } = restart(store, later);
  assert.equal(adopted, 1);
  assert.equal(app.knownLegacyReply(reply(app.legacyThreadId(ch, 7)), ME, later), false);
  assert.equal(app.knownLegacyReply(reply(app.legacyThreadId(ch, 8)), ME, later), true);
  // The dead record is gone from DISK too — a second restart cannot resurrect it
  // (a banked id must not be replayable by rewinding the clock).
  assert.deepEqual(store.data[LEGACY_THREAD_KEY].map((r) => r.id), [app.legacyThreadId(ch, 8)]);
  const again = restart(store, T0);
  assert.equal(again.adopted, 1);
});

test("the TTL boundary is the same on both sides of a restart", () => {
  const ch = "ch-ttl-edge";
  const store = fakeStore();
  const first = boot();
  first.useLegacyThreadStore(store, T0);
  first.noteMyLegacyThread(ask(7), entryFor(ch), ME, T0);
  const id = first.legacyThreadId(ch, 7);
  // Exactly AT the TTL survives; one ms past does not. (Same as in memory.)
  assert.equal(restart(store, T0 + LEGACY_THREAD_TTL_MS).adopted, 1);
  assert.equal(restart(store, T0 + LEGACY_THREAD_TTL_MS + 1).adopted, 0);
  // …and the loaded entry still expires on READ, with the injected clock.
  const { app } = restart(fakeStore([{ id, owner: ME, target: PEER, at: T0 }]), T0);
  assert.equal(app.knownLegacyReply(reply(id), ME, T0 + LEGACY_THREAD_TTL_MS), true);
  assert.equal(app.knownLegacyReply(reply(id), ME, T0 + LEGACY_THREAD_TTL_MS + 1), false);
});

// ── the cap, across the boundary ─────────────────────────────────────────────

test("the 500-entry cap holds on load, oldest dropped first", () => {
  const ch = "ch-cap-load";
  const id = (seq) => `task-${ch}-${seq}`;
  // A store file with MORE than the cap (an older build, a hand edit, a future
  // build with a bigger cap). Age order is array order.
  const rows = [];
  for (let seq = 1; seq <= LEGACY_THREAD_CAP + 20; seq++) {
    rows.push({ id: id(seq), owner: ME, target: PEER, at: T0 + seq });
  }
  const store = fakeStore(rows);
  const { app, adopted } = restart(store, T0);
  assert.equal(adopted, LEGACY_THREAD_CAP);
  assert.equal(app.knownLegacyReply(reply(id(1)), ME, T0), false, "the oldest 20 were dropped");
  assert.equal(app.knownLegacyReply(reply(id(20)), ME, T0), false);
  assert.equal(app.knownLegacyReply(reply(id(21)), ME, T0), true, "the newest survive");
  assert.equal(store.data[LEGACY_THREAD_KEY].length, LEGACY_THREAD_CAP, "trimmed on disk too");
});

test("eviction still works after a reload (age order survives the round trip)", () => {
  const ch = "ch-cap-live";
  const store = fakeStore();
  const first = boot();
  first.useLegacyThreadStore(store, T0);
  for (let seq = 1; seq <= LEGACY_THREAD_CAP; seq++) {
    first.noteMyLegacyThread(ask(seq), entryFor(ch), ME, T0 + seq);
  }
  const { app } = restart(store, T0);
  // One more push past the cap evicts the OLDEST, which is only true if the
  // reload rebuilt the queue in age order rather than reshuffling it.
  app.noteMyLegacyThread(ask(LEGACY_THREAD_CAP + 1), entryFor(ch), ME, T0 + LEGACY_THREAD_CAP + 1);
  assert.equal(app.knownLegacyReply(reply(app.legacyThreadId(ch, 1)), ME, T0), false);
  assert.equal(
    app.knownLegacyReply(reply(app.legacyThreadId(ch, LEGACY_THREAD_CAP + 1)), ME, T0),
    true
  );
});

// ── what a store file may NOT smuggle in ─────────────────────────────────────

test("a malformed row is DROPPED, never repaired (fail-safe: a miss costs a prompt)", () => {
  const good = { id: "task-ch-1", owner: ME, target: PEER, at: T0 };
  const store = fakeStore([
    null,
    "task-ch-2",
    { id: "", owner: ME, target: PEER, at: T0 },
    { id: "task-ch-3", owner: "", target: PEER, at: T0 },
    { id: "task-ch-4", owner: ME, target: "", at: T0 },
    { id: "task-ch-5", owner: ME, target: PEER, at: "yesterday" },
    { id: "task-ch-6", owner: ME, target: PEER },
    { id: "task-ch-7", owner: { sub: ME }, target: PEER, at: T0 },
    good,
  ]);
  const { app, adopted } = restart(store, T0);
  assert.equal(adopted, 1, "only the well-formed row is adopted");
  assert.equal(app.knownLegacyReply(reply(good.id), ME, T0), true);
  for (const id of ["task-ch-2", "task-ch-3", "task-ch-4", "task-ch-5", "task-ch-6", "task-ch-7"]) {
    assert.equal(app.knownLegacyReply(reply(id), ME, T0), false, id);
  }
  // A file that is not a list at all is simply nothing.
  assert.equal(restart(fakeStore({ nope: true }), T0).adopted, 0);
  assert.equal(restart(fakeStore("corrupt"), T0).adopted, 0);
});

test("the OWNER binding survives, so another account never inherits my threads", () => {
  const store = fakeStore([{ id: "task-ch-9", owner: ME, target: PEER, at: T0 }]);
  const { app } = restart(store, T0);
  assert.equal(app.knownLegacyReply(reply("task-ch-9"), THIRD, T0), false, "signed in as someone else");
  assert.equal(app.knownLegacyReply(reply("task-ch-9", THIRD), ME, T0), false, "wrong responder");
  assert.equal(app.knownLegacyReply(reply("task-ch-9"), ME, T0), true);
});

test("OPENERS ONLY still holds: a continuation writes nothing to disk", () => {
  const ch = "ch-opener-store";
  const store = fakeStore();
  const app = boot();
  app.useLegacyThreadStore(store, T0);
  const before = store.writes;
  app.noteMyLegacyThread(
    { kind: "message", seq: 9, authorUserId: ME, metadata: { to_user_id: PEER, taskId: "task-x-3" } },
    entryFor(ch), ME, T0
  );
  app.noteMyLegacyThread({ kind: "message", seq: 10, authorUserId: ME, metadata: {} }, entryFor(ch), ME, T0);
  assert.equal(store.writes, before, "no opener, no write — the disk is not on the hot path");
  assert.deepEqual(store.data[LEGACY_THREAD_KEY], []);
});

test("a store that THROWS degrades to memory instead of breaking targeting", () => {
  const ch = "ch-throw";
  const angry = {
    get() { throw new Error("EACCES"); },
    set() { throw new Error("ENOSPC"); },
  };
  const app = boot();
  assert.doesNotThrow(() => app.useLegacyThreadStore(angry, T0));
  assert.doesNotThrow(() => app.noteMyLegacyThread(ask(7), entryFor(ch), ME, T0));
  // Durability is best-effort; the classification it feeds is not allowed to fail.
  assert.equal(app.knownLegacyReply(reply(app.legacyThreadId(ch, 7)), ME, T0), true);
});

// ── the constraint that made all of this awkward, restated ───────────────────

test("targeting.js is STILL dependency-free, so the truth tables can slice it", () => {
  assert.equal(/require\(/.test(SRC), false, "targeting.js must require nothing at all");
  // The block is evaluated in a BARE `new Function` scope by five harnesses, so
  // it may reach for nothing a plain scope does not have — the whole reason the
  // store is injected instead of constructed here.
  for (const forbidden of [/require\(/, /\bmodule\./, /\bprocess\./, /\b__dirname\b/]) {
    assert.equal(forbidden.test(LEGACY), false, `LEGACY-THREADS reaches for ${forbidden}`);
  }
  // The store arrives through the seam, and index.js is what hands it over.
  assert.match(SRC, /function useLegacyThreadStore\(store, nowMs\)/);
  assert.match(M("index.js"), /targeting\.useLegacyThreadStore\(store\)/);
});
