// Q6 — WHICH failures are "this Mac has no Claude Code sign-in", and what we say about it.
//
// PURE module: no electron / fs / SDK reference anywhere in the extracted block below, so
// test/session-auth-recovery.test.mjs slices the sentinel block and evaluates it verbatim in
// a plain Node context (the classify / session-reducer idiom). The imperative half — probing
// the machine, driving the sign-in, holding the session — lives in session-auth.js.
//
// THREE CREDENTIALS, ONE OF WHICH MATTERS. Operators conflate (1) their Dopl account login,
// (2) the Claude desktop app login, and (3) the Claude Code CLI credential held by THIS Mac.
// A spawned session rides (3) and nothing else, which is why the copy below names it and why
// it never says "not logged in" — the operator is usually logged into the other two.
//
// AND IT NEVER SAYS `/login`. The `claude` binary a session runs ships INSIDE the app bundle
// (sdk-loader.resolveClaudeExecutable); on a machine that never installed the CLI there is no
// `claude` on PATH at all, so telling the operator to run a slash command in a terminal they
// do not have is worse than silence. The in-window button drives claude-auth.startSignInFlow,
// which runs the BUNDLED binary for them.

// ─── BEGIN SESSION-AUTH-DETECT (pure; unit-tested via source extraction) ─────

// The same shape claude-auth.isAuthShapedError matches on the headless path (trigger.js:341).
// DUPLICATED ON PURPOSE: claude-auth.js is window/dialog-bound at its top, and this block must
// stay evaluable standalone. test/session-auth-recovery.test.mjs pins the two regexes against
// each other so they cannot drift.
const AUTH_ERROR_RE = /401|OAuth.*expired|Re-authenticate/i;

// The CLI's OWN login-required one-liner, as it reaches a session: the SDK relays it as an
// assistant TEXT block ("Not logged in · Please run /login" — the dead-end bubble Q6 exists to
// replace) before the query rejects. Matching assistant text is matching content an untrusted
// peer can influence, so this is deliberately NOT the loose regex above: the WHOLE text block
// must be the sentinel, anchored at both ends. Worst case for a false positive is a banner
// whose only action is the local OAuth flow (no credential is ever typed into our UI); the
// bound keeps that from firing on a reply that merely quotes the words.
const CLI_LOGIN_SENTINEL = /^\s*(?:not logged in|invalid api key|credit balance is too low)\s*[·|-]\s*please run \/login\s*\.?\s*$/i;

function isAuthShapedError(text) {
  return AUTH_ERROR_RE.test(String(text == null ? '' : text));
}

// The text of an SDK message that is really an auth failure, or ''. Two shapes:
//   assistant — a single text block that IS the CLI's login sentinel (see above).
//   result    — an errored turn (is_error / an error subtype) whose text is auth-shaped. The
//               result field is CLI/transport-sourced, so the loose regex is right here.
// Anything else returns '' and takes today's path untouched.
function authFailureText(msg) {
  if (!msg || typeof msg !== 'object') return '';
  if (msg.type === 'assistant') {
    const blocks = (msg.message && msg.message.content) || [];
    for (const b of blocks) {
      if (b && b.type === 'text' && CLI_LOGIN_SENTINEL.test(String(b.text == null ? '' : b.text))) {
        return String(b.text).trim();
      }
    }
    return '';
  }
  if (msg.type === 'result') {
    const errored = msg.is_error === true || /error/i.test(String(msg.subtype == null ? '' : msg.subtype));
    if (!errored) return '';
    const text = String((msg.result != null ? msg.result : msg.error) || '');
    if (CLI_LOGIN_SENTINEL.test(text) || isAuthShapedError(text)) return text;
    return '';
  }
  return '';
}

// ── Copy (operator-facing; no em dash, no terminal command, names the credential) ──
// One sentence of what is wrong, one of what the button does. "on this Mac" is the whole
// point: the operator is signed in to Dopl (they are reading this window) and often to the
// Claude app too, and neither of those is the credential a session runs on.
const AUTH_TITLE = 'Claude Code sign-in needed on this Mac';
const AUTH_PREFLIGHT_BODY =
  'This session has not started. Your agent signs in to Claude separately from Dopl and from the Claude app, and this Mac has no Claude Code sign-in yet. Sign in and the request runs.';
const AUTH_ERROR_BODY =
  'The session paused because Claude Code is not signed in on this Mac. This is separate from your Dopl login and from the Claude app. Sign in and the session picks up where it stopped.';
const AUTH_ACTION = 'Sign in to Claude';
const AUTH_WORKING = 'Opening the Claude sign-in…';
const AUTH_FAILED = 'Sign-in did not finish. You can try again.';
const AUTH_DONE = 'Signed in. Starting the session…';

// The banner payload main emits for a window. `kind` picks the body; `busy`/`note` carry the
// in-flight and retry states. No id, no path, no token, ever (§H-9).
function authNotice(kind, extra) {
  const e = extra || {};
  return {
    type: 'auth_required',
    kind: kind === 'error' ? 'error' : 'preflight',
    title: AUTH_TITLE,
    body: kind === 'error' ? AUTH_ERROR_BODY : AUTH_PREFLIGHT_BODY,
    action: AUTH_ACTION,
    busy: e.busy === true,
    note: e.note == null ? '' : String(e.note),
  };
}

// ─── END SESSION-AUTH-DETECT ─────────────────────────────────────────────────

module.exports = {
  AUTH_ERROR_RE,
  CLI_LOGIN_SENTINEL,
  isAuthShapedError,
  authFailureText,
  authNotice,
  AUTH_TITLE,
  AUTH_PREFLIGHT_BODY,
  AUTH_ERROR_BODY,
  AUTH_ACTION,
  AUTH_WORKING,
  AUTH_FAILED,
  AUTH_DONE,
};
