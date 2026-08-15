// session-history.js — channel history for a reopened session shell.
//
// A recreated parked shell has an EMPTY local replay ring (the earlier turns died with the
// process), so main fetches this conversation's channel messages and paints them as READ-ONLY
// entries, lane-aligned like live turns, behind ONE "History from the channel" divider. One
// divider serves BOTH reads (task-scoped and pair-scoped) on purpose — a second wording would
// expose which internal filter matched. The string is renderer-owned
// (session-viewmodel.HISTORY_NOTE); main sends data. With nothing to resume, the same entries
// also seed the FRESH run's first turn as fenced context.
//
// MAIN-PROCESS ONLY. Fetch via api.js (Electron session Supabase cookies — auth.js says why
// not a bearer); renderer gets display strings only. ⚠ No token, body or absolute path ever
// crosses to the renderer (§H-9). A failed fetch is one calm notice, not an error state.
//
// The BEGIN/END PURE block references its leaf deps (apiFetch / listenerIo / io / diag) and the
// bind()-set `deps` as free vars, so test/session-history.test.mjs slices and fakes them.
//
// ⚠ SECURITY: `metadata.taskId` is CALLER-SETTABLE by any channel member, so task-id filtering
// alone lets a THIRD member's post into both the rendered history and the fenced seed. Rows are
// kept only when authorUserId is the operator or the session's bound counterparty, and the 'me'
// lane is reserved for rows the operator actually wrote.
// ⚠ That fence must never be SILENT: the same array is rendered AND seeded, so a dropped row
// has to be COUNTED and stated in both surfaces or the seed becomes the more complete-looking
// lie of the two.
//
// THE TWO PASSES (see historyRead):
//   task-scoped — rows stamped with this task, plus UNSTAMPED two-party messages inside the
//     task's own `seq` span, computed off the rows already fetched (no second request; a
//     `?taskId=` server filter was REJECTED). Mirrors the web thread grouper:
//       start — a legacy `task-<channelId>-<seq>` id CARRIES its opener's seq, so the starting
//               request is in the window though nothing stamped it; a first-class id starts at
//               the oldest row naming it.
//       end   — this task's `task_finished` / `task_failed`, else the next OTHER `task_started`
//               (group-thread.ts:478), else open-ended.
//     ⚠ A task with NO anchor in the fetched window paints NOTHING and says where to read it —
//     it must not fall back, or one 10-minute task replays months of the channel into the seed.
//   pair-scoped — ONLY for a shell with no task id at all: there is no window to compute and
//     the pair IS the scope. Widens WHICH rows count, never WHOSE.

const { apiFetch } = require('./api');
const listenerIo = require('./listener-io');
const io = require('./session-io'); // shared gate-body / seed-exclusion rule
const copy = require('./session-history-copy'); // every operator-facing string
const { diag } = require('./diag');

// ─── BEGIN SESSION-HISTORY-PURE (injectable; unit-tested via source extraction) ──

let deps = null;

// The engine binds { emit } here at load (the replay-aware emit, so entries buffered before the
// window finishes loading are still delivered).
function bind(d) {
  deps = d || null;
}

const ENTRY_CAP = 50; // read-only entries rendered (contract cap ~50)
// ⚠ A ROOM window has NO counterparty fence and (in the main room) no thread, so the pair/task
// scoping that bounds every other window bounds nothing here. At ENTRY_CAP a team window paints
// 50 of the channel's messages and seeds all 50 into the agent's first turn. A dozen is the
// "what is the room doing right now" window; older is one scroll away in the channel.
const ROOM_ENTRY_CAP = 12;
const FETCH_LIMIT = 200; // the server's MAX_MESSAGE_LIMIT for one read
const TEXT_CAP = 2000; // per-entry bound so one huge post cannot blow up the window
const NAME_CAP = 80; // the same bound every counterparty display name gets

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

// PURE (ported from the web grouper's parseLegacyTaskSeq, group-thread.ts): trailing seq N of a
// legacy deterministic task id `task-<channelId>-<N>`, where N is the seq of the message that
// STARTED the task. ⚠ The channel id is itself a UUID full of hyphens — anchor on the known
// prefix, never split on '-'. null for any other shape, keeping the reach-back legacy-only.
function parseLegacyTaskSeq(taskId, channelId) {
  if (!taskId || !channelId) return null;
  const prefix = `task-${channelId}-`;
  if (taskId.slice(0, prefix.length) !== prefix) return null;
  const rest = taskId.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

// PURE: a row's position, or null. ⚠ `seq` is a TABLE-WIDE identity, never a per-channel offset
// and never a fetch cursor — compare it only against other rows of THIS fetch. A row with no
// usable seq cannot be placed, so it fails CLOSED.
function rowSeq(r) {
  const n = Number(r && r.seq);
  return Number.isFinite(n) ? n : null;
}

// PURE: the server-stamped task id of a row, '' when it carries none.
function rowTaskId(r) {
  const meta = (r && r.metadata) || {};
  return String(meta.taskId == null ? '' : meta.taskId);
}

// PURE: the `seq` span of THIS task inside the rows already fetched, or null when the task has
// no anchor in them (caller then paints nothing rather than widening).
// START — the legacy id's own seq when that opener row is in the window, else the oldest row
//   stamped with this task, WHATEVER its kind (reply messages carry the tag too).
// END — this task's terminal event; else the next OTHER `task_started` after the start, which
//   supersedes an open task (group-thread.ts:478); else Infinity. ⚠ A `task_started` with no id
//   of its own is malformed, not a successor, so it never truncates real history.
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
  // ⚠ Run to the LAST terminal of this task, not the first: a settled task can be REOPENED and
  // continued (recreateParkedShell posts a new terminal each round), and the first-terminal
  // read re-hides every round after the first interruption. A successor task's start still
  // caps the scan so another task's traffic never leaks in.
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

// PURE: does this row belong to THIS task? A STAMPED row does, wherever it sits. An UNSTAMPED
// row does when it falls inside the task's seq window (the legacy exchange). ⚠ A row stamped
// with ANOTHER task never does, nor does one with no seq to place — the window narrows the
// fallback, it does not reopen it.
function inTaskScope(r, taskId, span) {
  const tag = rowTaskId(r);
  if (tag === taskId) return true;
  if (tag || !span) return false;
  const seq = rowSeq(r);
  return seq !== null && seq >= span.startSeq && seq <= span.endSeq;
}

// PURE: the two-party rows of one pass, newest LAST (stream order), uncapped.
//   - only real `message` rows (lifecycle events are the web card's story, not turns)
//   - `taskId` '' means ANY task (pair-scoped pass); non-empty keeps only what inTaskScope
//     admits.
//   - ⚠ only rows written by one of the TWO parties. `metadata.taskId` is caller-settable, so
//     a third member could otherwise land text in this window AND the seed by stamping the id.
//     Shared by BOTH passes: the fallback drops the taskId test and NOTHING else.
//   - lane 'me' ONLY when the author IS the operator; bound counterparty is 'them'. Neither id
//     known -> that side contributes nothing, so counterparty text can never be painted as the
//     operator's words.
//   - `stats`, when passed, collects the `seq` of every row KEPT and of every row dropped for
//     AUTHORSHIP, index-aligned with the returned array. ⚠ An UNATTRIBUTABLE row (author id
//     nulled on account deletion) counts as hidden — dropping it silently is the whole defect.
//   - `room`: the TEAM binding keeps EVERY author. ⚠ Same function, not a fork, so "the pair
//     fence is unchanged" is a fact about one body of code — with `room` falsy this reads byte
//     for byte as before. Still fenced in room mode: ONE channel (per-channel fetch,
//     authenticated as the operator), `message` rows only, 'me' lane reserved for the operator.
function pairRows(rows, taskId, selfId, peerId, span, stats, room) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.kind !== 'message') continue;
    if (taskId && !inTaskScope(r, taskId, span)) continue;
    // ⚠ Empty-body test sits AHEAD of the author test so the hidden count means the same thing
    // for everyone: an empty row was never a turn, whoever wrote it.
    const text = clamp(r.body, TEXT_CAP);
    if (!text) continue;
    const author = String(r.authorUserId == null ? '' : r.authorUserId);
    // An empty author matches neither id, so an unattributable row still never guesses a lane.
    const isSelf = !!author && !!selfId && author === selfId;
    const isPeer = !!author && !!peerId && author === peerId;
    if (!room && !isSelf && !isPeer) { // a third member (or nobody we can name) is not this conversation
      if (stats) stats.hidden.push(rowSeq(r));
      continue;
    }
    if (stats) stats.kept.push(rowSeq(r));
    // `agent` is the AUTHOR KIND, not an identity. ⚠ Deliberately not an id — no author id
    // crosses into the renderer (§H-9). The seed transcript reads only from/text/lane.
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
// ⚠ The two passes are chosen by WHETHER the shell has a task, NOT tried in preference order:
// "task pass found nothing" is the normal state of a legacy task, and falling through to the
// pair pass is what replays the whole channel.
// The last `cap` of the chosen pass survive; order and cap identical on both paths.
//
// Returns `{ entries, othersHidden }`. `othersHidden` counts author-rule drops SCOPED TO THE
// STRETCH ACTUALLY PAINTED — `stats.kept` is index-aligned, so the oldest surviving entry names
// the seq the count speaks for. With NOTHING painted every in-scope drop counts: that is what
// makes an empty window explain itself. A row with no usable seq counts either way (disclose).
function historyRead(rows, opts) {
  const o = opts || {};
  const taskId = String(o.taskId == null ? '' : o.taskId);
  const selfId = String(o.selfUserId == null ? '' : o.selfUserId);
  const peerId = String(o.peerUserId == null ? '' : o.peerUserId);
  const cap = Number.isFinite(o.cap) && o.cap > 0 ? o.cap : ENTRY_CAP;
  const stats = { kept: [], hidden: [] };
  let list;
  // ⚠ `bind` must say 'room' EXACTLY — absent, junk and 'pair' all take the two-party fence,
  // so the widening is opt-in per session.
  if (o.bind === 'room') {
    const roomSpan = taskId ? taskWindow(rows, taskId, o.channelId) : null;
    if (taskId && !roomSpan) return { entries: [], othersHidden: 0 };
    const all = pairRows(rows, taskId, selfId, '', roomSpan, null, true);
    return { entries: all.slice(-cap), othersHidden: 0 };
  }
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

// The entries alone.
function historyEntries(rows, opts) {
  return historyRead(rows, opts).entries;
}

// Authenticated read: the NEWEST `FETCH_LIMIT` rows of the channel, ascending. null on any
// failure — the caller shows one calm notice.
// ⚠ `since` is OMITTED on purpose. channel_messages.seq is GENERATED ALWAYS AS IDENTITY on the
// TABLE, not a per-channel offset, so a (cursor - 200) window holds an arbitrary number of THIS
// channel's rows (often zero) and cursor 0 asks for the OLDEST 200 of the thread. With no
// `since` the repository takes its newest-`limit`-then-reverse branch.
// ⚠ KNOWN (F7): this GET advances the HUMAN read watermark, so a window the operator never
// looked at can mark the thread read. Needs a server-side no-watermark read path.
async function fetchRows(s) {
  try {
    const res = await apiFetch(
      `/api/channels/${s.channelId}/messages?limit=${FETCH_LIMIT}`,
      { workspaceId: s.workspaceId, timeoutMs: 15000 }
    );
    if (!res.ok) {
      diag('session-history: fetch failed', res.status); // ⚠ status only — never a body
      return null;
    }
    const data = await res.json();
    return Array.isArray(data && data.messages) ? data.messages : [];
  } catch (err) {
    diag('session-history: fetch error', err && err.message);
    return null;
  }
}

// Will this shell start a FRESH sdk session (and therefore want the seed)?
// ⚠ Decided when the SHELL IS CREATED (session-engine stamps s.freshRun), NOT when this fetch
// resolves: reading (!resumeSdkId && !sdkSessionId) loses the seed whenever a racing
// system/init stamps an sdkSessionId first. A caller with no marker falls back to that read.
// ⚠ A first turn that already went out disqualifies: io.withSeed clears `freshFraming` while
// building it, so `false` means the operator typed mid-fetch and seeding would prepend
// "Earlier messages from this task" to turn TWO. Entries are still painted; only the seed is
// skipped.
function seedsFreshRun(s) {
  if (typeof s.freshRun === 'boolean') return s.freshRun && s.freshFraming !== false;
  return !s.resumeSdkId && !s.sdkSessionId;
}

// Load + paint. ⚠ Awaited by the recreate path — entries must be painted and stashed BEFORE the
// window can take a turn. Never throws into it.
async function load(s) {
  // A missing task id is NOT disqualifying (the pair pass covers it); a channel id is.
  if (!deps || !s || !s.channelId) return false;
  // Operator's own id, needed to lane a row 'me'. Unknown fails CLOSED — the peer's rows still
  // render 'them' and nothing claims to be the operator's. ⚠ Resolved BEFORE the read: it
  // decides whether anything is readable at all, and the read itself spends the human
  // watermark (F7). Tier-1 local in the normal case, so not a second network hop.
  let selfId = null;
  try { selfId = await listenerIo.resolveIdentity(s.workspaceId); } catch (_) { selfId = null; }
  // ⚠ With NEITHER a bound counterparty NOR a known operator id no row can be laned honestly,
  // so nothing is painted and nothing is read — a calm pointer, and no divider (that would
  // introduce a history that is not there). With ONE known, that side's rows are attributable.
  // ⚠ A ROOM-bound session has NO counterparty by construction, so the pair-fence bail does not
  // apply; unknown operator id costs only the 'me' lane.
  const room = s.bind === 'room';
  if (!room && !s.counterpartyId && !selfId) {
    deps.emit(s, { type: 'notice', level: 'info', text: copy.NO_PEER_NOTE });
    return false;
  }
  const rows = await fetchRows(s);
  if (!rows) {
    deps.emit(s, { type: 'notice', level: 'info', text: copy.FETCH_FAILED_NOTE });
    return false;
  }
  // ⚠ Gate-held rows are dropped from the ENTRIES as well as the seed: the fetch window always
  // contains the message that popped the gate, so without this the held reply renders TWICE —
  // as the actionable Accept/Decline card and as a muted history bubble above it. Same
  // predicate the seed uses. ⚠ Sits OUTSIDE historyEntries so it covers the pair-scoped pass
  // too — a held or declined body must not walk back in through the widened taskId condition.
  const read = historyRead(rows, {
    taskId: s.taskId, channelId: s.channelId, peerUserId: s.counterpartyId,
    // 'room' widens WHOSE rows count and narrows HOW MANY — every author, recent only.
    selfUserId: selfId, cap: room ? ROOM_ENTRY_CAP : ENTRY_CAP, bind: s.bind,
  });
  const entries = read.entries.filter((e) => !io.isGatedEntry(e, (s && s.gatedBodies) || []));
  // What the author rule hid; '' when nothing, so a DM reads as it always did.
  const hiddenText = copy.hiddenNote(read.othersHidden, !!s.counterpartyId, !!selfId);
  if (!entries.length) {
    // A window empty BECAUSE of the fence says so rather than opening as a blank box.
    if (hiddenText) {
      deps.emit(s, { type: 'notice', level: 'info', text: hiddenText });
      return false;
    }
    // Rows exist but none of THIS task's (its span fell out of the newest-200 window): calm
    // pointer, never a silent widening to the channel. ⚠ Same wording as the no-counterparty
    // case on purpose — a second string tells the operator which internal filter missed.
    if (rows.length && s.taskId && !taskWindow(rows, String(s.taskId), s.channelId)) {
      deps.emit(s, { type: 'notice', level: 'info', text: copy.NO_PEER_NOTE });
    }
    return false; // an empty thread stays quiet (no empty divider)
  }
  deps.emit(s, { type: 'history', entries: entries });
  // ⚠ Caveat lands AFTER the history block: the window scrolls to its newest item, so a line
  // above the divider is scrolled out of sight — the silent drop again.
  if (hiddenText) deps.emit(s, { type: 'notice', level: 'info', text: hiddenText });
  // A shell with NOTHING to resume starts a fresh SDK session, so the thread rides the first
  // turn as fenced DATA. ⚠ The seed is NOT built here — io.withSeed assembles it at first-turn
  // time minus every gate-handled body. Stash entries only.
  // ⚠ Seed = rendered entries + the same hidden count, in a SEPARATE array: the agent must not
  // get a partial transcript as if it were whole, and the note must not become a history bubble.
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
  historyRead, // entries + the count of what the author rule hid
  taskWindow,
  parseLegacyTaskSeq,
  ENTRY_CAP,
  ROOM_ENTRY_CAP,
  // Strings live in session-history-copy.js; re-exported verbatim so no importer moved.
  FETCH_FAILED_NOTE: copy.FETCH_FAILED_NOTE,
  NO_PEER_NOTE: copy.NO_PEER_NOTE,
  NO_PEER_PARTIAL_NOTE: copy.NO_PEER_PARTIAL_NOTE,
  NO_SELF_PARTIAL_NOTE: copy.NO_SELF_PARTIAL_NOTE,
  hiddenNote: copy.hiddenNote,
};
