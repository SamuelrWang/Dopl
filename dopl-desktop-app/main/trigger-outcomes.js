// trigger-outcomes.js — the terminal echoes for a request that produced NO reply.
//
// Extracted from trigger.js to hold that AT-CAP file (§2, 500 lines) under the cap while
// H2 adds the permission-arm consumption to the approval path. Everything here shares one
// shape: the request is over, nothing was (or will be) posted as an answer, and the ONLY
// job left is to settle the requester's card so it stops pulsing "active".
//
// Each posts `task_failed` with the SAME deterministic taskId as the original
// `task_started`, so they group, and the metadata flag is what the web renders:
//   { declined: true }     → a calm "Declined" (a human said no)
//   { dropped: true }      → "Reply was not sent" (an approved reply was cancelled)
//   { interrupted: true }  → a calm "Interrupted" (the app died mid-spawn)
//   (no flag)              → a REAL error
// That distinction is load-bearing: a bare task_failed reads as a fault, and none of
// these are faults.
//
// SEAM: the three record→shape helpers stay in trigger.js (they are shared with the
// approval path) and are injected via bind(), the session-park idiom. Leaf deps are
// required directly; nothing here requires trigger.js back.

const { Notification } = require('electron');
const targeting = require('./targeting');
const watcher = require('./consent-watcher');
const sessionEngine = require('./session-engine');
const channelPrefs = require('./channel-prefs');
const { postTaskEvent } = require('./channel-post');
const { diag } = require('./diag');

let deps = null; // { entryFromRecord, msgFromRecord, taskIdFor }

function bind(d) {
  deps = d || null;
}

// ── Resolver: outbound CANCELLED (web Cancel / expiry) → drop, no re-spawn ────
async function outboundCancelled(rec) {
  const entry = deps.entryFromRecord(rec);
  const m = deps.msgFromRecord(rec, '');
  diag('outbound review: reply dropped (cancelled/expired)');
  // M-4: a cancelled reply is NOT a finished request; do not tell teammates an
  // answer was delivered. task_failed WITHOUT declined → this is a drop, not a deny.
  await postTaskEvent(
    entry, m, 'task_failed', deps.taskIdFor(rec),
    { durationMs: Date.now() - rec.startedAt, dropped: true },
    'Reply was not sent.'
  );
  watcher.settle(rec.key, 'cancelled');
}

// ── Resolver: inbound DENIED → declined echo ─────────────────────────────────
async function inboundDenied(rec) {
  const entry = deps.entryFromRecord(rec);
  const m = deps.msgFromRecord(rec, '');
  // Decision echo: the web renders task_failed + { declined: true } as a calm
  // "Declined", distinct from an error (which carries no declined flag).
  await postTaskEvent(entry, m, 'task_failed', deps.taskIdFor(rec), { declined: true }, 'Request declined');
  // Item 8 step 5/6: close the pre-consent window (no-op if it was never opened,
  // adopted, or parked). NO SDK ever ran for a denied request.
  try { sessionEngine.closeConsentWindow(rec.key, 'denied'); } catch (_) { /* best effort */ }
  // H2: drop the permission arm this request may have carried. It is single-use and
  // expiring anyway, so this is not what makes the invariant hold — but a posture the
  // operator chose for a request they then REFUSED should not sit around waiting for
  // the next one, and clearing it here means the card they open next shows the truth.
  try { channelPrefs.clearPermissionPreset(rec.channelId); } catch (_) { /* best effort */ }
  watcher.settle(rec.key, 'denied');
}

// ── Resolver: inbound EXPIRED → silent drop ──────────────────────────────────
async function inboundExpired(rec) {
  diag('inbound expired (no decision) — dropping', rec.key);
  // Item 8: close the pre-consent window if it is still open (no-op otherwise).
  try { sessionEngine.closeConsentWindow(rec.key, 'expired'); } catch (_) { /* best effort */ }
  // H2: same reasoning as the deny above — an unanswered request leaves no posture behind.
  try { channelPrefs.clearPermissionPreset(rec.channelId); } catch (_) { /* best effort */ }
  watcher.settle(rec.key, 'expired');
}

// ── Resolver: interrupted spawn → terminal echo (FIX 2) ──────────────────────
// The app died mid-spawn AFTER task_started was posted; on the next launch the
// watcher settles that 'spawning' record 'interrupted' and calls this so the
// requester's session card stops pulsing "active". We post the SAME deterministic
// taskId as task_started so they group, with metadata { interrupted: true } — the
// web renders that as a calm "Interrupted" (a bare task_failed = a real error).
// Error-suppression semantics, like deny: no reply text, generic body only. The
// record is already settled by the watcher, so there is nothing to settle here.
async function onInterrupted(rec) {
  const entry = deps.entryFromRecord(rec);
  const m = deps.msgFromRecord(rec, '');
  await postTaskEvent(entry, m, 'task_failed', deps.taskIdFor(rec), { interrupted: true }, 'Request interrupted');
}

function notifyReplied(entry, reply) {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: `Dopl: replied in "${entry.channel.name}"`,
        body: targeting.truncate(reply, 120),
        silent: true,
      }).show();
    }
  } catch (_) { /* best-effort */ }
}

module.exports = {
  bind,
  outboundCancelled,
  inboundDenied,
  inboundExpired,
  onInterrupted,
  notifyReplied,
};
