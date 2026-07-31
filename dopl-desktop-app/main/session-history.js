// session-history.js — channel history for a reopened session shell (v2.5 D3).
//
// A recreated parked shell (session-park.recreateParkedShell) has an EMPTY local
// replay ring: the window is real but the earlier turns lived in the process that
// died. Instead of the old bare "the transcript is in the channel thread" note, main
// fetches this conversation's own channel messages and paints them as READ-ONLY history
// entries, lane-aligned like live turns, behind one "History from the channel"
// divider. ONE divider serves BOTH reads (the task's tagged thread and the FIX F17 pair
// fallback): the copy already names the channel, which is true either way, and a second
// wording would only expose which internal filter matched. That string is renderer-owned
// (session-viewmodel.HISTORY_NOTE) — main sends data. When the shell has nothing to
// resume (no retained sdkSessionId, the D3 always-open case) the same entries also seed
// the FRESH run's first turn as fenced context, so typing into a reopened window is not
// a cold start. (FIX N1: "the same entries", plus the one line that says how many were
// withheld — the two surfaces state the same count or the seed would be the more complete
// looking lie of the two.)
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
//
// FIX N1 (N-party, 2026-07-31): that fence is correct and it was SILENT. A dropped row left no
// trace in EITHER surface, and the same array is both rendered and stashed as the fresh run's
// seed — so in a channel with more than two members the operator read a plausible-looking but
// incomplete conversation and the agent was seeded with one. The fence is UNCHANGED (the
// caller-settable thread id it exists for is still open, and widening it is a later wave with a
// product decision attached). What changed is that the drops are COUNTED and stated: one calm
// notice in the window, and one trailing line inside the seed's own fence.
//
// FIX N1 also stops the no-counterparty case opening an EMPTY BOX. A thread in a group channel
// has no counterparty at all (channel-context resolves one for DIRECT channels only, by design),
// and load() used to bail on that before it read anything, so "Open session" on a group thread
// card painted nothing and said only "Earlier messages are in the channel thread." It now paints
// what it can legitimately attribute — the rows the OPERATOR wrote — and says in the same breath
// that it has no counterparty and how many other members' messages it is therefore not showing.
// Nothing is inferred: a shell with NEITHER a counterparty nor a resolvable operator id still
// paints nothing, because then no row can be laned honestly at all.
//
// FIX F17: filtering on the task id was also too NARROW to show anything for a real DM
// exchange. Most of those rows carry no `metadata.taskId` at all (the request and the
// agent's reply are plain `message` rows; the only tagged row is the `task_started`
// lifecycle event, which the entry filter rightly skips), and a responder shell with no
// first-class task has no task id to match on either — so a reopened window painted an
// EMPTY stream for a conversation that plainly had messages. The task-scoped read is now
// the PREFERRED pass, with a PAIR-SCOPED fallback behind it: same two-party author rule,
// minus the taskId condition. The fallback widens WHICH rows count, never WHOSE.
//
// FIX Q1: that fallback then overshot from "too narrow" to "unscoped". It ran for EVERY
// legacy task (their messages are never stamped, so the tagged pass always found zero), and
// a pair-scoped read of a DM is the WHOLE channel — a reopened window for one 10-minute task
// replayed months of unrelated conversation, and seeded it into the fresh run's first turn.
// A session that HAS a task id now gets a task WINDOW instead: rows stamped with this task,
// plus the unstamped two-party messages that sit inside the task's own `seq` span. The span
// is read off the rows already fetched (no second request, no server filter — see the
// REJECTED note on `?taskId=` in the fix queue) and mirrors the web thread grouper:
//   start — a legacy `task-<channelId>-<seq>` id CARRIES its opener's seq (trigger.js:61), so
//           the request that started the task is inside the window even though nothing
//           stamped it; a first-class id starts at the oldest row that names it.
//   end   — this task's `task_finished` / `task_failed`, else the next OTHER `task_started`
//           (a new task supersedes the open one, group-thread.ts:478), else open-ended.
// A task with NO anchor in the fetched window paints NOTHING and says where to read it. The
// pair-scoped pass survives ONLY for a shell with no task id at all (a responder that never
// got a first-class task): there is no window to compute, and the pair IS the scope.

const { apiFetch } = require('./api');
const listenerIo = require('./listener-io');
const io = require('./session-io'); // FIX F4: the shared gate-body / seed-exclusion rule
const copy = require('./session-history-copy'); // §2 split: every operator-facing string
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
// Every operator-facing string lives in `copy` (main/session-history-copy.js): the two calm
// notices this file has always had, the FIX N1 one-sided-window lines, and the two count builders
// the window and the seed share. Split out under §2; re-exported below unchanged.

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

// PURE (ported from the web grouper's parseLegacyTaskSeq, group-thread.ts): the trailing
// seq N of a legacy deterministic task id `task-<channelId>-<N>` — the id the desktop mints
// when the trigger carries no first-class task (trigger.js:61), where N is the seq of the
// message that STARTED the task. The channel id is itself a UUID full of hyphens, so this
// anchors on the known prefix instead of splitting on '-'. null for any other shape (a
// first-class UUID id, a malformed id), which keeps the reach-back legacy-only.
function parseLegacyTaskSeq(taskId, channelId) {
  if (!taskId || !channelId) return null;
  const prefix = `task-${channelId}-`;
  if (taskId.slice(0, prefix.length) !== prefix) return null;
  const rest = taskId.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

// PURE: a row's position, or null when it has none. `seq` is compared only against other
// rows of THIS fetch (FIX F5: it is a TABLE-WIDE identity, never a per-channel offset and
// never a fetch cursor). A row with no usable seq cannot be placed, so it fails CLOSED.
function rowSeq(r) {
  const n = Number(r && r.seq);
  return Number.isFinite(n) ? n : null;
}

// PURE: the server-stamped task id of a row, '' when it carries none.
function rowTaskId(r) {
  const meta = (r && r.metadata) || {};
  return String(meta.taskId == null ? '' : meta.taskId);
}

// PURE (FIX Q1): the `seq` span of THIS task inside the rows already fetched, or null when
// the task has no anchor in them (the caller then paints nothing rather than widening).
//
// START — the legacy id's own seq when that opener row is in the window (it is the request
// the task answers, and nothing ever stamped it), else the oldest row stamped with this task,
// WHATEVER its kind. That last clause used to read "for a legacy exchange the ONLY stamped
// rows are lifecycle events", and Q5 made it false: a session's REPLY messages now carry the
// thread argument too (prompt-framing's delivery call, and the forced tag in
// session-outbound-tag.js), so plain `message` rows of a legacy exchange are stamped as well.
// The code was already kind-agnostic here; only the comment claimed otherwise.
// END — the task's own terminal event; else the next OTHER `task_started` after the start,
// which supersedes an open task (group-thread.ts:478); else Infinity, an open task runs to
// the end of the thread. A `task_started` with no id of its own is malformed, not a
// successor, so it never truncates real history.
function taskWindow(rows, taskId, channelId) {
  if (!taskId) return null;
  const list = Array.isArray(rows) ? rows : [];
  const legacySeq = parseLegacyTaskSeq(taskId, String(channelId == null ? '' : channelId));
  let openerSeq = null; // the legacy opener, ONLY if it is in this fetch window
  let taggedMin = null; // the oldest row that names this task, whatever its kind
  for (const r of list) {
    const seq = rowSeq(r);
    if (seq === null) continue;
    if (legacySeq !== null && seq === legacySeq) openerSeq = seq;
    if (rowTaskId(r) === taskId && (taggedMin === null || seq < taggedMin)) taggedMin = seq;
  }
  let startSeq = taggedMin;
  if (openerSeq !== null) startSeq = taggedMin === null ? openerSeq : Math.min(openerSeq, taggedMin);
  if (startSeq === null) return null;
  // FIX H1: a settled task can be REOPENED and continued (recreateParkedShell posts a
  // new terminal each round), so the window must run to the LAST terminal of this task,
  // not the first — else every reopen re-hides the rounds after the first interruption.
  // A successor task's start still caps the scan so another task's traffic never leaks in.
  let successorSeq = Infinity;
  for (const r of list) {
    const seq = rowSeq(r);
    if (seq === null || seq <= startSeq || r.kind !== 'task_started') continue;
    const tag = rowTaskId(r);
    if (!tag || tag === taskId || seq >= successorSeq) continue;
    successorSeq = seq;
  }
  let lastTerminal = null;
  for (const r of list) {
    const seq = rowSeq(r);
    if (seq === null || seq < startSeq || seq >= successorSeq) continue;
    const terminal = r.kind === 'task_finished' || r.kind === 'task_failed';
    if (terminal && rowTaskId(r) === taskId && (lastTerminal === null || seq > lastTerminal)) lastTerminal = seq;
  }
  const endSeq = lastTerminal !== null ? lastTerminal : successorSeq;
  return { startSeq: startSeq, endSeq: endSeq };
}

// PURE (FIX Q1): does this row belong to THIS task? A row STAMPED with the task id does,
// wherever it sits. An UNSTAMPED row does when it falls inside the task's own seq window —
// that is the legacy exchange FIX F17 was reaching for, and the reason the whole-channel
// fallback existed. A row stamped with ANOTHER task never does, and neither does a row with
// no seq to place: the window narrows the fallback, it does not reopen it.
function inTaskScope(r, taskId, span) {
  const tag = rowTaskId(r);
  if (tag === taskId) return true;
  if (tag || !span) return false;
  const seq = rowSeq(r);
  return seq !== null && seq >= span.startSeq && seq <= span.endSeq;
}

// PURE: the two-party rows of one pass, newest LAST (stream order), uncapped.
//   - only real `message` rows (lifecycle events are the web card's story, not turns)
//   - `taskId` '' means ANY task (the FIX F17 pair-scoped pass, now reserved for a shell
//     with no task id at all); a non-empty taskId keeps only the rows inTaskScope admits.
//   - FIX F4: only rows written by one of the TWO parties of this session. `metadata.taskId`
//     is caller-settable, so a third channel member could otherwise land their own text
//     in this window (and in the seed) by stamping the task id on a post — and the
//     pair-scoped pass must not become a channel-wide read either. This rule is shared by
//     BOTH passes on purpose: the fallback drops the taskId test and NOTHING else.
//   - lane 'me' ONLY when the author IS the operator; the bound counterparty is 'them'.
//     Neither id known -> that side contributes nothing, so counterparty text can never
//     be painted as the operator's own words (and a shell with no bound counterparty at
//     all contributes only the operator's own rows — FIX N1).
//   - FIX N1: `stats`, when passed, collects the `seq` of every row KEPT and of every row
//     dropped for AUTHORSHIP, index-aligned with the returned array. That is the only drop the
//     caller reports on: a lifecycle event is not a turn, another task's row is not this
//     conversation, and an empty body has nothing to show. An UNATTRIBUTABLE row (author_user_id
//     is nulled when the account is deleted) counts as hidden: it is still not this session's,
//     and dropping it silently is the whole defect.
function pairRows(rows, taskId, selfId, peerId, span, stats) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.kind !== 'message') continue;
    if (taskId && !inTaskScope(r, taskId, span)) continue;
    // FIX N1: the empty-body test moved AHEAD of the author test so the count means the same
    // thing for everyone: a row with nothing in it was never a turn, so it is not "a message
    // that is not shown" whoever wrote it.
    const text = clamp(r.body, TEXT_CAP);
    if (!text) continue;
    const author = String(r.authorUserId == null ? '' : r.authorUserId);
    // An empty author matches neither id, so an unattributable row still never guesses a lane.
    const isSelf = !!author && !!selfId && author === selfId;
    const isPeer = !!author && !!peerId && author === peerId;
    if (!isSelf && !isPeer) { // a third member (or nobody we can name) is not this conversation
      if (stats) stats.hidden.push(rowSeq(r));
      continue;
    }
    if (stats) stats.kept.push(rowSeq(r));
    // `agent` is the AUTHOR KIND, not an identity: the renderer needs it to give a history
    // bubble the same surface its live twin has (an agent's own words look different from a
    // person's). Deliberately NOT an id — no author id crosses into the renderer (§H-9), and
    // the seed transcript reads only from/text/lane, so it is unaffected either way.
    out.push({
      from: oneLine(r.authorName, NAME_CAP),
      text: text,
      lane: isSelf ? 'me' : 'them',
      agent: r.authorKind === 'agent',
    });
  }
  return out;
}

// PURE: the read-only render entries for a session, newest LAST (stream order).
//
// TWO PASSES, chosen by whether this shell HAS a task (FIX Q1 — they are no longer tried in
// preference order, because "pass 1 found nothing" is the normal state of a legacy task and
// falling through to pass 2 is what replayed the whole channel):
//   1. TASK-SCOPED — every row stamped with this task, plus the UNSTAMPED two-party messages
//      inside the task's own seq window. A task with no anchor in the fetched rows yields
//      NOTHING; the caller says where to read it instead.
//   2. PAIR-SCOPED (FIX F17) — the recent conversation between the two parties, whatever
//      taskId the rows carry. ONLY for a shell with no task id at all (a responder that never
//      got a first-class task): with no task there is no window, and the pair IS the scope.
//
// The last `cap` of the chosen pass survive, so a long thread shows its most recent stretch.
// Order and cap are identical on both paths.
//
// FIX N1: returns `{ entries, othersHidden }`. `othersHidden` counts the rows the FIX F4 author
// rule dropped, SCOPED TO THE STRETCH ACTUALLY PAINTED — `stats.kept` is index-aligned with the
// pass, so the oldest surviving entry names the seq the count speaks for, and a drop older than
// that (outside the window the operator is looking at) is not claimed. With NOTHING painted
// there is no stretch to scope to, so every drop in scope counts: that is the case where the
// count is the only thing the operator gets, and it is what makes an empty window explain itself.
// A row with no usable seq cannot be placed, so it counts either way (disclose, do not hide).
function historyRead(rows, opts) {
  const o = opts || {};
  const taskId = String(o.taskId == null ? '' : o.taskId);
  const selfId = String(o.selfUserId == null ? '' : o.selfUserId);
  const peerId = String(o.peerUserId == null ? '' : o.peerUserId);
  const cap = Number.isFinite(o.cap) && o.cap > 0 ? o.cap : ENTRY_CAP;
  const stats = { kept: [], hidden: [] };
  let list;
  if (taskId) {
    const span = taskWindow(rows, taskId, o.channelId);
    if (!span) return { entries: [], othersHidden: 0 };
    list = pairRows(rows, taskId, selfId, peerId, span, stats);
  } else {
    list = pairRows(rows, '', selfId, peerId, null, stats);
  }
  const entries = list.slice(-cap);
  const oldest = entries.length ? stats.kept[stats.kept.length - entries.length] : null;
  const othersHidden = entries.length
    ? stats.hidden.filter((q) => q === null || oldest === null || q >= oldest).length
    : stats.hidden.length;
  return { entries: entries, othersHidden: othersHidden };
}

// The entries alone (the shape every caller before FIX N1 wanted).
function historyEntries(rows, opts) {
  return historyRead(rows, opts).entries;
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
  // FIX F17: a missing task id is NO LONGER disqualifying. It used to return here, which is
  // how a responder shell with no first-class task (taskId collapsed to '') opened with an
  // empty stream; the channel plus the bound counterparty are enough to read the pair's own
  // conversation. A channel id is still required — there is nothing to read without it.
  if (!deps || !s || !s.channelId) return false;
  // The operator's own id: needed to lane a row 'me'. Unknown identity fails CLOSED — the peer's
  // rows still render as 'them' and nothing claims to be the operator's. FIX N1 resolves it
  // BEFORE the read, because it now decides whether there is anything readable at all (below)
  // and because the read itself advances the human watermark (FOLLOW-UP F7): a window that can
  // paint nothing should not spend that. It is tier-1 local in the normal case (listener-io
  // reads the stored blob first), so this is not a second network hop.
  let selfId = null;
  try { selfId = await listenerIo.resolveIdentity(s.workspaceId); } catch (_) { selfId = null; }
  // FIX F4 / FIX N1: with NEITHER a bound counterparty NOR a known operator id, no row can be
  // laned honestly, so nothing is painted (and nothing is read) — one calm pointer at the
  // channel thread instead of a window full of the peer's words wearing the operator's lane. No
  // divider either: it would introduce a history that is not there. With ONE of the two known,
  // the rows THAT side wrote are attributable, so the window paints those and states what it is
  // not showing (the group-thread case, which used to open an empty box).
  if (!s.counterpartyId && !selfId) {
    deps.emit(s, { type: 'notice', level: 'info', text: copy.NO_PEER_NOTE });
    return false;
  }
  const rows = await fetchRows(s);
  if (!rows) {
    deps.emit(s, { type: 'notice', level: 'info', text: copy.FETCH_FAILED_NOTE });
    return false;
  }
  // FIX F4 (round 2): drop every row the inbound GATE is handling from the ENTRIES too,
  // not just from the seed. The fetch window always contains the message that popped the
  // gate (session-park records it on the shell before this read), so the held reply used
  // to render TWICE — once as the actionable Accept / Decline card and again as a muted
  // history bubble a few lines above it. Same predicate the seed uses, so the two agree.
  // FIX F17: this filter sits OUTSIDE historyEntries, so it covers the pair-scoped pass as
  // well — a held or declined body cannot walk back in through the widened taskId condition.
  const read = historyRead(rows, {
    taskId: s.taskId, channelId: s.channelId, peerUserId: s.counterpartyId,
    selfUserId: selfId, cap: ENTRY_CAP,
  });
  const entries = read.entries.filter((e) => !io.isGatedEntry(e, (s && s.gatedBodies) || []));
  // FIX N1: what the author rule hid. '' when it hid nothing, so a DM (where there IS no third
  // member) reads exactly as it did before.
  const hiddenText = copy.hiddenNote(read.othersHidden, !!s.counterpartyId, !!selfId);
  if (!entries.length) {
    // FIX N1: an empty window that is empty BECAUSE of the fence says so, instead of opening
    // as a blank box. This is the group-thread case: the operator can read the channel's
    // threads, but this window will not attribute other members' words to a lane.
    if (hiddenText) {
      deps.emit(s, { type: 'notice', level: 'info', text: hiddenText });
      return false;
    }
    // FIX Q1: a thread that HAS rows but none of THIS task's — the task's span fell out of
    // the newest-200 window — gets the same calm pointer the no-counterparty case gets,
    // rather than a silent widening to the channel. Same wording on purpose: a second
    // string would only tell the operator which internal filter missed. A genuinely empty
    // thread still stays quiet (there is nothing in the channel to point at).
    if (rows.length && s.taskId && !taskWindow(rows, String(s.taskId), s.channelId)) {
      deps.emit(s, { type: 'notice', level: 'info', text: copy.NO_PEER_NOTE });
    }
    return false; // an empty thread stays quiet (no empty divider)
  }
  deps.emit(s, { type: 'history', entries: entries });
  // FIX N1: the caveat lands AFTER the history block, not above it. The window scrolls to its
  // newest item, so a line above the divider is the first thing scrolled out of sight — which
  // would be a notice nobody reads, i.e. the silent drop again.
  if (hiddenText) deps.emit(s, { type: 'notice', level: 'info', text: hiddenText });
  // D3: a shell with NOTHING to resume starts a fresh SDK session on the first turn, so
  // the thread rides that turn as fenced DATA. FIX F1: the seed is NOT built here — the
  // transcript is assembled at first-turn time (io.withSeed), minus every body the gate
  // has handled. Stash the entries only.
  //
  // FIX N1: the SEED array is the rendered one plus the same count, so the agent is never
  // handed a partial transcript as if it were whole. It is a separate array on purpose — the
  // note must not become a history bubble.
  if (seedsFreshRun(s)) {
    s.pendingHistory = hiddenText
      ? entries.concat([copy.hiddenSeedEntry(read.othersHidden, !!selfId)])
      : entries;
  }
  return true;
}

// ─── END SESSION-HISTORY-PURE ───────────────────────────────────────────────────

module.exports = {
  bind,
  load,
  historyEntries,
  historyRead, // FIX N1: entries + the count of what the author rule hid
  taskWindow, // FIX Q1
  parseLegacyTaskSeq, // FIX Q1
  ENTRY_CAP,
  // §2 split: the strings now live in session-history-copy.js and are re-exported verbatim, so
  // nothing that imported them from here has to move.
  FETCH_FAILED_NOTE: copy.FETCH_FAILED_NOTE,
  NO_PEER_NOTE: copy.NO_PEER_NOTE, // FIX F4
  NO_PEER_PARTIAL_NOTE: copy.NO_PEER_PARTIAL_NOTE, // FIX N1
  NO_SELF_PARTIAL_NOTE: copy.NO_SELF_PARTIAL_NOTE, // FIX N1
  hiddenNote: copy.hiddenNote, // FIX N1
};
