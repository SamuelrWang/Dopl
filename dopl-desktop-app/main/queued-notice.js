// The "queued, not ignored" milestone for a deferred thread trigger (2026-07-31).
//
// THE HOLE THIS FILLS. The desktop defers an ACCEPTED trigger whenever the slot it needs
// is already working: the engine refuses a second session for the SAME (channel, thread)
// (session-engine.launch -> skipped 'busy'), and the headless fallback refuses a second
// spawn for the same session key or one past the machine's concurrency cap
// (⚠ ONE defer left since 2026-08-20: the engine's `busy` skip. The headless lane's own
// `at-cap` defer went with `session-spawner.runForChannel` and `session-pool.js`.) Both defers answered with the RESEND bubble ALONE,
// and that bubble is posted through postResult with NO metadata — which by design lands
// OUTSIDE every thread (see channel-post.js). So the person watching the THREAD saw
// nothing at all while the resend loop ran (measured live: 2m13s to pickup against 15s for
// the first thread) and had no way to tell "queued behind something" from "ignored".
//
// WHAT THIS IS NOT. A notice, not a scheduler. Nothing here queues, spawns, settles or
// retries — trigger.js still owns the defer and its outcome, and this cannot change it:
// postTaskEvent swallows its own errors, `announce` swallows anything left, and its return
// value is read by nobody in the flow.
//
// ONE PER (channel, thread), TWICE OVER. The clientMsgId is derived from the THREAD id, so
// the SERVER dedupes every later attempt — including the peer's resend, which arrives under
// a new seq but the same thread — and `announced` below refuses to even attempt a second
// post in this process. The two agree on purpose: the server's dedupe is per-thread for
// good, so the local guard is too.
//
// FIRST-CLASS THREADS ONLY. A legacy `task-<channel>-<seq>` id resolves to no channel_tasks
// row, so a milestone tagged with it groups into nothing the requester is watching; skip it
// and let the RESEND bubble be the whole answer, exactly as before.

const { postTaskEvent } = require('./channel-post');
const { sessionKey } = require('./session-store'); // D1: THE (channel, thread) key definition
const { diag } = require('./diag');

// ─── BEGIN QUEUED-NOTICE-PURE (announce; unit-tested via source extraction) ────
// Free vars: postTaskEvent / sessionKey / diag (required above, faked by the test), so the
// behavior below is driven with no host binding of its own.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// House copy voice: no em dashes, states the situation and what happens next, and leaks
// nothing local (not the machine, not the other thread's title, not who asked for it).
const QUEUED_BODY =
  "Queued on my side behind an active session in this channel. I'll pick it up when that frees.";
const QUEUED_SUMMARY = 'Queued behind an active session';
// Bounded: a listener runs for weeks and must not grow this set without a ceiling.
const MAX_ANNOUNCED = 256;

// Keyed by the SAME sessionKey the pool and the engine registry use (D1) — one definition,
// no second spelling of the (channel, thread) identity anywhere in main/.
const announced = new Set(); // sessionKey already claimed

// The 7-day sweep's cleaner (`main/agent-retention.js`). ⚠ Without it this Set is the one
// per-agent structure with NO bound at all: it only ever grows, one entry per thread this
// process has announced on, for the life of the run.
function forgetKeys(keys) {
  for (const key of Array.isArray(keys) ? keys : [keys]) announced.delete(String(key || ''));
}

function remember(key) {
  announced.add(key);
  // Insertion-ordered, so the first value out is the oldest key.
  while (announced.size > MAX_ANNOUNCED) announced.delete(announced.values().next().value);
}

// Post the queued milestone into `taskId`'s thread for an ACCEPTED-but-deferred trigger.
// `where` names the defer point and reaches the log only. Returns true on a confirmed
// post; false on a skip or a failure. NEVER throws.
async function announce(entry, m, taskId, where) {
  const id = String(taskId || '');
  if (!UUID.test(id)) {
    diag('queued notice skipped: not a first-class thread id', where);
    return false;
  }
  const key = sessionKey(entry.channel.id, id);
  if (announced.has(key)) {
    diag('queued notice skipped: already announced', where, id.slice(0, 8));
    return false;
  }
  // Claim BEFORE the attempt, so a retry inside one episode does not even try a second
  // post. The trade is a notice lost to a transient failure; the RESEND bubble still went
  // out either way, and a duplicate milestone on the thread is the worse outcome.
  remember(key);
  let ok = false;
  try {
    ok = await postTaskEvent(entry, m, 'task_progress', id, undefined, QUEUED_BODY, {
      clientMsgId: `queued-${id}`,
      summary: QUEUED_SUMMARY,
    });
  } catch (err) {
    diag('queued notice error', where, err && err.message); // fail-soft: never reaches the caller
    return false;
  }
  diag('queued notice', ok ? 'posted' : 'post failed', where, id.slice(0, 8));
  return ok === true;
}
// ─── END QUEUED-NOTICE-PURE ───────────────────────────────────────────────────

module.exports = { announce, forgetKeys, QUEUED_BODY, QUEUED_SUMMARY };
