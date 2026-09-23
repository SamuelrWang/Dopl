// Which runtime failures mean "this Mac has no Claude Code sign-in". Pure: the sentinel block is
// evaluated standalone by test/session-auth-recovery.test.mjs; the hold itself is session-auth.js.

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
// must be the sentinel, anchored at both ends, so a reply that merely quotes the words never holds.
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

// ─── END SESSION-AUTH-DETECT ─────────────────────────────────────────────────

module.exports = {
  AUTH_ERROR_RE,
  CLI_LOGIN_SENTINEL,
  isAuthShapedError,
  authFailureText,
};
