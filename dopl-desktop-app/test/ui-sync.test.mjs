// Phase 3 — the bundled SPA's live-update feed: HOW IT BEHAVES (main/ui-sync.js).
//
// §2 SPLIT (2026-08-06). This file sat at EXACTLY 500 lines and the next assertion added to
// it failed lint. The half that reads the DATABASE — the table list checked against
// supabase/migrations, the publication cross-check, the renderer-coverage union and the
// channels exemption, plus the ~40 lines of SQL parsing that serve only those — moved to
// `ui-sync-tables.test.mjs`. What is left reads nothing but the sliced pure block, which is
// why the migration helpers went with the other half rather than being shared.
//
// THE FAILURES THIS HALF LOCKS OUT:
//   4. A REUSED TOPIC RETURNS A CORPSE whose `subscribe()` silently no-ops.
//   5. AN ANON JOIN BREAKS PUSH FOR EVERY CLIENT (realtime.js's CREDENTIAL RULE),
//      and a hung token read strands the join latch with no retry armed.
//   6. A BURST BECOMES A REFETCH STORM — one signal per (workspace, table), and ONE
//      empty-table catch-up event rather than one per table.
//
// The numbering is deliberately NOT renumbered: 1-3 are in the sibling file, and the
// numbers are referenced from ui-sync.js's own comments.
//
// WHY SOURCE EXTRACTION: ui-sync.js is CommonJS and requires @supabase/realtime-js +
// ws + electron, so it cannot be imported under `node --test`. Its decision core is
// fenced as UI-SYNC-PURE and sliced verbatim; the shell is covered by assertions over
// its real source (the auth-tokens.test.mjs pattern).
//
// Run: `node --test dopl-desktop-app/test/ui-sync.test.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "ui-sync.js"), "utf8");
// ⚠ THE PURE CORE MOVED to main/ui-sync-core.js on 2026-08-18 (wiring plan Phase 10):
// ui-sync.js sat at exactly the 500-line cap, so the fan-out could not be written until
// something moved. The sentinels came with it byte for byte; nothing inside changed.
const CORE = readFileSync(join(HERE, "..", "main", "ui-sync-core.js"), "utf8");
const PURE = between(CORE, "// ─── BEGIN UI-SYNC-PURE", "// ─── END UI-SYNC-PURE",
  "ui-sync pure block");

const {
  SYNC_TABLES, LISTENER_OWNED_TABLES,
  COALESCE_MS, RECONNECT_DELAYS_MS, AUTH_RECHECK_MS, AUTH_READ_TIMEOUT_MS,
  nextTopic, backoffMs, payloadWorkspaceId, shouldForward,
  createSyncCoalescer, catchUpBatch,
} = new Function(
  `${PURE}
   return { SYNC_TABLES, LISTENER_OWNED_TABLES, COALESCE_MS, RECONNECT_DELAYS_MS,
            AUTH_RECHECK_MS, AUTH_READ_TIMEOUT_MS, nextTopic, backoffMs,
            payloadWorkspaceId, shouldForward,
            createSyncCoalescer, catchUpBatch };`
)();

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const live = (o) => ({ started: true, watched: WS, generation: 7, ...o });
const frame = (o) => ({ workspaceId: WS, table: "skills", generation: 7, ...o });

// ── TOPIC GENERATION (failure mode 3) ───────────────────────────────────────

test("a topic is never reused, not even for the same workspace", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(nextTopic(i % 2 ? WS : WS2));
  assert.equal(seen.size, 200, "a reused topic returns realtime-js's leaving corpse");
  assert.notEqual(nextTopic(WS), nextTopic(WS2), "two workspaces must not collide");
});

test("the topic names its workspace, advances, and rides a MODULE-scoped counter", () => {
  const x = nextTopic(WS);
  const y = nextTopic(WS);
  assert.match(x, /^dopl-ui-sync-/);
  assert.ok(x.includes(WS), "the topic must name the workspace it joins");
  const gen = (t) => Number(/-g(\d+)$/.exec(t)[1]);
  assert.ok(gen(y) > gen(x), "the generation must advance");
  // Per-connection, the counter would restart at 1 after stop()/start() and mint a
  // byte-identical topic while realtime-js still holds the leaving channel.
  assert.match(PURE, /^let topicSeq = 1;$/m);
  assert.match(fnOf(CORE, "nextTopic"), /topicSeq\+\+/, "the topic consumes the shared counter");
});

// ── BACKOFF LADDER ──────────────────────────────────────────────────────────

test("the reconnect ladder grows and then holds its ceiling", () => {
  assert.deepEqual(RECONNECT_DELAYS_MS, [500, 1000, 2000, 4000, 8000, 15000]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(backoffMs), RECONNECT_DELAYS_MS);
  for (const n of [6, 7, 20, 500]) assert.equal(backoffMs(n), 15000);
});

test("the ladder is monotonic, never zero, and NaN-proof", () => {
  let prev = 0;
  for (let n = 0; n <= 12; n++) {
    const v = backoffMs(n);
    assert.ok(v > 0, `attempt ${n} scheduled at 0 — that is a reconnect storm (F-072)`);
    assert.ok(v >= prev, `attempt ${n} (${v}) < previous (${prev})`);
    prev = v;
  }
  for (const bad of [null, undefined, NaN, -3, "x", {}]) {
    assert.equal(backoffMs(bad), 500, `attempt=${String(bad)}`);
  }
});

// ── COALESCING (failure mode 5) ─────────────────────────────────────────────

// A fake clock plus a live coalescer wired to a `sent` log.
function coalescing(onFlush) {
  let armed = null;
  let arms = 0;
  const sent = [];
  const api = {
    setTimeout: (fn) => { arms += 1; armed = fn; return {}; },
    clearTimeout: () => { armed = null; },
  };
  const c = createSyncCoalescer(COALESCE_MS, onFlush || ((i) => sent.push(i)), api);
  return { c, sent, arms: () => arms, pending: () => armed !== null,
    run() { const fn = armed; armed = null; if (fn) fn(); } };
}

test("a burst on ONE (workspace, table) collapses to a single send", () => {
  assert.equal(COALESCE_MS, 250, "long enough for a transaction, short enough to feel live");
  const t = coalescing();
  for (let i = 0; i < 40; i++) t.c.mark(WS, "knowledge_entries");
  assert.equal(t.sent.length, 0, "nothing may be sent before the window closes");
  assert.equal(t.arms(), 1, "one timer per window, not one per event");
  t.run();
  assert.deepEqual(t.sent, [{ workspaceId: WS, table: "knowledge_entries" }]);
});

test("one transaction across six tables is ONE flush carrying six signals", () => {
  const t = coalescing();
  const tables = SYNC_TABLES.slice(0, 6);
  for (const x of tables) t.c.mark(WS, x);
  for (const x of tables) t.c.mark(WS, x); // the burst repeats
  assert.equal(t.arms(), 1);
  t.run();
  assert.deepEqual(t.sent.map((x) => x.table), tables);
});

test("workspaces are distinct keys, and a new window re-arms after a flush", () => {
  const t = coalescing();
  t.c.mark(WS, "chats");
  t.c.mark(WS2, "chats");
  t.run();
  assert.deepEqual(t.sent.map((x) => x.workspaceId).sort(), [WS, WS2].sort());
  t.c.mark(WS, "skills");
  assert.equal(t.arms(), 2, "the coalescer must re-arm, not go silent after one burst");
});

test("cancel() drops the queue WITHOUT sending — a switched workspace must not leak", () => {
  const t = coalescing();
  t.c.mark(WS, "skills");
  t.c.mark(WS, "chats");
  assert.equal(t.c.size(), 2);
  t.c.cancel();
  assert.equal(t.c.size(), 0);
  assert.equal(t.pending(), false, "the timer must be disarmed, not merely emptied");
  t.run();
  assert.deepEqual(t.sent, [], "the old workspace's signals must never reach the new view");
});

test("one throwing send does not starve the rest of the batch", () => {
  const got = [];
  const t = coalescing((i) => {
    if (i.table === "skills") throw new Error("window gone");
    got.push(i.table);
  });
  for (const x of ["skills", "chats", "workflows"]) t.c.mark(WS, x);
  t.run();
  assert.deepEqual(got, ["chats", "workflows"]);
});

test("a mark with no workspace or no table is ignored, never queued as undefined", () => {
  const t = coalescing();
  for (const [w, x] of [[null, "skills"], [WS, null], [undefined, undefined], ["", "skills"]]) t.c.mark(w, x);
  assert.equal(t.c.size(), 0);
  assert.equal(t.arms(), 0);
});

// ── PAYLOAD READING: one field, and only as a guard ─────────────────────────

test("the workspace id is read from whichever record shape realtime-js delivers", () => {
  for (const k of ["new", "record", "old", "old_record"]) {
    assert.equal(payloadWorkspaceId({ [k]: { workspace_id: WS } }), WS, k);
  }
  assert.equal(payloadWorkspaceId({ new: { workspace_id: WS }, old: { workspace_id: WS2 } }), WS);
  // null is not an error: under the default replica identity a DELETE's old record
  // is the primary key alone.
  const bad = [null, undefined, {}, { new: {} }, { new: { workspace_id: 42 } },
    { new: { workspace_id: "" } }];
  for (const x of bad) assert.equal(payloadWorkspaceId(x), null, JSON.stringify(x));
});

test("nothing but workspace_id is ever read out of a payload", () => {
  const fn = fnOf(CORE, "payloadWorkspaceId");
  const fields = [...fn.matchAll(/rec && rec\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(fields)], ["workspace_id"]);
});

// ── THE FORWARDING GATE ─────────────────────────────────────────────────────

test("a live frame for the watched workspace is forwarded", () => {
  assert.equal(shouldForward(live(), frame()), true);
  // An id-less payload is forwarded too: the server filter already scoped the
  // binding, so that is a replica-identity artifact (a DELETE), not an open event.
  assert.equal(shouldForward(live(), frame({ workspaceId: null })), true);
  assert.equal(shouldForward(live(), frame({ workspaceId: undefined })), true);
});

test("a frame from a channel we already left is REFUSED (generation guard)", () => {
  // The leave settles asynchronously, so the old channel delivers for a beat;
  // attributing that to the workspace just switched TO is a wrong-workspace refetch.
  assert.equal(shouldForward(live({ generation: 8 }), frame({ generation: 7 })), false);
  assert.equal(shouldForward(live({ generation: 7 }), frame({ generation: 8 })), false);
});

test("teardown, a foreign workspace, and an unbound table are all refused", () => {
  assert.equal(shouldForward(live({ started: false }), frame()), false);
  assert.equal(shouldForward(live({ watched: null }), frame()), false);
  assert.equal(shouldForward(null, frame()), false);
  assert.equal(shouldForward(live(), null), false);
  assert.equal(shouldForward(live(), frame({ workspaceId: WS2 })), false);
  // The channels exemption is refused on the way OUT too, not just never bound.
  for (const t of [...LISTENER_OWNED_TABLES, "workspaces", "", null, undefined]) {
    assert.equal(shouldForward(live(), frame({ table: t })), false, `table=${String(t)}`);
  }
});

// ── CATCH-UP ON (RE)SUBSCRIBE ───────────────────────────────────────────────

test("a fresh SUBSCRIBED sends ONE event with an empty table, not one per table", () => {
  // The registry's empty-table branch fires EVERY subscriber, so the per-table batch
  // cost the workflows page five refetches per reconnect — on the DB we are unloading.
  assert.deepEqual(catchUpBatch(WS), [{ workspaceId: WS, table: "" }]);
  for (const bad of [null, undefined, ""]) assert.deepEqual(catchUpBatch(bad), []);
});

test("the renderer really implements the empty-table fan-out this relies on", () => {
  // The contract lives in the OTHER half; tightening it silently kills catch-up.
  const reg = readFileSync(
    join(HERE, "..", "..", "src", "shared", "realtime", "shared-channel-registry.ts"),
    "utf8"
  );
  assert.match(reg, /if \(e\.table && !s\.tables\.has\(e\.table\)\) continue/,
    "the registry no longer treats an empty table as fire-everyone");
});

// ── THE SHELL: what the pure core is actually wired to ──────────────────────

test("every binding is attached BEFORE subscribe, on a generation-unique topic", () => {
  // `.on()` after `.subscribe()` throws — v2 fixes the binding list at JOIN time.
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /client\.channel\(nextTopic\(wsId\)\)/, "no literal/reused topic string");
  assert.ok(
    orderOf(fn, "chan.on(", "chan.subscribe(", "connect"),
    "a late .on() throws under realtime-js v2"
  );
  assert.match(fn, /filter: `workspace_id=eq\.\$\{wsId\}`/, "the join must be workspace-scoped");
  assert.match(fn, /chan\.subscribe\(\(status, err\)/, "the join-error payload is the 2nd arg");
});

test("connect() joins in the right order, single-flight, and fails closed", () => {
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /await applyAuth\(/, "fire-and-forget setAuth is a subscribe-before-auth race");
  assert.ok(orderOf(fn, "await applyAuth(", "client.channel(", "connect"));
  assert.match(fn, /if \(!authed\) \{ scheduleReconnect\(\); return; \}/,
    "no credential must mean NO JOIN — an anon join breaks push for every client");
  assert.match(fn, /if \(!started \|\| !watched \|\| connecting\) return;/);
  assert.match(fn, /watched !== wsId/, "the awaited continuation must re-check the target");
  assert.match(fn, /if \(started && watched && !channel && !reconnectTimer\) connect\(\)/,
    "a watch() that raced the auth await must be picked up, not stranded");
});

test("applyAuth fails closed, awaits setAuth, and never retains the token", () => {
  const fn = fnOf(SRC, "applyAuth");
  assert.ok(orderOf(fn, "if (!token)", "await client.setAuth(", "applyAuth"),
    "the missing-credential return must come BEFORE any setAuth");
  assert.match(fn, /await client\.setAuth\(token\)/);
  assert.ok(!/token\s*=\s*token/.test(SRC), "the token must never be retained module-side");
  // …and no credential may reach the plaintext log.
  for (const line of SRC.match(/\bdiag\([^;]*\)/g) || []) {
    assert.ok(!/\btoken\b|access_token|setAuth\(token/.test(line), `logs a credential: ${line}`);
  }
  // Re-read on every join, on the backstop recheck, and via refreshAuth — a stale JWT
  // was the other half of the 1.7.6 field failure.
  assert.match(fnOf(SRC, "connect"), /applyAuth\('join'\)/);
  assert.match(fnOf(SRC, "armAuthRecheck"), /applyAuth\('rotate'\)/);
  assert.ok(AUTH_RECHECK_MS > 0 && AUTH_RECHECK_MS <= 15 * 60 * 1000,
    `AUTH_RECHECK_MS=${AUTH_RECHECK_MS} must be well inside a token lifetime`);
});

test("a (re)SUBSCRIBED sends the catch-up; an error status climbs the ladder", () => {
  const fn = fnOf(SRC, "onStatus");
  assert.match(fn, /if \(!started \|\| myGen !== generation\) return;/,
    "our own teardown CLOSED must not read as a live failure");
  assert.match(fn, /sendCatchUp\(watched\)/);
  assert.match(fn, /attempt = 0/, "a good join resets the ladder");
  assert.match(fn, /CHANNEL_ERROR[\s\S]*scheduleReconnect\(\)/);
  assert.match(fn, /describeSubscribeError\(err\)/, "a bare CHANNEL_ERROR names nothing");
});

test("the renderer send is window-guarded and resolves the windows at SEND time", () => {
  // ⚠ FANS OUT SINCE 2026-08-18 (wiring plan Phase 10). This pushed to ONE webContents, so
  // the pop-out thread window would have shown a transcript that simply stopped updating,
  // with no error and nothing in the log — the silent-staleness failure INVARIANTS §11
  // names. The targets are main/app-windows.js's registry, the same set the sender guards
  // are bound to, so "a window main owns" means one thing in both directions.
  const fn = fnOf(SRC, "sendToWindows");
  assert.match(fn, /getWindowsFn \? getWindowsFn\(\) : null/,
    "the shell is rebuilt on reopen and a pop-out can appear at any moment");
  assert.match(fn, /for \(const win of wins\)/, "every app window, not just the first");
  assert.match(fn, /win\.isDestroyed\(\)/);
  assert.match(fn, /wc\.isDestroyed\(\)/, "webContents can die independently of the window");
  assert.match(fn, /wc\.send\(SYNC_EVENT, \{ workspaceId: item\.workspaceId, table: item\.table \}\)/);
  assert.match(fn, /return sent > 0/, "one dead window must not swallow the rest of the fan-out");
  assert.ok(!/\breturn false;\s*\n\s*\}\s*$/.test(fn.slice(fn.indexOf("for (const win"))),
    "a per-window failure continues the loop rather than aborting it");
  assert.match(SRC, /const SYNC_EVENT = 'dopl:sync-event';/);
});

test("the doorbell reaches EVERY app window, and a dead one does not swallow the rest", () => {
  // Driven, not grepped (INVARIANTS §14): the function is lifted into a bare scope with its
  // three free names injected. This is the assertion that would have gone red on the
  // pre-Phase-10 single-window send, which is the whole point of writing it.
  const sendToWindows = new Function(
    "getWindowsFn", "SYNC_EVENT", "diag",
    `${fnOf(SRC, "sendToWindows")}\n return sendToWindows;`
  );
  const mkWin = (log, { dead = false, wcDead = false, throws = false } = {}) => ({
    isDestroyed: () => dead,
    webContents: {
      isDestroyed: () => wcDead,
      send: (channel, payload) => {
        if (throws) throw new Error("render process gone");
        log.push({ channel, payload });
      },
    },
  });
  const shell = [];
  const popout = [];
  const wins = [
    mkWin([], { dead: true }),
    mkWin(shell),
    mkWin([], { wcDead: true }),
    mkWin([], { throws: true }),
    mkWin(popout),
  ];
  const item = { workspaceId: WS, table: "channel_messages" };
  const send = sendToWindows(() => wins, "dopl:sync-event", () => {});
  assert.equal(send(item), true, "at least one window took it");
  assert.deepEqual(shell, [{ channel: "dopl:sync-event", payload: item }], "the shell");
  assert.deepEqual(popout, [{ channel: "dopl:sync-event", payload: item }],
    "and the pop-out, PAST a destroyed window and a throwing one");

  // No windows at all (headless / pre-launch) is a quiet false, never a throw.
  assert.equal(sendToWindows(() => [], "dopl:sync-event", () => {})(item), false);
  assert.equal(sendToWindows(() => null, "dopl:sync-event", () => {})(item), false);
  assert.equal(
    sendToWindows(() => { throw new Error("registry gone"); }, "dopl:sync-event", () => {})(item),
    false,
    "a throwing accessor must not escape into a realtime callback"
  );
});

test("start() takes the app-window REGISTRY, not one window", () => {
  const st = fnOf(SRC, "start");
  assert.match(st, /opts\.getWindows/, "the registry accessor, read at send time");
  assert.ok(!/opts\.getWindow\b/.test(st), "the single-window contract is gone");
});

test("watch() drops the old workspace's queue and invalidates its in-flight frames", () => {
  const fn = fnOf(SRC, "watch");
  assert.match(fn, /generation \+= 1/, "old frames must go stale immediately");
  assert.match(fn, /coalescer\.cancel\(\)/, "queued signals must not land in the new view");
  assert.match(fn, /releaseChannel\(\)/);
  assert.match(fn, /if \(next === watched\) return;/, "re-watching the same id must be a no-op");
  assert.match(fn, /if \(started && watched\) connect\(\)/, "null unwatches without rejoining");
});

test("start() is idempotent, and stop() clears `watched` before releasing", () => {
  const st = fnOf(SRC, "start");
  assert.match(st, /if \(started\) return;/);
  assert.match(st, /if \(watched\) connect\(\)/, "a watch() before start() must still connect");
  assert.match(st, /createSyncCoalescer\(COALESCE_MS, sendToWindows\)/);
  // Without the clear, a later start() rejoins the PREVIOUS session's workspace —
  // after a sign-out, another user's — before the renderer re-issues its watch.
  const fn = fnOf(SRC, "stop");
  assert.match(fn, /watched = null/);
  assert.ok(orderOf(fn, "generation += 1", "releaseChannel()", "stop"));
  assert.ok(orderOf(fn, "watched = null", "releaseChannel()", "stop"));
  assert.match(fn, /clearInterval\(authTimer\)/);
  assert.match(fn, /clearReconnect\(\)/);
  assert.match(fn, /client\.disconnect\(\)/);
});

test("the module exports the Phase-3 surface index.js is told to call", () => {
  // The block runs to EOF, so `between` has no honest end marker — guard the start
  // explicitly rather than let a missing marker slice to "" and pass vacuously.
  const at = SRC.indexOf("module.exports = {");
  assert.notEqual(at, -1, "no module.exports block");
  for (const name of ["start", "stop", "watch", "onWake", "refreshAuth",
    "SYNC_TABLES", "SYNC_EVENT"]) {
    assert.match(SRC.slice(at), new RegExp(`\\b${name}\\b[,:]`), `missing export: ${name}`);
  }
});

// ── THE LIVENESS DEFECTS REVIEW CAUGHT ─────────────────────────────────────

test("the token read is raced against a deadline, so the join latch cannot strand", () => {
  // getAccessToken() can refresh in line. A sleep mid-flight leaves it pending
  // forever: `connecting` stays true, no retry armed, feed dead until quit.
  const fn = fnOf(SRC, "readTokenWithDeadline");
  assert.match(fn, /Promise\.race\(/, "a bare await can hang forever");
  assert.match(fn, /resolve\(null\)/, "a timeout must land on the fail-closed path, not throw");
  assert.match(fn, /clearTimeout\(timer\)/, "the deadline timer must not leak per join");
  assert.match(fnOf(SRC, "applyAuth"), /await readTokenWithDeadline\(\)/,
    "applyAuth must not await getTokenFn() bare");
  assert.ok(AUTH_READ_TIMEOUT_MS > 0 && AUTH_READ_TIMEOUT_MS <= 60_000,
    `AUTH_READ_TIMEOUT_MS=${AUTH_READ_TIMEOUT_MS} is not a usable deadline`);
  // Belt-and-braces: a resume can also clear a frozen-promise latch.
  assert.match(fnOf(SRC, "onWake"), /connecting = false/);
  assert.match(fnOf(SRC, "onWake"), /connect\(\)/);
});

test("refreshAuth() is a real entry point that re-applies and rejoins", () => {
  // AUTH_RECHECK_MS is the backstop; index.js calls this on 'signed-in'.
  const fn = fnOf(SRC, "refreshAuth");
  assert.match(fn, /applyAuth\('rotate'\)/);
  assert.match(fn, /!subscribed && !reconnectTimer\) connect\(\)/,
    "a rotation that fixes a refused join must also rejoin");
  assert.match(fn, /if \(!started \|\| !client \|\| !watched\) return;/, "safe to call any time");
});
