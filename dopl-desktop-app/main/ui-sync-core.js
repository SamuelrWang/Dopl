// ui-sync-core.js — THE UI FEED'S DECISION CORE, with no socket, clock or BrowserWindow.
//
// ⚠ SPLIT OUT OF main/ui-sync.js ON 2026-08-18 (wiring plan Phase 10). That file sat at
// EXACTLY the ENGINEERING §2 500-line cap, so the Phase 10 fan-out — pushing the doorbell
// to EVERY app window instead of one — could not be written until something moved. The
// seam was already drawn: ui-sync.js's own header called this half "a pure function of
// injected values, testable without a socket, clock or BrowserWindow", and it was already
// fenced by the sentinels below.
//
// ⚠ THE SENTINELS MOVED WITH THE CODE, BYTE FOR BYTE. `test/ui-sync.test.mjs`,
// `test/ui-sync-tables.test.mjs` and `test/ui-sync-replica-identity.test.mjs` all SLICE
// `BEGIN UI-SYNC-PURE … END UI-SYNC-PURE` and drive it in a bare scope; they now slice it
// from HERE. Nothing inside changed in the split — the fan-out is entirely in ui-sync.js's
// electron half, which is the point of the seam.
//
// ⚠ NOTHING BELOW MAY REQUIRE ANYTHING. The block is evaluated in a bare `new Function`
// scope by three test files; a `require` in it ends that, and with it the ability to test
// the table list against the migrations without a database.
//
// The socket, the credential rule, the reconnect ladder's arming and the renderer send all
// stay in main/ui-sync.js — read that file's header for the trust model.

// ─── BEGIN UI-SYNC-PURE (no electron/require refs below) ─────────────────────
// Every decision — which tables to bind, which topic to join under, when a burst becomes
// one send, how long to wait, whether a frame may be forwarded — is a pure function of
// injected values, testable without a socket, clock or BrowserWindow. Sliced verbatim by
// test/ui-sync.test.mjs.

// THE CONTENT TABLES — the UNION of what the SPA's feature hooks watch
// (src/features/*/client/realtime.ts) minus the listener-owned ones below. That union is the
// contract: a table a hook watches but this list omits is a page that never updates live, so
// test/ui-sync-tables.test.mjs re-derives it from those files and checks each name against
// supabase/migrations for publication AND a `workspace_id` column — following RENAMES
// (skill_versions was skill_file_versions) and BARE `DROP TABLE`s, not just `ALTER PUBLICATION
// … DROP`. Not ceremony: `skill_files` sat here until review caught 20260716064733 dropping the
// table while its 20260502100200 publication ADD stayed — and ONE dead name makes realtime
// refuse the whole channel, i.e. no live updates at all.
// THE 5 `workflow_*` TABLES LEFT 2026-08-07 (Phase 5 / D8), PAIRED with migration
// 20260807100000 — dropping the publication alone leaves a binding that joins, says SUBSCRIBED
// and delivers nothing. They and `clusters` were DROPPED by 20260811120000, with the feature.
const SYNC_TABLES = Object.freeze([
  'knowledge_bases', 'knowledge_folders', 'knowledge_entries',
  'skills', 'skill_versions',
  'ontology_clusters', 'ontology_objects', 'ontology_memberships',
  'ontology_relationships',
  'chats', 'chat_messages', 'chat_folders',
  'channel_consent_requests', 'channels', 'channel_members',
  'channel_messages', 'agent_presence',
]);

// Historically the channels exemption excluded the three listener tables from this feed; the UI
// needs them (see header), so the set is empty — kept because the coverage test unions it in.
const LISTENER_OWNED_TABLES = Object.freeze([]);

// A burst on one (workspace, table) — an agent importing 40 knowledge entries — must cost
// ONE refetch signal, not one per row. 250ms swallows a multi-statement transaction and
// stays imperceptible.
const COALESCE_MS = 250;

// Reconnect ladder, mirroring shared-channel-registry.ts's. Capped: a machine offline for
// a week must retry forever without ever hammering (F-072).
const RECONNECT_DELAYS_MS = Object.freeze([500, 1000, 2000, 4000, 8000, 15000]);

// BACKSTOP re-read of the access token on a live connection (refreshAuth() is the prompt
// path). Realtime keeps authorizing rejoins with whatever setAuth last received, so a
// connection outliving its token silently stops rejoining.
const AUTH_RECHECK_MS = 5 * 60 * 1000;

// A join holds a single-flight latch across an AWAITED token read, and getAccessToken()
// can refresh in line (an HTTP call). A machine sleeping mid-flight leaves that promise
// pending FOREVER — latch closed, no timer, feed dead until quit. So the read is raced
// against this deadline; a timeout is "no credential".
const AUTH_READ_TIMEOUT_MS = 20_000;

// MODULE-scoped, never reset by a teardown — see shared-channel-registry.ts's generation
// counter. A per-connection one would restart at 1 after stop()/start() and mint a
// byte-identical topic while realtime-js still holds the leaving channel (no-op subscribe).
let topicSeq = 1;

function nextTopic(workspaceId) { return `dopl-ui-sync-${workspaceId}-g${topicSeq++}`; }

// Delay before the Nth consecutive retry (0-based), holding the ladder's ceiling.
function backoffMs(attempt) {
  const v = Number(attempt);
  const n = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  return RECONNECT_DELAYS_MS[Math.min(n, RECONNECT_DELAYS_MS.length - 1)];
}

// The one field ever read out of a payload. Both shapes accepted (realtime-js
// normalizes `record` to `new`); `old` last so an UPDATE still names its workspace.
// null is NOT an error and no replica identity can fix it: apply_rls redacts a DELETE's
// old_record to the PRIMARY KEY whenever RLS is on. Deletes reach here bare, always.
function payloadWorkspaceId(payload) {
  const p = payload || {};
  for (const rec of [p.new, p.record, p.old, p.old_record]) {
    const id = rec && rec.workspace_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

// May this frame become a renderer event? Four gates, each guarding a real failure:
// STARTED/WATCHED — a frame arriving during teardown must not send into a window the
// caller let go of. GENERATION — the leave push settles asynchronously, so a channel we
// just left keeps delivering for a beat, and attributing that to the workspace switched
// TO is a wrong-workspace refetch. TABLE — only a table we deliberately bound, so the
// channels exemption is refused on the way OUT too. WORKSPACE — a payload naming a
// DIFFERENT workspace is refused; one naming none is forwarded (migration 20260807150000
// is what scopes DELETEs server-side; they still arrive bare, so dropping them breaks all).
function shouldForward(state, event) {
  const s = state || {};
  const e = event || {};
  if (!s.started || !s.watched) return false;
  if (e.generation !== s.generation) return false;
  if (!SYNC_TABLES.includes(e.table)) return false;
  if (e.workspaceId != null && e.workspaceId !== s.watched) return false;
  return true;
}

// Collapse a burst into at most one send per (workspace, table) per window. One
// shared timer, not one per key: a transaction touching six tables produces six
// sends in ONE flush. `timers` is injectable for tests.
function createSyncCoalescer(windowMs, onFlush, timers) {
  const T = timers || { setTimeout, clearTimeout };
  const pending = new Map(); // `${workspaceId}|${table}` -> { workspaceId, table }
  let timer = null;
  function flush() {
    timer = null;
    const batch = Array.from(pending.values());
    pending.clear();
    // One bad send must not drop the rest of the batch.
    for (const item of batch) { try { onFlush(item); } catch (_err) { /* noop */ } }
  }
  function mark(workspaceId, table) {
    if (!workspaceId || !table) return;
    pending.set(`${workspaceId}|${table}`, { workspaceId, table });
    if (!timer) timer = T.setTimeout(flush, windowMs);
  }
  // Drop the queue WITHOUT sending — a workspace switch must not deliver the old
  // workspace's pending signals into the new view.
  function cancel() {
    if (timer) T.clearTimeout(timer);
    timer = null;
    pending.clear();
  }
  return { mark, flush, cancel, size: () => pending.size };
}

// What a (re)SUBSCRIBED owes the renderer: events during a disconnect are simply gone
// (postgres_changes has no replay), so a fresh join means "you may have missed
// anything". ONE event with an EMPTY table, not one per table — the registry implements
// exactly that contract (shared-channel-registry.ts: `if (e.table &&
// !s.tables.has(e.table)) continue`, so an empty table fires EVERY subscriber). The
// per-table batch instead made each hook refetch once per table it watches: four
// refetches for the ontology page on every reconnect or wake, a self-inflicted burst on
// the very DB this phase exists to unload. NOT coalesced — a reconnect must reach the UI
// now.
function catchUpBatch(workspaceId) {
  if (!workspaceId) return [];
  return [{ workspaceId, table: '' }];
}
// ─── END UI-SYNC-PURE ────────────────────────────────────────────────────────

module.exports = {
  SYNC_TABLES,
  LISTENER_OWNED_TABLES,
  COALESCE_MS,
  RECONNECT_DELAYS_MS,
  AUTH_RECHECK_MS,
  AUTH_READ_TIMEOUT_MS,
  nextTopic,
  backoffMs,
  payloadWorkspaceId,
  shouldForward,
  createSyncCoalescer,
  catchUpBatch,
};
