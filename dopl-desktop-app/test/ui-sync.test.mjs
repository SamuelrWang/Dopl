// Phase 3 — the bundled SPA's live-update feed (main/ui-sync.js).
//
// THE FAILURES THIS LOCKS OUT:
//   1. A DEAD TABLE KILLS THE WHOLE FEED — realtime refuses the CHANNEL if any one
//      binding is refused, so ONE bad name costs every table's live updates. Review
//      found exactly that (`skill_files`, dropped outright by 20260716064733), so the
//      list is CHECKED against the migrations rather than trusted.
//   2. A TABLE THE UI WATCHES BUT MAIN DOESN'T BIND is a page that never updates
//      live; the union is re-derived from src/features/*/client/realtime.ts.
//   3. THE CHANNELS EXEMPTION GETS QUIETLY LOST (channel_messages / channel_agents /
//      agent_presence belong to realtime.js + realtime-agents.js).
//   4. A REUSED TOPIC RETURNS A CORPSE whose `subscribe()` silently no-ops.
//   5. AN ANON JOIN BREAKS PUSH FOR EVERY CLIENT (realtime.js's CREDENTIAL RULE),
//      and a hung token read strands the join latch with no retry armed.
//   6. A BURST BECOMES A REFETCH STORM — one signal per (workspace, table), and ONE
//      empty-table catch-up event rather than one per table.
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
const PURE = between(SRC, "// ─── BEGIN UI-SYNC-PURE", "// ─── END UI-SYNC-PURE",
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

// ── THE TABLE LIST vs THE ACTUAL PUBLICATION ────────────────────────────────
// Parsed once from supabase/migrations: bare `ADD TABLE` statements plus the
// idempotent DO-block loops that ADD every name in an ARRAY[...] literal.

function publicationState() {
  const dir = join(HERE, "..", "..", "supabase", "migrations");
  const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const added = new Set();
  const dropped = new Set();
  for (const m of sql.matchAll(
    /ALTER PUBLICATION supabase_realtime (ADD|DROP) TABLE (?:public\.)?(\w+)/g
  )) (m[1] === "ADD" ? added : dropped).add(m[2]);
  // The loop form: `FOREACH tbl IN ARRAY ARRAY[ 'a', 'b' ] LOOP … ADD TABLE public.%I`
  const RE_LOOP = /FOREACH\s+tbl\s+IN\s+ARRAY\s+ARRAY\[([^\]]*)\]([\s\S]*?)END LOOP/g;
  for (const m of sql.matchAll(RE_LOOP)) {
    const set = /ADD TABLE/.test(m[2]) ? added : /DROP TABLE/.test(m[2]) ? dropped : null;
    if (set) for (const q of m[1].matchAll(/'(\w+)'/g)) set.add(q[1]);
  }
  // A BARE `DROP TABLE` un-publishes implicitly, leaving the original ADD in the
  // history looking authoritative — that is what let `skill_files` pass review.
  for (const m of sql.matchAll(/DROP TABLE (?:IF EXISTS )?(?:public\.)?(\w+)/g)) {
    dropped.add(m[1]);
  }
  // `ALTER TABLE x RENAME TO y` — the CREATE for `y` is filed under `x`.
  const renames = new Map();
  for (const m of sql.matchAll(/ALTER TABLE (?:public\.)?(\w+) RENAME TO (\w+)/g)) renames.set(m[2], m[1]);
  return { added, dropped, renames, sql };
}

const PUB = publicationState();

// The CREATE TABLE body for a table, following renames back to its original name.
function createBody(table, seen = new Set()) {
  const m = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`
  ).exec(PUB.sql);
  if (m) return m[1];
  const prev = PUB.renames.get(table);
  if (prev && !seen.has(prev)) return createBody(prev, seen.add(table));
  return null;
}

test("every watched table is real: published, never dropped, workspace-scoped", () => {
  // Failure 1, all three routes into it. A name that is unpublished, dropped, or
  // missing workspace_id refuses its binding — and one refused binding refuses the
  // WHOLE channel, so it costs every other table's live updates too.
  const missing = SYNC_TABLES.filter((t) => !PUB.added.has(t));
  assert.deepEqual(missing, [], `not published by any migration: ${missing.join(", ")}`);
  const gone = SYNC_TABLES.filter((t) => PUB.dropped.has(t));
  assert.deepEqual(gone, [], `dropped table still bound: ${gone.join(", ")}`);
  for (const t of SYNC_TABLES) {
    const body = createBody(t);
    assert.ok(body, `no CREATE TABLE found for ${t}`);
    assert.match(body, /\bworkspace_id\b/, `${t} has no workspace_id column`);
  }
  // Both scanners must keep working, or this test silently stops checking anything:
  // the bare-DROP scan is what `skill_files` slipped past, and the rename follower is
  // what keeps skill_versions (created as skill_file_versions) from reading as bare.
  assert.ok(PUB.dropped.has("skill_files"), "the bare-DROP scan has stopped working");
  assert.ok(createBody("skill_versions"), "the rename follower has stopped working");
});

test("the watched set is exactly the 23 tables, in a pinned order", () => {
  assert.deepEqual(SYNC_TABLES, [
    "knowledge_bases", "knowledge_folders", "knowledge_entries",
    "skills", "skill_versions",
    "workflows", "workflow_steps", "workflow_step_edges",
    "workflow_knowledge_bases", "workflow_skills",
    "ontology_clusters", "ontology_objects", "ontology_memberships",
    "ontology_relationships",
    "chats", "chat_messages", "chat_folders",
    "channel_consent_requests", "channels", "channel_members",
    "channel_messages", "channel_agents", "agent_presence",
  ]);
  assert.equal(new Set(SYNC_TABLES).size, SYNC_TABLES.length, "duplicate binding");
  assert.ok(!SYNC_TABLES.includes("skill_files"), "skill_files no longer exists as a table");
});

// ── THE RENDERER CONTRACT ──────────────────────────────────────────────────
// A table a hook watches but main never binds is a page that silently never updates
// live. Re-derived from the feature sources so none can drop out by omission.
function featureWatchedTables() {
  const root = join(HERE, "..", "..", "src", "features");
  const tables = new Map(); // table -> the file that subscribes to it
  for (const feat of readdirSync(root)) {
    for (const rel of [["client", "realtime.ts"], ["constants.ts"]]) {
      const f = join(root, feat, ...rel);
      let src;
      try {
        src = readFileSync(f, "utf8");
      } catch {
        continue; // this feature has no realtime surface
      }
      // `const X_TABLES = [ "a", "b" ] as const;` — the only shape these files use.
      for (const m of src.matchAll(/_TABLES\s*=\s*\[([\s\S]*?)\]\s*as const/g)) {
        for (const q of m[1].matchAll(/"(\w+)"/g)) if (!tables.has(q[1])) tables.set(q[1], f);
      }
    }
  }
  return tables;
}

test("every table the SPA's feature hooks watch is covered by main", () => {
  const watched = featureWatchedTables();
  assert.ok(watched.size >= 20, `only found ${watched.size} feature tables — parser drifted`);
  const covered = new Set([...SYNC_TABLES, ...LISTENER_OWNED_TABLES]);
  const un = [...watched].filter(([t]) => !covered.has(t));
  assert.deepEqual(un.map(([t]) => t), [],
    `hooks subscribe but main binds nothing: ${un.map(([t, f]) => `${t} (${f})`).join(", ")}`);
  // Regression pin: these five were absent from the first cut of SYNC_TABLES, so the
  // chats, skills and workflows pages would never have updated live.
  for (const t of ["chat_messages", "skill_versions", "workflow_step_edges",
    "workflow_knowledge_bases", "workflow_skills"]) {
    assert.ok(watched.has(t), `${t} is no longer hook-watched — re-check the union`);
    assert.ok(SYNC_TABLES.includes(t), `${t} must be bound by main`);
  }
});

// ── THE CHANNELS EXEMPTION ──────────────────────────────────────────────────

test("the channels exemption protects the listener MODULES, not the UI feed", () => {
  // First dogfood: excluding the channel tables from THIS feed froze the
  // app's transcript. The UI watches them on its own socket; the exemption
  // means realtime.js / realtime-agents.js stay untouched (asserted by the
  // desktop suite generally), so the once-excluded set is now empty.
  assert.deepEqual(LISTENER_OWNED_TABLES, []);
  for (const t of ["channel_messages", "channel_agents", "agent_presence"]) {
    assert.ok(SYNC_TABLES.includes(t), `${t} must feed the UI (web parity)`);
    assert.ok(PUB.added.has(t), `${t} is not published`);
  }
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /for \(const table of SYNC_TABLES\)/, "bindings must come from the list");
});

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
  assert.match(fnOf(SRC, "nextTopic"), /topicSeq\+\+/, "the topic consumes the shared counter");
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
  const fn = fnOf(SRC, "payloadWorkspaceId");
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

test("the renderer send is window-guarded and resolves the window at SEND time", () => {
  const fn = fnOf(SRC, "sendToWindow");
  assert.match(fn, /getWindowFn \? getWindowFn\(\) : null/, "the window is rebuilt on reopen");
  assert.match(fn, /win\.isDestroyed\(\)/);
  assert.match(fn, /wc\.isDestroyed\(\)/, "webContents can die independently of the window");
  assert.match(fn, /wc\.send\(SYNC_EVENT, \{ workspaceId: item\.workspaceId, table: item\.table \}\)/);
  assert.match(SRC, /const SYNC_EVENT = 'dopl:sync-event';/);
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
  assert.match(st, /createSyncCoalescer\(COALESCE_MS, sendToWindow\)/);
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
