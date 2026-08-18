// Session window factory + the ONE surviving lifecycle echo (v1.9 Session Window, Track T3).
//
// The session engine (T1) owns the SDK run and the IPC event stream but NEVER
// imports electron.BrowserWindow — index.js injects a window factory via
// sessionEngine.setWindowFactory (§B.5 seam). This module IS that factory plus the
// lifecycle-echo handlers the engine calls (onLaunched/onEnded). It is split out of
// index.js only to respect the §2 500-line cap; index.js still owns the wiring
// (setWindowFactory + setLifecycle handlers + init, before listener.start).
//
// ⚠ THE THREE RUNTIME KINDS ARE NO LONGER POSTED — wiring plan Phase 5 (2026-08-18).
// `task_started`, `task_finished` and `task_failed` state a fact about a RUNTIME, and an
// agent's run state now lives in the AGENTS TAB and the agent view, read from the local
// session projection (main/session-summary.js), not from rows in a shared transcript. So
// `onLaunched` posts nothing at all and `onEnded` posts only the calm note below.
//   • THIS IS ONE-SIDED FOR A LONG TIME. Every installed desktop keeps posting all three,
//     and the SERVER STILL ACCEPTS THEM — tightening `service-writes-lifecycle.ts` needs a
//     desktop-floor raise (INVARIANTS §13) and is deliberately NOT part of this change. The
//     readers are what went: `channels-v2/view-model.ts › isLifecycleEcho` drops the three
//     kinds on sight, so an old build's echoes render as NOTHING rather than as debris.
//   • WHAT SURVIVES, AND WHY IT IS NOT ONE OF THEM: the calm `task_progress` note
//     (`session_ended` / the quit guard's "went inactive"). Its kind is the MILESTONE lane,
//     which is agent-writable and rendered as prose; it is what tells a WAITING PEER that
//     this side stopped, which INVARIANTS §11 requires of the quit path. It says nothing
//     about the thread — a thread has no finished state (§5, Phase 4).

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

// ── The lifecycle echo (engine → channel) ────────────────────────────────────
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
// The DELIBERATE same-cycle dedupe (I-LOW(b)) is preserved: two attempts within one cycle
// share that cycle's sdk id, so they still collapse to ONE server row.
//
// ⚠ P2-9's TERMINAL COLLAPSE LIVED HERE AND WENT WITH THE TERMINAL ECHOES (Phase 5,
// 2026-08-18). It keyed `task_finished` / `task_failed` on the THREAD rather than the cycle,
// so five park+resume cycles posted one row for one logical failure — a rule about a card
// this phase deleted, for kinds this module no longer posts. The `kind` argument went with
// it: ONE kind reaches this derivation now, and it is the non-terminal note, which wants the
// per-cycle discriminator FIX #2 gives it (a genuinely new run that ends is a new note).
function echoSeq(info) {
  const i = info || {};
  if (i.seq != null) return i.seq;
  const base = i.taskId || i.key || i.sessionId || 'session';
  const cycle = i.sdkSessionId || i.sessionId || 'init';
  return base + '#' + cycle;
}
function echoTargets(info) {
  const i = info || {};
  return {
    entry: { channel: { id: i.channelId }, workspaceId: i.workspaceId },
    m: { seq: echoSeq(i) },
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

/**
 * ⚠ POSTS NOTHING, AND THAT IS THE FEATURE (Phase 5, 2026-08-18). This used to echo
 * `task_started` the instant the session's SDK system/init landed (§A.3 launched). A launch is
 * a fact about a RUNTIME; the surface that reports it is the Agents tab, off the LOCAL session
 * projection, and a transcript row claiming it was the thing this phase removed.
 *
 * The handler is KEPT rather than unwired so the engine's lifecycle seam
 * (`setLifecycleHandlers` / `runLifecycle`) stays intact for the calm note below — and so this
 * comment sits where the next person looks for the echo.
 */
function onLaunched(_info) {}

// THE CALM STATUS NOTE, and nothing else, when the session ends (End / cap / crash / quit).
// The engine is authoritative: it passes the resolved `kind`, the `extra` metadata (e.g.
// { interrupted:true }), and — for P3 (v1.7.4) — an explicit calm `bodyOverride`. IDLE
// no longer calls this at all (it parks).
//
// ⚠ ONLY `task_progress` IS POSTED. The terminal kinds are gone with the session card that read
// them (file header): a `task_failed{capped}` / `task_finished` row said "this exchange ended"
// on a surface that had no other way to say "this machine stopped", and the thread never had
// an outcome to report (INVARIANTS §5). What is left is the `session_ended` MILESTONE — the
// one thing the peer genuinely needs, because they are waiting on a reply that is not coming.
// The metadata rides unchanged: `CALM_FLAG_KEYS` stay reserved server-side (§5) whether or not
// this build still writes them, and installed builds still do.
function onEnded(info, kind, extra, bodyOverride) {
  const meta = extra || {};
  // P1-7 (2026-08-04): `task_progress` is the non-terminal marker for a LOCAL session end —
  // see `session-effects.endLifecycle`. Everything else USED to be coerced to `task_finished`;
  // it is now dropped, because the coercion's only remaining job would be to manufacture a
  // terminal row this module no longer posts.
  if (kind !== 'task_progress') return;
  const { entry, m, taskId } = echoTargets(info);
  if (!entry.channel.id) return;
  // C-5: the calm status note is said once per (thread, cycle); see firstInactiveNote.
  if (meta.session_ended === true && !firstInactiveNote(entry.channel.id, m.seq)) {
    diag('session onEnded: session_ended already posted for this cycle — not repeating it');
    return;
  }
  const body = bodyOverride || (meta.session_ended ? 'Session ended' : undefined);
  Promise.resolve(postTaskEvent(entry, m, 'task_progress', taskId, meta, body))
    .catch((err) => diag('session onEnded echo error', err && err.message));
}

const lifecycleHandlers = { onLaunched, onEnded };

module.exports = { createSessionWindow, lifecycleHandlers };
