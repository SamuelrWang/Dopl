// Session window factory + lifecycle echoes (v1.9 Session Window, Track T3).
//
// The session engine (T1) owns the SDK run and the IPC event stream but NEVER
// imports electron.BrowserWindow — index.js injects a window factory via
// sessionEngine.setWindowFactory (§B.5 seam). This module IS that factory plus the
// two lifecycle-echo handlers the engine calls (onLaunched/onEnded), which post the
// task_started / task_finished / task_failed channel events through the EXISTING
// channel-post.postTaskEvent so the web session-card story stays byte-for-byte
// coherent with today (§A.3). It is split out of index.js only to respect the §2
// 500-line cap; index.js still owns the wiring (setWindowFactory + setLifecycle
// handlers + init, before listener.start).

const path = require('path');
const { BrowserWindow } = require('electron');
const { postTaskEvent } = require('./channel-post');
const { diag } = require('./diag');

// A NEW LOCAL surface (§A.4 / A.6): loadFile ONLY (never a remote URL),
// contextIsolation + sandbox + nodeIntegration:false, the dedicated session
// preload as the ENTIRE privileged bridge. The sessionId rides as a query param the
// preload reads; the main side re-derives it authoritatively from event.sender, so a
// forged id can never target another session. Light-only background (no theme logic).
function createSessionWindow(sessionId) {
  const win = new BrowserWindow({
    // Item 7 (v2.2): default window size = the MIN size, so the window opens at its
    // most compact footprint and the operator grows it only when they want to.
    width: 520,
    height: 600,
    minWidth: 520,
    minHeight: 600,
    title: 'Dopl Session',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/session/session-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/session/session.html'), {
    query: { sid: String(sessionId == null ? '' : sessionId) },
  });
  win.once('ready-to-show', () => win.show());

  // Defense in depth on top of the page CSP: this window is NEVER a general browser.
  // Deny every window.open and block any navigation away from the local file. v2.0
  // item 10: the engine binds close -> HIDE (a live session's window is kept alive for
  // a tray reopen, destroyed only on settle) and render-process-gone -> crash (the
  // real interrupt signal, task stays resumable). A pre-consent window (session-
  // consent.js) instead PARKS on close — the request stays answerable elsewhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!String(url).startsWith('file://')) event.preventDefault();
  });

  return win;
}

// ── Lifecycle echoes (engine → channel) ──────────────────────────────────────
// The engine's runLifecycle hands a flat info object { channelId, taskId, workspaceId,
// side, sessionId, key, sdkSessionId }. postTaskEvent needs only channel.id, workspaceId,
// and a `seq` for the idempotent clientMsgId `${kind}-${channelId}-${seq}` (it does NOT
// read channel.name), so the coupling is tiny.
//
// ─── BEGIN SESSION-WINDOW-PURE (echo-id derivation; unit-tested via source extraction) ──
//
// FIX #2: `seq` folds a per-resume-CYCLE discriminator into a STABLE base, so a NEW cycle
// (a park->resume or a P2 recreate) posts a NEW server row while a RETRY within one cycle
// still collapses to one (the server dedupes on the identical clientMsgId).
//   base  = the first-class taskId, else the STABLE sessionKey (channelId:taskId) — never
//           the per-launch ephemeral sessionId, so a P2 recreate (fresh sessionId, same
//           key) can't post under a different id.
//   cycle = the SDK session id (a resumed query mints a fresh one at its own system/init),
//           falling back to the per-object sessionId for a PRE-INIT crash so two distinct
//           cycles that both die before init still get distinct rows.
// The DELIBERATE same-cycle dedupe (I-LOW(b)) is preserved: a crash echo and the reload
// interrupted-echo share one cycle's sdk id, so they still collapse to ONE server row.
//
// P2-9 (2026-08-04) — THE CYCLE DISCRIMINATOR IS DROPPED FOR A FIRST-CLASS THREAD, and the
// TERMINAL echo only. FIX #2 asked "is this a distinct RUN", which is a fact about this
// machine; the thread card asks "how did this exchange END", which is a fact about the
// exchange. Folding the SDK resume cycle into the key answered the first question on a row
// that renders the second, so a session that parked and resumed five times posted FIVE
// terminal rows for ONE logical failure — and nothing deduped across machines either, since
// an sdk id is local. Keyed on (kind, taskId) they collapse, on the server, for every
// machine and every cycle.
//
//   - TERMINAL only. `task_started` KEEPS the cycle: a resume genuinely IS a new start and
//     the card's restart detection reads those seqs (`groupThread`'s `restarted`). Collapsing
//     them would make a resumed session look like it never restarted.
//   - FIRST-CLASS only. A legacy `task-<channel>-<seq>` id is minted per MESSAGE, so keying
//     on it dedupes nothing a cycle key did not already dedupe, and the legacy path keeps its
//     shape byte for byte.
//
// Precedent for the local half of this is `queued-notice.js`'s `announced` set; here the
// server's own `client_msg_id` uniqueness is enough, and it is the only one that works
// across machines.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isTerminalKind(kind) {
  return kind === 'task_finished' || kind === 'task_failed';
}
function echoSeq(info, kind) {
  const i = info || {};
  if (i.seq != null) return i.seq;
  const base = i.taskId || i.key || i.sessionId || 'session';
  // P2-9: one terminal row per (kind, thread), across cycles and across machines.
  if (isTerminalKind(kind) && UUID_RE.test(String(i.taskId || ''))) return base;
  const cycle = i.sdkSessionId || i.sessionId || 'init';
  return base + '#' + cycle;
}
// `kind` rides in because the echo id now depends on it (P2-9): a terminal row is keyed on
// the THREAD so cycles collapse, while task_started keeps its per-cycle discriminator.
function echoTargets(info, kind) {
  const i = info || {};
  return {
    entry: { channel: { id: i.channelId }, workspaceId: i.workspaceId },
    m: { seq: echoSeq(i, kind) },
    taskId: i.taskId || undefined,
  };
}

// C-5 (2026-08-08) — ONE `session_ended` STATUS NOTE PER (thread, cycle), FROM THIS PROCESS.
//
// Three terminals now post that marker (the 12h abandonment, the auth hold, the window-budget
// eviction) where previously none did, and two of them can reach the same session: a held
// session is PARKED, and a parked untouched shell is exactly what `evictIdleShell` takes. The
// operator would then see the note twice on one exchange.
//
// The key is the echo id the post would carry, so the local guard and the server's own
// `client_msg_id` uniqueness agree BY CONSTRUCTION rather than by coincidence — and a genuinely
// NEW cycle (sign in, run, park, abandon) mints a new sdk session id, so it is a different key
// and it posts, which is right. Belt AND braces: the server dedupes the same id a second time.
//
// BOUNDED. A Set that only grows is the shape this tree has been bitten by; 64 is far above
// the six windows a machine can hold, and the oldest entry goes first (insertion order), which
// is the least likely to still be relevant.
const MAX_REMEMBERED_ENDS = 64;
const saidInactive = new Set();

function firstInactiveNote(channelId, seq) {
  const k = `${channelId}|${seq}`;
  if (saidInactive.has(k)) return false;
  if (saidInactive.size >= MAX_REMEMBERED_ENDS) saidInactive.delete(saidInactive.values().next().value);
  saidInactive.add(k);
  return true;
}
// ─── END SESSION-WINDOW-PURE ──────────────────────────────────────────────────────────

// task_started the instant the session's SDK system/init lands (§A.3 launched).
function onLaunched(info) {
  const { entry, m, taskId } = echoTargets(info, 'task_started');
  if (!entry.channel.id) return;
  Promise.resolve(postTaskEvent(entry, m, 'task_started', taskId))
    .catch((err) => diag('session onLaunched echo error', err && err.message));
}

// task_finished / task_failed when the session ends (End / cap / close_task / crash).
// The engine is authoritative: it passes the resolved `kind`, the `extra` metadata (e.g.
// { interrupted:true }), and — for P3 (v1.7.4) — an explicit calm `bodyOverride`. IDLE
// no longer calls this at all (it parks). The turn/cost caps ride { capped:true } and
// the operator End rides { ended:true }, so the web renders a calm terminal state
// (P4) exactly like the interrupted/declined echoes; the task stays OPEN (no closeTask).
// `bodyOverride` wins; else we derive a generic body from the metadata flags.
function onEnded(info, kind, extra, bodyOverride) {
  const meta = extra || {};
  // P1-7 (2026-08-04): `task_progress` joins the accepted kinds, because a LOCAL
  // session end is no longer a terminal claim about the SHARED thread — see
  // `session-effects.endLifecycle`. Without it the coercion below would have
  // silently turned the non-terminal marker back into a `task_finished`, which is
  // the same bug wearing the opposite label.
  const k =
    kind === 'task_failed' || kind === 'task_finished' || kind === 'task_progress'
      ? kind
      : 'task_finished';
  // The RESOLVED kind decides the echo id (P2-9), so the targets are built after it.
  const { entry, m, taskId } = echoTargets(info, k);
  if (!entry.channel.id) return;
  // C-5: the calm status note is said once per (thread, cycle); see firstInactiveNote.
  if (meta.session_ended === true && !firstInactiveNote(entry.channel.id, m.seq)) {
    diag('session onEnded: session_ended already posted for this cycle — not repeating it');
    return;
  }
  const body = bodyOverride
    || (meta.interrupted ? 'Request interrupted'
      : meta.declined ? 'Request declined'
        : meta.capped ? 'Limit reached'
          : (meta.ended || meta.session_ended) ? 'Session ended'
            : undefined);
  Promise.resolve(postTaskEvent(entry, m, k, taskId, meta, body))
    .catch((err) => diag('session onEnded echo error', err && err.message));
}

const lifecycleHandlers = { onLaunched, onEnded };

module.exports = { createSessionWindow, lifecycleHandlers };
