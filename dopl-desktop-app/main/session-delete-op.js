// DELETE ONE AGENT — the body of `sessions:delete` (2026-08-25, Samuel's ruling).
//
// ⚠ SPLIT OUT OF `main/session-ipc-ops.js` UNDER THE HARD 500-LINE §1 CAP, on the
// `session-launch-op.js` / `claude-signin-op.js` precedent. That file owns the IPC SURFACE —
// which verbs exist, who may call them, how a bad payload is refused — and this owns WHAT ONE
// DELETION IS. The wrapper stays written LITERALLY at the `ipcMain.handle` site, because
// `test/channel-ipc-sender.test.mjs`'s structural belt reads exactly that shape; this module is
// called FROM inside it and is not a second door. The payload is still untrusted here: the split
// moved the code, not the boundary.
//
// ── WHAT DELETE IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────
//
// ⚠ **DELETION IS LOCAL. THE CHANNEL RECORD IS IMMUTABLE BY IT.** Everything the agent POSTED
// is `channel_messages` on the SERVER — the shared record, owned by the channel, read by both
// members — and nothing in this file can reach it. What goes is this machine's own view of how
// the work happened: the frozen narration ring, the durable record, the resume map, the ended
// card, the queued-notice guard, the display name, and any window opened onto it. A reader
// meeting a deleted agent's messages still sees `Agent #<id>` on every one, because the id rides
// the MESSAGE (`components/channels-v2/agents-model.ts › parseAgentPostStamp` reads it off
// `client_msg_id`) and never a local table. INVARIANTS §5 / §11.
//
// ⚠ **THERE IS ONE STOP PATH AND THIS IS NOT A SECOND ONE.** A LIVE agent is ended through
// `session-engine.js › controlByTask({action:'end'})` — the same reducer event the Agents tab's
// End button dispatches, reaching the same `session-teardown.js › settle`. A delete that tore
// down its own way would be a second set of the C3 bugs (an orphaned `claude` child still
// holding this session's pre-approved `dopl_channel` access). END, THEN PURGE — in that order,
// because `settle` is what freezes the history this purge then drops, and it runs SYNCHRONOUSLY
// inside the dispatch. Reversed, the purge would run first and `settle` would write the record
// back a moment later, resurrecting the card it was asked to remove.
//
// ⚠ **THE SERVER-SIDE `ended` PROJECTION IS LEFT EXACTLY AS `end` LEAVES IT.** The lifecycle
// echo an end raises is a PEER-FACING FACT — the waiting member's card stops pulsing — not local
// history, and this lane neither suppresses nor repeats it. `channel_sessions` rows are dropped
// from the wire for ended agents anyway (`session-state-push.js › liveForWire`), so the row
// leaves by omission on the next push and there is nothing here to delete server-side.
//
// ⚠ **THE THIRD COORDINATE IS REQUIRED HERE, UNIQUELY.** Every other op in this family lets an
// omitted `agentId` resolve to the OLDEST live agent on the thread, because that is byte-for-byte
// what a caller got before multiplayer existed. A DESTRUCTIVE op may not have that fallback: the
// caller is looking at ONE card, "the oldest one" is a DIFFERENT agent, and nothing would report
// the substitution. An unnamed agent is refused rather than guessed at.

const { isUuid } = require('./ipc-guards');
const { isAgentId } = require('./agent-id');
const { diag } = require('./diag');

/**
 * Delete one agent and every local trace of it. Returns `{ ok }`, plus `ended: true` when this
 * call is what stopped a session that was still running.
 *
 * ⚠ REFUSALS: a payload naming no channel or no agent answers a bare `{ ok: false }`, the same
 * shape the sender binding refuses with — a hostile page must not learn which one it hit. An
 * address that resolves to NO agent (neither live nor retained) answers
 * `{ ok: false, reason: 'no-agent' }`, on the same terms `controlByTask` answers `no-session`:
 * the guard has already passed, so the word costs nothing and a silent success over nothing is
 * the swallow this family has been bitten by twice.
 */
function deleteAgent(payload) {
  const p = payload || {};
  if (!isUuid(p.channelId)) return { ok: false };
  const agentId = isAgentId(p.agentId) ? String(p.agentId) : '';
  if (!agentId) return { ok: false };
  const address = {
    channelId: String(p.channelId),
    taskId: String(p.taskId == null ? '' : p.taskId),
    agentId: agentId,
  };
  const key = require('./session-store').slotKey(address);

  // 1. STOP IT, THROUGH THE ONE TEARDOWN. A refusal here is the ordinary case — an ended agent
  //    left the registry when it settled — so it is read as "there was nothing live", never as a
  //    failure. `controlByTask` resolves the agent EXACTLY, because the id is required above.
  let ended = false;
  try {
    const engine = require('./session-engine');
    ended = typeof engine.controlByTask === 'function'
      && engine.controlByTask({ ...address, action: 'end' }).ok === true;
  } catch (err) {
    diag('session-delete: end failed —', (err && err.message) || String(err));
  }

  // 2. DID THIS ADDRESS EVER NAME AN AGENT? After the end above, a real one has a frozen history
  //    record under this exact key. Nothing on either side means the card the operator clicked is
  //    describing something this machine cannot find, and inventing a success would hide that.
  let known = ended;
  if (!known) {
    try { known = !!require('./agent-history').historyFor(key); }
    catch (_err) { known = false; }
  }
  if (!known) return { ok: false, reason: 'no-agent' };

  // 3. PURGE EVERY LOCAL STORE, through the ONE list that knows what they are
  //    (`agent-retention.js`). Best effort per store, for that file's own reason: a partial purge
  //    that stops at the first failure leaves exactly the orphans it exists to prevent.
  try { require('./agent-retention').forgetAgent(key); }
  catch (err) { diag('session-delete: purge failed —', (err && err.message) || String(err)); }

  // 4. THE DISPLAY NAME GOES WITH THE AGENT (Samuel's "all information attached" ruling). It is
  //    keyed by `agentId` rather than by session key, so the sweep's list cannot reach it and it
  //    is cleared here instead. Transcripts fall back to `Agent #<id>`, which is what an unnamed
  //    agent has always rendered as.
  try { require('./agent-names').clear(agentId); }
  catch (err) { diag('session-delete: name clear failed —', (err && err.message) || String(err)); }

  // 5. A WINDOW ONTO A DELETED AGENT IS A COMPOSER POINTED AT NOTHING. Close it.
  try { require('./agent-window').closeAgentWindow(address); }
  catch (err) { diag('session-delete: window close failed —', (err && err.message) || String(err)); }

  // 6. MAKE THE CARD GO. The projection is recomputed from the live registry plus the durable
  //    history, both of which just moved; `touch()` is what schedules the push that notices.
  //    ⚠ Belt, not the only one — `releaseEnded` touches too — but that cleaner is only bound
  //    once `index.js` has run, and a deletion must not depend on which wave booted first.
  try { require('./session-summary').touch(); }
  catch (err) { diag('session-delete: summary touch failed —', (err && err.message) || String(err)); }

  return { ok: true, ended };
}

module.exports = { deleteAgent };
