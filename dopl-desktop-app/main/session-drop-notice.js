// WHEN AN AGENT STOPS WITHOUT REPORTING, SOMEBODY IS TOLD. The executor behind the reducer's
// `notice` effect (`session-effects.js › parkNoticeFor` / `endNoticeFor`).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
// Two runs vanished in channel bb0f57db on 2026-10-10 and nothing in the product was wrong by its
// own lights:
//   `viloxuwt` (Notif Account Store) — ran 7 minutes, edited and deleted files, posted NOTHING to
//              the channel, parked on turn end, reaped by the 12h abandonment bound.
//   `jsk2zowk` (Row Cap Fix) — posted a MILESTONE, ran tests that left two FAILING, parked, reaped
//              12h later. No DONE.
// Each wrote exactly one row: a `task_progress` lifecycle marker carrying "This session went
// inactive." That marker is correct for its own job — a CALM note to a waiting counterparty, free
// of local detail by design — and useless as a report: it addresses nobody, so it wakes no agent
// and notifies no person; it names no agent; and it states no cause. The orchestrator that
// launched both went on believing the work was in flight. The marker stays. This is the report.
//
// ── THE TWO HALVES, AND WHY NEITHER IS THE OTHER ─────────────────────────────────────────────
// A CHANNEL POST is the durable record, readable by whoever launched the agent, in the room where
// they are already reading. It deliberately triggers nothing (`postDropNotice`'s `intent: 'chat'`
// note says why that is load-bearing and not caution).
// AN OPERATOR BANNER (`agent_dropped`) is the interruption, and it is the only half that reaches a
// person who is not looking. It runs the operator's own preference first, like every other event.
// Posting only would be silent to anyone away from the room; notifying only would leave no record.
//
// ⚠ WHAT THIS MODULE MAY NOT DO. It may not address the launching AGENT, because nothing records
// which agent filed the directive — `channel_launch_directives` has `operator_user_id` and no
// requester column (the migration that adds one is written, unapplied). So the post is unaddressed
// and the room is the delivery. Faking an address by writing "@orchestrator" into the body would
// reach nobody and read as though it had.

const { diag } = require('./diag');

// One notice per (session cycle, code). The reducer cannot fire a park twice for one turn, but a
// park→resume→park pair is two genuine drops and must stay two rows — so the cycle is in the key,
// exactly as `trigger-outcomes.js › echoSeq` folds it into the lifecycle marker's id.
const MAX_REMEMBERED = 64;
const said = new Set();

function firstTime(key) {
  if (said.has(key)) return false;
  if (said.size >= MAX_REMEMBERED) said.delete(said.values().next().value);
  said.add(key);
  return true;
}

/** The notice's idempotency unit: the slot key, the resume cycle, and which drop it is. */
function noticeKey(s, code) {
  const cycle = (s && (s.sdkSessionId || s.sessionId)) || 'init';
  return `drop-${(s && s.key) || 'session'}#${cycle}#${code}`;
}

/** This agent as a reader knows it: its stored display name, else `#<id>`, else "An agent". */
function agentLabel(s) {
  const id = (s && s.agentId) || '';
  try {
    const name = require('./agent-names').displayNameFor(id);
    if (name) return name;
  } catch (_err) { /* the rename store is electron-backed; a miss is not worth a throw */ }
  return id ? `#${id}` : 'An agent';
}

// ─── BEGIN DROP-NOTICE-PURE (pure; unit-tested via source extraction) ────────
//
// `diag` is a free var from here down.

/** A bounded, single-line fragment — a ring entry's text is arbitrary model output. */
function oneLine(value, cap) {
  if (typeof value !== 'string') return '';
  const max = typeof cap === 'number' && cap > 0 ? cap : 80;
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/**
 * WHAT IT WAS LAST DOING, from the narration ring — the one thing that makes a drop notice
 * actionable rather than a bereavement announcement. A tool name beats prose: "last: Bash" says
 * where to look, where a truncated sentence of reasoning does not.
 *
 * ⚠ SKIPS `status` ENTRIES. The last entry at park time is the park's own "Paused — idle", so
 * reading the tail blindly reports the symptom as the cause.
 */
function lastActivityOf(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i];
    if (!e || typeof e !== 'object' || e.kind === 'status') continue;
    if (e.kind === 'tool' && oneLine(e.tool, 40)) return oneLine(e.tool, 40);
    if (e.kind === 'result') return 'a tool result';
    if (e.kind === 'post') return 'a channel post';
    if (e.kind === 'assistant') return oneLine(e.text, 60) || 'thinking';
  }
  return '';
}

/**
 * THE SENTENCE. Plain, short, and it names the three facts a launcher needs: which agent, what
 * happened to it, and where it stopped. No em dash (product copy rule), no local machine detail,
 * no tool arguments.
 */
function noticeText(label, code, reason, last) {
  const what = code === 'parked_silent'
    ? `${label} paused without reporting`
    : `${label} ended: ${reason || 'stopped'}`;
  const tail = last ? ` (last: ${last})` : '';
  const advice = code === 'parked_silent'
    ? ' It is still resumable, so a reply to it will wake it.'
    : ' It is gone, so this work needs relaunching.';
  return `${what}${tail}.${advice}`;
}

// ─── END DROP-NOTICE-PURE ────────────────────────────────────────────────────

/** The operator's banner. Registered as `agent_dropped`, so the Notifications tab can mute it. */
function notifyOperator(label, code, reason) {
  try {
    require('./notification-route').raise('agent_dropped', {
      title: code === 'parked_silent' ? 'An agent paused without reporting' : 'An agent stopped',
      body: code === 'parked_silent'
        ? `${label} ended its turn without posting anything.`
        : `${label} ended: ${reason || 'stopped'}.`,
    });
  } catch (err) {
    diag('session-drop-notice: banner failed —', (err && err.message) || 'error');
  }
}

/**
 * Report one drop. Best-effort and never throws: this runs inside `settle`'s effect list, and a
 * failed notice must not abort a teardown that has a child process to kill.
 *
 * ⚠ WINDOWLESS ONLY. A session the operator is watching in a window needs no post about having
 * paused: they are looking at it, and the Agents tab already reads the same state off the local
 * projection. The drop that cost us was the one nobody could see. This is the one policy call the
 * reducer cannot make — `windowless` is a property of the session object, not of reducer state.
 */
function report(s, eff) {
  try {
    if (!s || !eff || !s.channelId) return false;
    if (s.windowless !== true) return false;
    const code = eff.code;
    const key = noticeKey(s, code);
    if (!firstTime(key)) {
      diag('session-drop-notice: already reported', code, 'for this cycle');
      return false;
    }
    const label = agentLabel(s);
    let last = '';
    try { last = lastActivityOf(require('./session-narration').ringFor(s)); }
    catch (_err) { /* no ring is not a reason to say nothing */ }
    const text = noticeText(label, code, eff.reason, last);
    diag('session-drop-notice:', code, s.agentId || '(no id)', '—', text);
    notifyOperator(label, code, eff.reason);
    // ⚠ REGISTERED, NOT MERELY FIRED (2026-10-12) — the same argument as the lifecycle marker's
    // in `trigger-outcomes.js › onEnded`. This notice is issued from inside `settle`, and a
    // settle reached by a QUIT is one tick from `app.quit()`; unheld, the POST died with the
    // process and the launcher learned nothing about the agent they were waiting on.
    // `track` returns the same promise, so the reporting below is unchanged.
    void require('./session-terminal-posts').track(require('./channel-post').postDropNotice(
      { channel: { id: s.channelId }, workspaceId: s.workspaceId },
      text,
      { clientMsgId: key, summary: oneLine(text, 180), taskId: s.taskId || undefined, sessionId: s.key },
    )).then((posted) => {
      if (!posted) diag('session-drop-notice: POST FAILED — the drop is on this machine only', code, s.agentId || '');
    }).catch((err) => diag('session-drop-notice: post error —', (err && err.message) || 'error'));
    return true;
  } catch (err) {
    diag('session-drop-notice: report threw —', (err && err.message) || 'error');
    return false;
  }
}

module.exports = { report, noticeKey, oneLine, lastActivityOf, noticeText, MAX_REMEMBERED };
