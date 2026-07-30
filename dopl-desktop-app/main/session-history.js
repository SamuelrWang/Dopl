// session-history.js — channel history for a reopened session shell (v2.5 D3).
//
// A recreated parked shell (session-park.recreateParkedShell) has an EMPTY local
// replay ring: the window is real but the earlier turns lived in the process that
// died. Instead of the old bare "the transcript is in the channel thread" note, main
// fetches the task's own channel messages and paints them as READ-ONLY history
// entries, lane-aligned like live turns, behind one "History from the channel"
// divider. When the shell has nothing to resume (no retained sdkSessionId, the D3
// always-open case) the same entries also seed the FRESH run's first turn as fenced
// context, so typing into a reopened window is not a cold start.
//
// MAIN-PROCESS ONLY. The fetch uses api.js (the Electron session's Supabase cookies —
// see auth.js for why not a bearer); the renderer gets display strings only. Nothing
// here logs a token, a body, or a path, and NO absolute path ever crosses to the
// renderer (§H-9). A failed fetch is not an error state: one calm notice, then the
// window carries on.
//
// The BEGIN/END PURE block references its leaf deps (apiFetch / listenerIo / io / diag)
// and the bind()-set `deps` as free vars, so test/session-history.test.mjs slices it,
// proves it holds no electron require, and drives it with fakes.
//
// SECURITY (FIX F4): the window is restricted to the two parties of THIS task. The
// server-side `metadata.taskId` is caller-settable by any channel member, so filtering
// on it alone let a THIRD member's post into both the rendered history and the fenced
// seed — one step around the FIX L1 counterparty binding. Rows are therefore kept only
// when their authorUserId is the operator or the session's bound counterparty, and the
// 'me' lane is reserved for rows the operator actually wrote.

const { apiFetch } = require('./api');
const listenerIo = require('./listener-io');
const io = require('./session-io'); // FIX F4: the shared gate-body / seed-exclusion rule
const { diag } = require('./diag');

// ─── BEGIN SESSION-HISTORY-PURE (injectable; unit-tested via source extraction) ──

let deps = null;

// The engine binds { emit } here at load (the replay-aware emit, so entries buffered
// before the window finishes loading are still delivered).
function bind(d) {
  deps = d || null;
}

const ENTRY_CAP = 50; // read-only entries rendered (contract cap ~50)
const FETCH_LIMIT = 200; // the server's MAX_MESSAGE_LIMIT for one read
const TEXT_CAP = 2000; // per-entry bound so one huge post cannot blow up the window
const NAME_CAP = 80; // the same bound every counterparty display name gets
const FETCH_FAILED_NOTE = 'Could not load earlier messages.';
// FIX F4: a shell whose durable record kept no counterparty cannot tell the peer's words
// from the operator's, so it paints NO history at all and says where to read it instead.
const NO_PEER_NOTE = 'Earlier messages are in the channel thread.';

function clamp(value, cap) {
  if (value == null) return '';
  const s = String(value).trim();
  return s.length > cap ? s.slice(0, cap) + '…' : s;
}

function oneLine(value, cap) {
  if (value == null) return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > cap ? s.slice(0, cap - 1).trimEnd() + '…' : s;
}

// PURE: the read-only render entries for a task, newest LAST (stream order).
//   - only real `message` rows (lifecycle events are the web card's story, not turns)
//   - only rows whose server-stamped metadata.taskId IS this task
//   - FIX F4: only rows written by one of the TWO parties of this task. `metadata.taskId`
//     is caller-settable, so a third channel member could otherwise land their own text
//     in this window (and in the seed) by stamping the task id on a post.
//   - lane 'me' ONLY when the author IS the operator; the bound counterparty is 'them'.
//     Neither id known -> that side contributes nothing, so counterparty text can never
//     be painted as the operator's own words.
//   - the last `cap` survive, so a long thread shows its most recent stretch.
function historyEntries(rows, opts) {
  const o = opts || {};
  const taskId = String(o.taskId == null ? '' : o.taskId);
  const selfId = String(o.selfUserId == null ? '' : o.selfUserId);
  const peerId = String(o.peerUserId == null ? '' : o.peerUserId);
  const cap = Number.isFinite(o.cap) && o.cap > 0 ? o.cap : ENTRY_CAP;
  const out = [];
  if (!taskId) return out;
  for (const r of rows || []) {
    if (!r || r.kind !== 'message') continue;
    const meta = r.metadata || {};
    if (String(meta.taskId == null ? '' : meta.taskId) !== taskId) continue;
    const author = String(r.authorUserId == null ? '' : r.authorUserId);
    if (!author) continue; // unattributable: never guess a lane for it
    const isSelf = !!selfId && author === selfId;
    const isPeer = !!peerId && author === peerId;
    if (!isSelf && !isPeer) continue; // a third member is not part of this task
    const text = clamp(r.body, TEXT_CAP);
    if (!text) continue;
    out.push({ from: oneLine(r.authorName, NAME_CAP), text: text, lane: isSelf ? 'me' : 'them' });
  }
  return out.slice(-cap);
}

// The authenticated read: the NEWEST `FETCH_LIMIT` rows of the channel, ascending.
// Returns null on any failure — the caller shows one calm notice.
//
// FIX F5: `since` is OMITTED on purpose. It used to be (cursor - 200), treating
// channel_messages.seq as a per-channel offset — but seq is GENERATED ALWAYS AS IDENTITY
// on the TABLE, so a 200-wide global window held an arbitrary number of THIS channel's
// rows (often far fewer than the 50 we render, sometimes zero), and a cursor of 0 asked
// for the OLDEST 200 rows of the whole thread. With no `since` the repository takes its
// newest-`limit`-then-reverse branch, which is exactly the window we want.
//
// FOLLOW-UP F7: this GET advances the HUMAN read watermark for the channel, so a window
// the operator never looked at can mark the thread read; wants a no-watermark read path
// (a server change, out of scope for this contract).
async function fetchRows(s) {
  try {
    const res = await apiFetch(
      `/api/channels/${s.channelId}/messages?limit=${FETCH_LIMIT}`,
      { workspaceId: s.workspaceId, timeoutMs: 15000 }
    );
    if (!res.ok) {
      diag('session-history: fetch failed', res.status); // status only — never a body
      return null;
    }
    const data = await res.json();
    return Array.isArray(data && data.messages) ? data.messages : [];
  } catch (err) {
    diag('session-history: fetch error', err && err.message);
    return null;
  }
}

// FIX F3 — will this shell start a FRESH sdk session (and therefore want the seed)? The
// answer is decided when the SHELL IS CREATED (session-engine stamps s.freshRun), NOT
// when this fetch happens to resolve: the old read of (!resumeSdkId && !sdkSessionId) lost
// the seed entirely whenever a racing system/init stamped an sdkSessionId first. A
// mid-wave caller with no marker falls back to the old read.
//
// The one thing that DOES disqualify a fresh run is a first turn that already went out:
// io.withSeed clears `freshFraming` as it builds that turn, so `false` here means the
// operator typed while this fetch was in flight. Seeding then would prepend "Earlier
// messages from this task" to turn TWO, mid-conversation. The entries are still PAINTED
// (they are real history) — only the prompt seed is skipped.
function seedsFreshRun(s) {
  if (typeof s.freshRun === 'boolean') return s.freshRun && s.freshFraming !== false;
  return !s.resumeSdkId && !s.sdkSessionId;
}

// Load + paint. Awaited by the recreate path (FIX F3: the entries must be painted and
// stashed BEFORE the window can take a turn); never throws into it.
async function load(s) {
  if (!deps || !s || !s.channelId || !s.taskId) return false; // no task -> nothing to filter on
  // FIX F4: no bound counterparty means no row can be laned honestly, so nothing is
  // painted (and nothing is read) — one calm pointer at the channel thread instead of a
  // window full of the peer's words wearing the operator's lane. No divider either: it
  // would introduce a history that is not there.
  if (!s.counterpartyId) {
    deps.emit(s, { type: 'notice', level: 'info', text: NO_PEER_NOTE });
    return false;
  }
  const rows = await fetchRows(s);
  if (!rows) {
    deps.emit(s, { type: 'notice', level: 'info', text: FETCH_FAILED_NOTE });
    return false;
  }
  // The operator's own id: needed to lane a row 'me'. Unknown identity fails CLOSED —
  // the peer's rows still render as 'them' and nothing claims to be the operator's.
  let selfId = null;
  try { selfId = await listenerIo.resolveIdentity(s.workspaceId); } catch (_) { selfId = null; }
  // FIX F4 (round 2): drop every row the inbound GATE is handling from the ENTRIES too,
  // not just from the seed. The fetch window always contains the message that popped the
  // gate (session-park records it on the shell before this read), so the held reply used
  // to render TWICE — once as the actionable Accept / Decline card and again as a muted
  // history bubble a few lines above it. Same predicate the seed uses, so the two agree.
  const entries = historyEntries(rows, {
    taskId: s.taskId, peerUserId: s.counterpartyId, selfUserId: selfId, cap: ENTRY_CAP,
  }).filter((e) => !io.isGatedEntry(e, (s && s.gatedBodies) || []));
  if (!entries.length) return false; // an empty thread stays quiet (no empty divider)
  deps.emit(s, { type: 'history', entries: entries });
  // D3: a shell with NOTHING to resume starts a fresh SDK session on the first turn, so
  // the thread rides that turn as fenced DATA. FIX F1: the seed is NOT built here — the
  // transcript is assembled at first-turn time (io.withSeed), minus every body the gate
  // has handled. Stash the entries only.
  if (seedsFreshRun(s)) s.pendingHistory = entries;
  return true;
}

// ─── END SESSION-HISTORY-PURE ───────────────────────────────────────────────────

module.exports = {
  bind,
  load,
  historyEntries,
  ENTRY_CAP,
  FETCH_FAILED_NOTE,
  NO_PEER_NOTE, // FIX F4
};
