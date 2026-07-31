// Q6 — session-window credential preflight + in-window sign-in recovery.
//
// THE BUG THIS EXISTS FOR: a session window on a Mac with no Claude Code sign-in rendered an
// agent bubble reading "Not logged in · Please run /login" and then died (task_failed
// {interrupted}). The recovery machinery already existed — claude-auth.startSignInFlow drives
// `claude setup-token` under a pty against the BUNDLED binary, with a Terminal fallback — but
// it was wired ONLY to the headless path (trigger.js:341). This module is the session-path
// twin: it PREFLIGHTS the credential before a query is started, HOLDS the session instead of
// burning it when there is none, and turns an auth-shaped mid-session failure into a button.
//
// SEAM: the engine injects everything stateful (bind) exactly like session-park.js — this file
// holds no session registry of its own and never imports session-engine (no cycle). The pure
// half (which failures are auth-shaped, and every string the operator reads) lives in
// session-auth-detect.js so it is testable without electron.
//
// WHAT COUNTS AS A USABLE CREDENTIAL (credentialState below): an auth env var the SDK passes
// through, our own stored setup-token, or the CLI's own signed-in state on this machine. We
// NEVER read the macOS keychain item itself ("Claude Code-credentials"): a read from a
// different app pops a keychain-access prompt, which would be a worse interruption than the
// bug. The probe therefore reads MARKERS, never a secret, and is FAIL-OPEN — an unreadable or
// unrecognized state counts as "credential present", so the preflight can only ever block a
// machine we are confident has none. Everything else falls through to the mid-session recovery.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { ipcMain } = require('electron');
const claudeAuth = require('./claude-auth');
const spawner = require('./session-spawner');
const { getStoredOAuthToken } = require('./claude-token');
const detect = require('./session-auth-detect');
const store = require('./session-store');
const { diag } = require('./diag');

// The auth-critical env vars sdk-loader.buildScrubbedEnv deliberately preserves (its
// PERMISSION_ENV_RE cannot match any of them). Present => the SDK child can authenticate.
const ENV_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const PROBE_TTL_MS = 5000; // a click-rate cache; forget() clears it the moment sign-in returns

let deps = null;
let probe = null; // { at, state } — the cached credentialState()
let bound = false;

// The engine binds its internals here at load: the live registry lookup for IPC, the SDK
// loader, its OWN startQuery (the deferred launch — never a second query assembly), dispatch,
// the replay-aware emit, and denyPending (fail-closed teardown of awaited canUseTool promises).
function bind(d) {
  deps = d || null;
  registerIpc();
}

// ── The credential probe ─────────────────────────────────────────────────────
function envCredential() {
  const env = process.env || {};
  for (const key of ENV_KEYS) {
    if (String(env[key] == null ? '' : env[key]).trim()) return key;
  }
  return '';
}

// The CLI's own record that THIS machine completed an interactive sign-in. Two shapes:
//   ~/.claude/.credentials.json — the file-backed credential store (no OS keychain).
//   ~/.claude.json `oauthAccount` — written after an interactive login; the macOS keychain
//     holds the actual token, which we never touch. The account block is read for ONE bit
//     (does it name an account); no field of it is copied, logged, or sent anywhere.
function cliStoreSignedIn() {
  const home = os.homedir();
  try {
    const st = fs.statSync(path.join(home, '.claude', '.credentials.json'));
    if (st.isFile() && st.size > 2) return true;
  } catch (_) { /* absent -> try the account marker below */ }
  try {
    const raw = fs.readFileSync(path.join(home, '.claude.json'), 'utf8');
    const account = JSON.parse(raw).oauthAccount;
    return !!(account && typeof account === 'object' && account.accountUuid);
  } catch (err) {
    // Unreadable / unparseable / absent. FAIL OPEN only when the file EXISTS but could not be
    // read — a machine that has never run claude has no file at all, which is the real
    // "no sign-in" signal the preflight is looking for.
    return err && err.code !== 'ENOENT';
  }
}

// { usable, source } — the ONE definition of "this Mac can run a session". Order matters:
// `stored-token` is last so it is chosen only when it is the ONLY credential we hold, which
// is exactly when withStoredCredential injects it.
function credentialState() {
  const now = Date.now();
  if (probe && now - probe.at < PROBE_TTL_MS) return probe.state;
  let state = { usable: false, source: null };
  const envKey = envCredential();
  if (envKey) state = { usable: true, source: 'env' };
  else if (cliStoreSignedIn()) state = { usable: true, source: 'cli-store' };
  else if (getStoredOAuthToken()) state = { usable: true, source: 'stored-token' };
  probe = { at: now, state };
  return state;
}

function forget() {
  probe = null;
}

// The env a session query runs with. When our OWN stored setup-token is the only credential on
// this machine (the branch where `claude setup-token` PRINTED a token instead of storing it),
// inject it the same way session-spawner's headless spawnEnv already does — otherwise a
// completed in-app sign-in would leave the session path still unauthenticated. On every other
// machine this returns the SAME object it was handed, so a healthy launch is byte-identical.
function withStoredCredential(env) {
  const state = credentialState();
  if (state.source !== 'stored-token') return env;
  const token = getStoredOAuthToken();
  if (!token || !env) return env;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

// ─── BEGIN SESSION-AUTH-HOLD (injectable; unit-tested via source extraction) ──
// The block below references its leaf deps (deps / detect / store / claudeAuth / spawner / diag)
// and the two probe helpers as free vars, so test/session-auth-recovery.test.mjs slices it,
// proves it holds no electron require, and drives it with fakes — the session-park idiom.

// ── The hold ─────────────────────────────────────────────────────────────────
// A held session is a PARKED session: the same durable phase, so it is dormant on restart
// (no spurious task_failed{interrupted} echo), reopenable, and evictable by the window-budget
// LRU. Nothing is posted into the channel: no task_started ever fired, because no query ran.
//
// H1 — THE HOLD IS NOW REDUCER STATE, not three fields poked onto the session object. The old
// version set s.state.phase/parked/activity directly and recorded the hold ONLY as
// `s.authHold`, a field no other module could see. Two things followed from that:
//   (a) session-reducer.wakeEffects saw nothing but `parked` and resumed held sessions — a
//       peer follow-up under an auto_both preset spawned the SDK on a machine with NO
//       credential, and a later sign-in then started a SECOND query beside it.
//   (b) holdIfAuthFailure's "already held" branch returned `true` (handled) having done
//       NOTHING — no denyPending, no abort, no park — so a session that had been dragged back
//       to phase 'running' by (a) stayed there forever: no query, no idle timer (scheduleIdle
//       only arms on `launched`), nothing to ever settle it, and the peer's await got nothing.
// Dispatching `auth_hold` fixes both: the reducer sets `authHeld` where wakeEffects and
// inboundAutoAccepted can see it, and runs the full parkEffects set (denyPending fail-closed,
// abortQuery, clearIdle, persist 'parked'), idempotently.
function dispatchHold(s) {
  try { deps.dispatch(s, { type: 'auth_hold' }); } catch (err) { diag('session-auth: hold dispatch failed', err && err.message); }
  try { store.setRecordPhase(s.key, 'parked'); } catch (err) { diag('session-auth: persist failed', err && err.message); }
}

// The synthesized init a held PREFLIGHT window needs: no SDK system/init will land, and the
// renderer stays on the pre-consent card until an `init` arrives (session-park.emitParkedShell
// solves the same problem for a reopened shell; its copy is about reopening, so not reused).
function emitHeldInit(s) {
  deps.emit(s, {
    type: 'init', sessionId: s.sessionId, side: s.side, profile: s.profile, mode: s.mode,
    profileLabel: s.profileLabel || null, model: null,
    channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null,
    from: s.counterpartyName || null, selfAvatar: s.selfAvatar || null,
    fromAvatar: s.peerAvatar || null, cwdLabel: null,
  });
}

function showWindow(s) {
  if (!s.win || s.win.isDestroyed() || !s.windowHidden) return;
  try { s.win.show(); } catch (_) { /* best effort */ }
  s.windowHidden = false;
}

function paintNotice(s, extra) {
  deps.emit(s, detect.authNotice(s.authHold && s.authHold.kind, extra));
}

// PREFLIGHT (Q6.1). Called by startSession immediately before startQuery. Returns true when the
// launch was HELD, in which case the caller returns the session as-is: the window is open, the
// request is painted, and the operator has one button. Returns false on every machine with a
// usable credential, where the launch continues untouched.
function holdIfNoCredential(s) {
  if (!deps || !s || credentialState().usable) return false;
  diag('session-auth: preflight HOLD — no Claude Code credential on this machine');
  s.authHold = { kind: 'preflight' };
  dispatchHold(s);
  emitHeldInit(s);
  deps.emit(s, { type: 'status', phase: 'parked' });
  paintNotice(s, {});
  showWindow(s);
  return true;
}

// MID-SESSION (Q6.2). The query threw, or the SDK relayed the CLI's own login sentinel. Park
// the session on the button instead of dispatching `crash` (which settles it, destroys the
// window, and posts task_failed{interrupted} — the dead end). Returns true when it took over.
function holdIfAuthFailure(s, text) {
  if (!deps || !s || s.settled) return false;
  if (!detect.isAuthShapedError(text) && !detect.CLI_LOGIN_SENTINEL.test(String(text == null ? '' : text))) return false;
  // H1(b) — ALREADY HELD IS NOT "NOTHING TO DO". This used to `return true` here having taken
  // no action at all, which was only safe while a held session could not be restarted. It
  // could: a wake resumed it (H1(a)), the resumed query failed auth again, and this branch
  // handed back "handled" over a session the wake had already flipped to phase 'running' with
  // no query behind it — unparkable, un-timeout-able, unsettleable, and invisible to the peer
  // waiting on it. So CONVERGE instead of returning: re-dispatch the hold, which is idempotent
  // in the reducer (no second banner, no second denyPending sweep) but GUARANTEES the session
  // ends up parked and held no matter which path got it here. Cheap, and it cannot regress.
  const already = !!s.authHold;
  if (!already) diag('session-auth: auth-shaped SDK failure -> in-window sign-in');
  s.authHold = s.authHold || { kind: 'error' };
  // Fail closed FIRST (P1 discipline): every awaited canUseTool promise is denied before the
  // teardown, so no resolver dangles on a session that is about to stop consuming. (parkEffects
  // denies again via the reducer; both are idempotent.)
  try { if (deps.denyPending) deps.denyPending(s, 'Sign in to Claude to continue'); } catch (_) { /* best effort */ }
  try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
  try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  dispatchHold(s);
  if (already) return true; // converged; do NOT repaint the banner the operator is already looking at
  deps.emit(s, { type: 'status', phase: 'parked' });
  paintNotice(s, {});
  showWindow(s);
  return true;
}

// The SDK-message twin, so an auth failure the CLI reports as content (the "Not logged in ·
// Please run /login" bubble) is REPLACED by the action rather than rendered beside it. Returns
// true when the message was consumed and must not reach the renderer.
function holdIfAuthMessage(s, msg) {
  const text = detect.authFailureText(msg);
  return text ? holdIfAuthFailure(s, text) : false;
}

// ── Sign in, then continue ───────────────────────────────────────────────────
// The retry is the SAME path the launch would have taken. A preflight hold re-runs the engine's
// own startQuery with the first turn it never got to push (byte-identical to a healthy launch);
// an error hold takes the ordinary lazy-wake (`steer` -> resumeQuery with options.resume), which
// is the same route an operator typing into a parked window takes.
const RESUME_NUDGE = 'Claude Code sign-in is restored on this Mac. Continue where you left off.';

// H1 — IDEMPOTENT BY CONSTRUCTION. The old version read s.authHold, nulled it, and on a
// preflight hold called startQuery unconditionally — while startQuery itself overwrote
// s.abortController / s.query with no teardown. Two ways that produced two live claude
// children for one request: a double-click on the sign-in button (both runs pass the
// `s.authHold` check before either clears it), and a sign-in landing on a session a peer wake
// had already resumed (H1(a)) so a query was ALREADY running under the hold.
//
// Three defences now, deliberately layered because each closes a different window:
//   1. `s.authResuming` — a re-entrancy latch taken BEFORE the first await.
//   2. the CLAIM of s.authHold is the ticket: whoever nulls it is the one that proceeds, so a
//      second caller finds nothing to resume and returns.
//   3. session-query.startQuery SUPERSEDES (aborts + closes + un-tags) whatever was live
//      before assembling anything, so even a caller that gets past 1 and 2 cannot leave an
//      orphan child behind. That one is the real backstop and is tested on its own.
async function resumeAfterSignIn(s) {
  const hold = s.authHold;
  if (!hold || s.authResuming) return; // already resumed, or a resume is in flight
  s.authResuming = true;
  s.authHold = null;
  // Clear the reducer-visible hold BEFORE anything can spawn: `steer` below goes through
  // wakeEffects, which refuses to resume while authHeld is true.
  try { deps.dispatch(s, { type: 'auth_release' }); } catch (err) { diag('session-auth: release dispatch failed', err && err.message); }
  try {
    if (hold.kind === 'preflight') {
      if (s.state) { s.state.phase = 'launching'; s.state.parked = false; s.state.activity = 'working'; }
      const sdk = await deps.getSdk();
      await deps.startQuery(s, sdk);
      return;
    }
    deps.dispatch(s, { type: 'steer', text: RESUME_NUDGE, priority: 'next' });
  } finally {
    s.authResuming = false;
  }
}

async function runSignIn(s) {
  if (!s || !s.authHold) return { ok: false };
  // H1: the sign-in FLOW is single-flight too. Without this, a double click starts two
  // `claude setup-token` ptys (and two Terminal fallbacks) against the same session before
  // either finishes; the second would then race resumeAfterSignIn's latch from a different
  // async turn. Cheap, and it also stops the banner flickering between two "Working…" paints.
  if (s.authSigningIn) return { ok: false };
  s.authSigningIn = true;
  try {
    paintNotice(s, { busy: true, note: detect.AUTH_WORKING });
    try {
      await claudeAuth.startSignInFlow({ getClaudeBin: () => spawner.getClaudeBinPath(), channelName: (s.context && s.context.channelName) || null });
    } catch (err) {
      diag('session-auth: sign-in flow error', err && err.message);
    }
    forget();
    if (!credentialState().usable) {
      paintNotice(s, { busy: false, note: detect.AUTH_FAILED });
      return { ok: false };
    }
    paintNotice(s, { busy: true, note: detect.AUTH_DONE });
    deps.emit(s, { type: 'auth_cleared' });
    try {
      await resumeAfterSignIn(s);
    } catch (err) {
      diag('session-auth: resume after sign-in failed', err && err.message);
      return { ok: false };
    }
    return { ok: true };
  } finally {
    s.authSigningIn = false;
  }
}

// ─── END SESSION-AUTH-HOLD ───────────────────────────────────────────────────

// ONE narrow IPC channel, bound from the WINDOW exactly like every other session handler
// (session-ipc's §B.3 contract): the payload carries nothing, the session is re-derived from
// event.sender, and a window with no held session is refused.
function registerIpc() {
  if (bound || !ipcMain || typeof ipcMain.handle !== 'function') return;
  bound = true;
  ipcMain.handle('session:auth-signin', (e) => {
    const s = deps && deps.getSessionBySender && deps.getSessionBySender(e && e.sender);
    if (!s || !s.authHold) return { ok: false };
    return runSignIn(s);
  });
  // Reload / late-registration read: the banner is state, not an event, so a reloaded window
  // asks for it back (the folder-pill idiom) instead of relying on the replay ring.
  ipcMain.handle('session:auth-state', (e) => {
    const s = deps && deps.getSessionBySender && deps.getSessionBySender(e && e.sender);
    if (!s || !s.authHold) return null;
    return detect.authNotice(s.authHold.kind, {});
  });
}

module.exports = {
  bind,
  credentialState,
  forget,
  withStoredCredential,
  holdIfNoCredential,
  holdIfAuthFailure,
  holdIfAuthMessage,
  runSignIn, // exported for the recovery test; the IPC is the only production caller
  resumeAfterSignIn, // H1: exported for the idempotency test; runSignIn is the only production caller
};
