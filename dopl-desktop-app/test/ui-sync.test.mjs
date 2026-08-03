// Phase 3 — the bundled SPA's live-update feed (main/ui-sync.js).
//
// THE FIVE FAILURES THIS LOCKS OUT, every one already paid for elsewhere here:
//
//   1. AN UNPUBLISHED TABLE KILLS THE WHOLE FEED. Realtime authorizes every
//      postgres_changes binding at JOIN time and refuses the CHANNEL if any one is
//      refused (realtime-agents.js's header is the write-up), so one name missing
//      from `supabase_realtime` silently costs all sixteen tables' live updates. The
//      list is CHECKED against supabase/migrations below, not trusted.
//   2. THE CHANNELS EXEMPTION GETS QUIETLY LOST. channel_messages / channel_agents /
//      agent_presence belong to main/realtime.js + main/realtime-agents.js
//      (DESKTOP-MIGRATION-PLAN.md Phase 3); binding them here doubles every wake and
//      puts the listener's transport behind this module's join.
//   3. A REUSED TOPIC RETURNS A CORPSE. `channel(topic)` hands back the channel
//      realtime-js still remembers and `removeChannel()` forgets only after the leave
//      settles, so a reused topic silently no-ops `subscribe()` and the feed is dead
//      until restart (shared-channel-registry.ts's generation counter).
//   4. AN ANON JOIN BREAKS PUSH FOR EVERY CLIENT. No user JWT → realtime-js joins on
//      the URL apikey, which cannot evaluate the published tables' RLS and crashes
//      the project's CDC pipeline, web included (realtime.js's CREDENTIAL RULE).
//   5. A BURST BECOMES A REFETCH STORM. An agent writing 40 knowledge entries must
//      cost ONE refetch signal per (workspace, table), not forty.
//
// WHY SOURCE EXTRACTION: ui-sync.js is CommonJS and requires @supabase/realtime-js +
// ws + electron (config/diag), so it cannot be imported under `node --test`. Its
// decision core is fenced as UI-SYNC-PURE and sliced verbatim; the imperative shell
// is covered by assertions over its real source (the auth-tokens.test.mjs pattern).
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

const PURE = between(
  SRC,
  "// ─── BEGIN UI-SYNC-PURE",
  "// ─── END UI-SYNC-PURE",
  "ui-sync pure block"
);

const {
  SYNC_TABLES,
  LISTENER_OWNED_TABLES,
  COALESCE_MS,
  RECONNECT_DELAYS_MS,
  AUTH_RECHECK_MS,
  nextTopic,
  backoffMs,
  payloadWorkspaceId,
  shouldForward,
  createSyncCoalescer,
  catchUpBatch,
} = new Function(
  `${PURE}
   return { SYNC_TABLES, LISTENER_OWNED_TABLES, COALESCE_MS, RECONNECT_DELAYS_MS,
            AUTH_RECHECK_MS, nextTopic, backoffMs, payloadWorkspaceId, shouldForward,
            createSyncCoalescer, catchUpBatch };`
)();

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const live = (over) => ({ started: true, watched: WS, generation: 7, ...over });
const frame = (over) => ({ workspaceId: WS, table: "skills", generation: 7, ...over });

// ── THE TABLE LIST vs THE ACTUAL PUBLICATION ────────────────────────────────
// Parsed once from supabase/migrations: both the bare `ADD TABLE` statements and
// the idempotent DO-block loops that ADD every name in an ARRAY[...] literal.

function publicationState() {
  const dir = join(HERE, "..", "..", "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const added = new Set();
  const dropped = new Set();
  const RE = /ALTER PUBLICATION supabase_realtime (ADD|DROP) TABLE (?:public\.)?(\w+)/g;
  for (const m of sql.matchAll(RE)) (m[1] === "ADD" ? added : dropped).add(m[2]);
  // The loop form: `FOREACH tbl IN ARRAY ARRAY[ 'a', 'b' ] LOOP … ADD TABLE public.%I`
  const RE_LOOP = /FOREACH\s+tbl\s+IN\s+ARRAY\s+ARRAY\[([^\]]*)\]([\s\S]*?)END LOOP/g;
  for (const m of sql.matchAll(RE_LOOP)) {
    const set = /ADD TABLE/.test(m[2]) ? added : /DROP TABLE/.test(m[2]) ? dropped : null;
    if (set) for (const q of m[1].matchAll(/'(\w+)'/g)) set.add(q[1]);
  }
  return { added, dropped, sql };
}

const PUB = publicationState();

test("every watched table is really in the supabase_realtime publication", () => {
  // Failure mode 1: one unpublished name refuses the JOIN and takes all sixteen
  // tables' live updates down with it.
  const missing = SYNC_TABLES.filter((t) => !PUB.added.has(t));
  assert.deepEqual(missing, [], `not published by any migration: ${missing.join(", ")}`);
});

test("no watched table was later pulled back OUT of the publication", () => {
  // channel_tasks (20260728010000) and the canvas tables (20260716220000) are the
  // precedent: a table can be un-published later, and the client is the last to know.
  const gone = SYNC_TABLES.filter((t) => PUB.dropped.has(t));
  assert.deepEqual(gone, [], `dropped from the publication: ${gone.join(", ")}`);
});

test("every watched table has the workspace_id column the realtime filter needs", () => {
  // `filter: workspace_id=eq.<id>` on a table without the column is a refused
  // binding — i.e. failure mode 1 again, by a different route.
  for (const t of SYNC_TABLES) {
    const re = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${t}\\s*\\(([\\s\\S]*?)\\n\\);`);
    const m = re.exec(PUB.sql);
    assert.ok(m, `no CREATE TABLE found for ${t}`);
    assert.match(m[1], /\bworkspace_id\b/, `${t} has no workspace_id column`);
  }
});

test("the watched set is exactly the 16 CONTENT tables, in a pinned order", () => {
  assert.deepEqual(SYNC_TABLES, [
    "knowledge_bases", "knowledge_folders", "knowledge_entries",
    "skills", "skill_files",
    "workflows", "workflow_steps",
    "ontology_clusters", "ontology_objects", "ontology_memberships",
    "ontology_relationships",
    "chats", "chat_folders",
    "channel_consent_requests", "channels", "channel_members",
  ]);
  assert.equal(new Set(SYNC_TABLES).size, SYNC_TABLES.length, "duplicate binding");
});

// ── THE CHANNELS EXEMPTION ──────────────────────────────────────────────────

test("the listener's own tables are NAMED as exempt and never watched", () => {
  assert.deepEqual(LISTENER_OWNED_TABLES,
    ["channel_messages", "channel_agents", "agent_presence"]);
  for (const t of LISTENER_OWNED_TABLES) {
    assert.ok(!SYNC_TABLES.includes(t), `${t} belongs to the channel listener`);
  }
});

test("the exempt tables are published — so their absence here is a CHOICE, not a gap", () => {
  // If they were merely unpublished, the exemption would be indistinguishable from
  // an oversight and someone would "fix" it. They are available; we decline them.
  for (const t of LISTENER_OWNED_TABLES) {
    assert.ok(PUB.added.has(t), `${t} is not published — the exemption comment is stale`);
  }
});

test("connect() cannot bind an exempt table — the refusal is in the code, not a comment", () => {
  const fn = fnOf(SRC, "connect");
  for (const t of LISTENER_OWNED_TABLES) {
    assert.ok(!fn.includes(t), `connect() references ${t}`);
  }
  assert.match(fn, /for \(const table of SYNC_TABLES\)/, "bindings must come from the list");
});

// ── TOPIC GENERATION (failure mode 3) ───────────────────────────────────────

test("a topic is never reused, not even for the same workspace", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(nextTopic(i % 2 ? WS : WS2));
  assert.equal(seen.size, 200, "a reused topic returns realtime-js's leaving corpse");
});

test("the topic carries the workspace and a monotonic generation suffix", () => {
  const a = nextTopic(WS);
  const b = nextTopic(WS);
  assert.match(a, /^dopl-ui-sync-/);
  assert.ok(a.includes(WS), "the topic must name the workspace it joins");
  const gen = (t) => Number(/-g(\d+)$/.exec(t)[1]);
  assert.ok(gen(b) > gen(a), "the generation must advance");
});

test("two workspaces never collide on a topic", () => {
  assert.notEqual(nextTopic(WS), nextTopic(WS2));
});

test("the counter is MODULE-scoped, so it survives a teardown", () => {
  // A per-connection counter restarts at 1 after stop()/start() and mints a
  // byte-identical topic while realtime-js may still hold the leaving channel.
  assert.match(PURE, /^let topicSeq = 1;$/m);
  const fn = fnOf(SRC, "nextTopic");
  assert.match(fn, /topicSeq\+\+/, "the topic must consume the shared counter");
});

// ── BACKOFF LADDER ──────────────────────────────────────────────────────────

test("the reconnect ladder grows and then holds its ceiling", () => {
  assert.deepEqual(RECONNECT_DELAYS_MS, [500, 1000, 2000, 4000, 8000, 15000]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(backoffMs), RECONNECT_DELAYS_MS);
  for (const n of [6, 7, 20, 500]) assert.equal(backoffMs(n), 15000);
});

test("the ladder is monotonic and never zero (an offline machine must not hammer)", () => {
  let prev = 0;
  for (let n = 0; n <= 12; n++) {
    const v = backoffMs(n);
    assert.ok(v > 0, `attempt ${n} scheduled at 0 — that is a reconnect storm (F-072)`);
    assert.ok(v >= prev, `attempt ${n} (${v}) < previous (${prev})`);
    prev = v;
  }
});

test("a nonsense attempt number yields the first rung, never NaN", () => {
  for (const bad of [null, undefined, NaN, -3, "x", {}]) {
    assert.equal(backoffMs(bad), 500, `attempt=${String(bad)}`);
  }
});

// ── COALESCING (failure mode 5) ─────────────────────────────────────────────

function fakeTimers() {
  let armed = null;
  let arms = 0;
  return {
    arms: () => arms,
    pending: () => armed !== null,
    run() { const fn = armed; armed = null; if (fn) fn(); },
    api: {
      setTimeout: (fn, ms) => { arms += 1; armed = fn; return { ms }; },
      clearTimeout: () => { armed = null; },
    },
  };
}

test("the coalesce window is 250ms — long enough for a transaction, short enough to feel live", () => {
  assert.equal(COALESCE_MS, 250);
});

test("a burst on ONE (workspace, table) collapses to a single send", () => {
  const T = fakeTimers();
  const sent = [];
  const c = createSyncCoalescer(COALESCE_MS, (i) => sent.push(i), T.api);
  for (let i = 0; i < 40; i++) c.mark(WS, "knowledge_entries");
  assert.equal(sent.length, 0, "nothing may be sent before the window closes");
  assert.equal(T.arms(), 1, "one timer per window, not one per event");
  T.run();
  assert.deepEqual(sent, [{ workspaceId: WS, table: "knowledge_entries" }]);
});

test("one transaction across six tables is ONE flush carrying six signals", () => {
  const T = fakeTimers();
  const sent = [];
  const c = createSyncCoalescer(COALESCE_MS, (i) => sent.push(i), T.api);
  const tables = SYNC_TABLES.slice(0, 6);
  for (const t of tables) c.mark(WS, t);
  for (const t of tables) c.mark(WS, t); // the burst repeats
  assert.equal(T.arms(), 1);
  T.run();
  assert.deepEqual(sent.map((s) => s.table), tables);
});

test("the same table in two workspaces is two distinct signals", () => {
  const T = fakeTimers();
  const sent = [];
  const c = createSyncCoalescer(COALESCE_MS, (i) => sent.push(i), T.api);
  c.mark(WS, "chats");
  c.mark(WS2, "chats");
  T.run();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((s) => s.workspaceId).sort(), [WS, WS2].sort());
});

test("a second window arms a NEW timer once the first has flushed", () => {
  const T = fakeTimers();
  const c = createSyncCoalescer(COALESCE_MS, () => {}, T.api);
  c.mark(WS, "skills");
  T.run();
  c.mark(WS, "skills");
  assert.equal(T.arms(), 2, "the coalescer must re-arm, not go silent after one burst");
});

test("cancel() drops the queue WITHOUT sending — a switched workspace must not leak", () => {
  const T = fakeTimers();
  const sent = [];
  const c = createSyncCoalescer(COALESCE_MS, (i) => sent.push(i), T.api);
  c.mark(WS, "skills");
  c.mark(WS, "chats");
  assert.equal(c.size(), 2);
  c.cancel();
  assert.equal(c.size(), 0);
  assert.equal(T.pending(), false, "the timer must be disarmed, not merely emptied");
  T.run();
  assert.deepEqual(sent, [], "the old workspace's signals must never reach the new view");
});

test("one throwing send does not starve the rest of the batch", () => {
  const T = fakeTimers();
  const sent = [];
  const c = createSyncCoalescer(COALESCE_MS, (i) => {
    if (i.table === "skills") throw new Error("window gone");
    sent.push(i.table);
  }, T.api);
  c.mark(WS, "skills");
  c.mark(WS, "chats");
  c.mark(WS, "workflows");
  T.run();
  assert.deepEqual(sent, ["chats", "workflows"]);
});

test("a mark with no workspace or no table is ignored, never queued as undefined", () => {
  const T = fakeTimers();
  const c = createSyncCoalescer(COALESCE_MS, () => {}, T.api);
  for (const [w, t] of [[null, "skills"], [WS, null], [undefined, undefined], ["", "skills"]]) {
    c.mark(w, t);
  }
  assert.equal(c.size(), 0);
  assert.equal(T.arms(), 0);
});

// ── PAYLOAD READING: one field, and only as a guard ─────────────────────────

test("the workspace id is read from whichever record shape realtime-js delivers", () => {
  assert.equal(payloadWorkspaceId({ new: { workspace_id: WS } }), WS);
  assert.equal(payloadWorkspaceId({ record: { workspace_id: WS } }), WS);
  assert.equal(payloadWorkspaceId({ old: { workspace_id: WS } }), WS);
  assert.equal(payloadWorkspaceId({ old_record: { workspace_id: WS } }), WS);
  assert.equal(payloadWorkspaceId({ new: { workspace_id: WS }, old: { workspace_id: WS2 } }), WS);
});

test("a payload naming no workspace yields null, and that is not an error", () => {
  // Under the default replica identity a DELETE's old record is the primary key
  // alone — the commonest legitimate case.
  const bad = [null, undefined, {}, { new: {} }, { new: { workspace_id: 42 } },
    { new: { workspace_id: "" } }];
  for (const p of bad) assert.equal(payloadWorkspaceId(p), null, JSON.stringify(p));
});

test("nothing but workspace_id is ever read out of a payload", () => {
  const fn = fnOf(SRC, "payloadWorkspaceId");
  const fields = [...fn.matchAll(/rec && rec\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(fields)], ["workspace_id"]);
});

// ── THE FORWARDING GATE ─────────────────────────────────────────────────────

test("a live frame for the watched workspace is forwarded", () => {
  assert.equal(shouldForward(live(), frame()), true);
});

test("a frame from a channel we already left is REFUSED (generation guard)", () => {
  // The leave push settles asynchronously, so the old channel keeps delivering for a
  // beat. Attributing that to the workspace just switched TO is a wrong-workspace
  // refetch — the bug shared-channel-registry.ts's generation counter exists to kill.
  assert.equal(shouldForward(live({ generation: 8 }), frame({ generation: 7 })), false);
  assert.equal(shouldForward(live({ generation: 7 }), frame({ generation: 8 })), false);
});

test("a frame arriving during teardown is refused", () => {
  assert.equal(shouldForward(live({ started: false }), frame()), false);
  assert.equal(shouldForward(live({ watched: null }), frame()), false);
  assert.equal(shouldForward(null, frame()), false);
  assert.equal(shouldForward(live(), null), false);
});

test("a table we did not bind is refused ON THE WAY OUT as well as on the way in", () => {
  for (const t of [...LISTENER_OWNED_TABLES, "workspaces", "", null, undefined]) {
    assert.equal(shouldForward(live(), frame({ table: t })), false, `table=${String(t)}`);
  }
});

test("a payload naming a DIFFERENT workspace is refused", () => {
  assert.equal(shouldForward(live(), frame({ workspaceId: WS2 })), false);
});

test("a payload naming NO workspace is forwarded — or every DELETE would vanish", () => {
  // The server-side `workspace_id=eq.<id>` filter already scoped the binding, so an
  // id-less frame is a replica-identity artifact, not an unscoped event.
  assert.equal(shouldForward(live(), frame({ workspaceId: null })), true);
  assert.equal(shouldForward(live(), frame({ workspaceId: undefined })), true);
});

// ── CATCH-UP ON (RE)SUBSCRIBE ───────────────────────────────────────────────

test("a fresh SUBSCRIBED owes one refetch signal per table", () => {
  const batch = catchUpBatch(WS);
  assert.equal(batch.length, SYNC_TABLES.length);
  assert.deepEqual(batch.map((b) => b.table), [...SYNC_TABLES]);
  for (const b of batch) assert.equal(b.workspaceId, WS);
});

test("catch-up for no workspace is empty, never a batch of nulls", () => {
  for (const bad of [null, undefined, ""]) assert.deepEqual(catchUpBatch(bad), []);
});

test("the catch-up covers EVERY watched table — a gap is a permanently stale page", () => {
  const covered = new Set(catchUpBatch(WS).map((b) => b.table));
  for (const t of SYNC_TABLES) assert.ok(covered.has(t), `${t} would never refetch after a gap`);
});

// ── THE SHELL: what the pure core is actually wired to ──────────────────────

test("every binding is attached BEFORE subscribe, on a generation-unique topic", () => {
  // Failure mode 3, plus the v2 constraint realtime.js and the registry both
  // document: `.on()` after `.subscribe()` throws, because the server fixes the
  // binding list at JOIN time.
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /client\.channel\(nextTopic\(wsId\)\)/, "no literal/reused topic string");
  assert.ok(
    orderOf(fn, "chan.on(", "chan.subscribe(", "connect"),
    "a late .on() throws under realtime-js v2"
  );
  assert.match(fn, /filter: `workspace_id=eq\.\$\{wsId\}`/, "the join must be workspace-scoped");
  assert.match(fn, /chan\.subscribe\(\(status, err\)/, "the join-error payload is the 2nd arg");
});

test("the credential is applied and AWAITED before the channel is ever created", () => {
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /await applyAuth\(/, "fire-and-forget setAuth is a subscribe-before-auth race");
  assert.ok(orderOf(fn, "await applyAuth(", "client.channel(", "connect"));
  assert.match(fn, /if \(!authed\) \{ scheduleReconnect\(\); return; \}/,
    "no credential must mean NO JOIN — an anon join breaks push for every client");
});

test("applyAuth fails closed and awaits setAuth", () => {
  const fn = fnOf(SRC, "applyAuth");
  assert.match(fn, /if \(!token\)/);
  assert.ok(orderOf(fn, "if (!token)", "await client.setAuth(", "applyAuth"),
    "the missing-credential return must come BEFORE any setAuth");
  assert.match(fn, /await client\.setAuth\(token\)/);
  assert.ok(!/token\s*=\s*token/.test(SRC), "the token must never be retained module-side");
});

test("the token is re-read on every join, on wake, and on a slow recheck", () => {
  // A stale JWT was the other half of the 1.7.6 field failure: the token rotates
  // hourly, and a connection that outlives it silently stops rejoining.
  assert.match(fnOf(SRC, "connect"), /applyAuth\('join'\)/);
  assert.match(fnOf(SRC, "armAuthRecheck"), /applyAuth\('rotate'\)/);
  assert.match(fnOf(SRC, "onWake"), /connect\(\)/);
  assert.ok(AUTH_RECHECK_MS > 0 && AUTH_RECHECK_MS <= 15 * 60 * 1000,
    `AUTH_RECHECK_MS=${AUTH_RECHECK_MS} must be well inside a token lifetime`);
});

test("no credential can reach the plaintext log", () => {
  for (const line of SRC.match(/\bdiag\([^;]*\)/g) || []) {
    assert.ok(!/\btoken\b|access_token|setAuth\(token/.test(line), `logs a credential: ${line}`);
  }
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

test("start() is idempotent and subscribes nothing until a workspace is named", () => {
  const fn = fnOf(SRC, "start");
  assert.match(fn, /if \(started\) return;/);
  assert.match(fn, /if \(watched\) connect\(\)/, "a watch() before start() must still connect");
  assert.match(fn, /createSyncCoalescer\(COALESCE_MS, sendToWindow\)/);
});

test("stop() invalidates every callback BEFORE releasing, and clears both timers", () => {
  const fn = fnOf(SRC, "stop");
  assert.ok(orderOf(fn, "generation += 1", "releaseChannel()", "stop"));
  assert.match(fn, /clearInterval\(authTimer\)/);
  assert.match(fn, /clearReconnect\(\)/);
  assert.match(fn, /client\.disconnect\(\)/);
});

test("the join is single-flight and self-heals a watch() that raced the auth await", () => {
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /if \(!started \|\| !watched \|\| connecting\) return;/);
  assert.match(fn, /watched !== wsId/, "the awaited continuation must re-check the target");
  assert.match(fn, /if \(started && watched && !channel && !reconnectTimer\) connect\(\)/);
});

test("the module exports the Phase-3 surface index.js is told to call", () => {
  for (const name of ["start", "stop", "watch", "onWake", "SYNC_TABLES", "SYNC_EVENT"]) {
    assert.match(SRC, new RegExp(`^\\s{2}${name}[,:]`, "m"), `missing export: ${name}`);
  }
});
