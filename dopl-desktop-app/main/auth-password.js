// Native email/password + magic-link sign-in for the bundled SPA.
//
// The renderer has no network and no Supabase client, so the GoTrue calls the
// web login page made from the browser run HERE, in main, against the same
// endpoints with the same publishable anon key (config.js — embedding it leaks
// nothing new; every web visitor gets it).
//
// SESSION ADOPTION deliberately reuses the audited deep-link path instead of a
// second persistence route: on success we arm the pending-auth nonce and feed
// `captureFromFragment` a fragment built IN-PROCESS (it never crosses a
// process or the OS). One code path owns "a session enters the store", with
// its gate satisfied legitimately — we ARE the initiator.
//
// The magic link arms the same gate — but only AFTER GoTrue accepts the send,
// never before: the emailed link completes in the browser and returns through
// /auth/desktop-handoff → dopl://auth#tokens, i.e. the standard capture, which
// then requires the pending record. TTL is 10 minutes — a link clicked later is
// refused and the user just requests a fresh one.
//
// SECRETS: the password goes into ONE https request body and is never logged,
// stored, or echoed; tokens ride the same rules as every other auth path.

const { SUPABASE_URL, SUPABASE_ANON_KEY, APP_ORIGIN } = require('./config');
const auth = require('./auth');
const { diag } = require('./diag');

const REQUEST_TIMEOUT_MS = 15_000;

// ─── BEGIN AUTH-PASSWORD-PURE (unit-testable via source extraction) ─────────

/** Coerce + sanity-check the renderer's payload. Returns null when invalid —
 *  the bridge answers a plain failure, never throws into IPC. */
function normalizeCredentials(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const mode = p.mode === 'sign-up' ? 'sign-up' : p.mode === 'sign-in' ? 'sign-in' : null;
  const email = typeof p.email === 'string' ? p.email.trim() : '';
  const password = typeof p.password === 'string' ? p.password : '';
  if (!mode || !email || !email.includes('@') || email.length > 320) return null;
  if (password.length < 1 || password.length > 512) return null;
  return { mode, email, password };
}

/** Human-facing message out of a GoTrue error body, with a safe fallback. */
function gotrueErrorMessage(body, status) {
  const b = body && typeof body === 'object' ? body : {};
  const msg = b.error_description || b.msg || b.message || b.error;
  if (typeof msg === 'string' && msg && msg.length <= 300) return msg;
  return `Sign-in failed (${status})`;
}

/** The in-process fragment handed to captureFromFragment on success. */
function sessionFragment(session, nonce) {
  const params = new URLSearchParams({
    access_token: String(session.access_token || ''),
    refresh_token: String(session.refresh_token || ''),
    expires_in: String(session.expires_in || 3600),
    expires_at: String(session.expires_at || ''),
    state: nonce,
  });
  return params.toString();
}
// ─── END AUTH-PASSWORD-PURE ─────────────────────────────────────────────────

async function gotrue(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let parsed = null;
    try { parsed = await res.json(); } catch (_err) { /* empty body */ }
    return { status: res.status, ok: res.ok, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/** Email/password sign-in or sign-up. Resolves {ok} on a live session,
 *  {ok, pendingConfirmation} when sign-up needs email confirmation, or
 *  {ok:false, error} — never throws. */
async function passwordAuth(payload) {
  const creds = normalizeCredentials(payload);
  if (!creds) return { ok: false, error: 'Enter a valid email and password.' };
  try {
    const res =
      creds.mode === 'sign-up'
        ? await gotrue('/signup', { email: creds.email, password: creds.password })
        : await gotrue('/token?grant_type=password', {
            email: creds.email,
            password: creds.password,
          });
    if (!res.ok) return { ok: false, error: gotrueErrorMessage(res.body, res.status) };

    const session = res.body && (res.body.access_token ? res.body : res.body.session);
    if (!session || !session.access_token || !session.refresh_token) {
      // Sign-up with email confirmation ON: no session until the link is
      // clicked. That's a success with homework, not an error.
      if (creds.mode === 'sign-up') return { ok: true, pendingConfirmation: true };
      return { ok: false, error: 'Sign-in did not return a session.' };
    }

    // requireState + a one-minute TTL: this fragment is built right here and
    // echoes the nonce, so the record can demand an EXACT match and is consumed
    // on the next line. Nothing else — no injected dopl:// link, no stale
    // browser handoff — can spend it, and it cannot outlive this call.
    const nonce = auth.beginPendingAuth({ requireState: true, ttlMs: 60_000 });
    const adopted = auth.captureFromFragment(sessionFragment(session, nonce));
    if (!adopted) return { ok: false, error: 'Could not store the session.' };
    diag('auth-password: session adopted via', creds.mode);
    return { ok: true };
  } catch (err) {
    diag('auth-password: request failed —', (err && err.message) || String(err));
    return { ok: false, error: 'Could not reach the sign-in service.' };
  }
}

/** Send a magic sign-in link that completes back into the app through the
 *  standard browser handoff. Arms the pending-auth gate first. */
async function sendMagicLink(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const email = typeof p.email === 'string' ? p.email.trim() : '';
  if (!email || !email.includes('@') || email.length > 320) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  try {
    const redirect = encodeURIComponent(`${APP_ORIGIN}/auth/desktop-handoff`);
    const res = await gotrue(`/otp?redirect_to=${redirect}`, {
      email,
      create_user: false,
    });
    if (!res.ok) return { ok: false, error: gotrueErrorMessage(res.body, res.status) };
    // Arm ONLY once GoTrue accepted the request — this record is what lets a
    // dopl://auth# fragment into the app for the next 10 minutes. Arming before
    // the call (the old order) opened that window for a rejected address, a
    // network failure, or a link the user never clicks, on demand from the
    // renderer. Email delivery is far slower than this line, so nothing races.
    auth.beginPendingAuth();
    return { ok: true };
  } catch (err) {
    diag('auth-password: magic link failed —', (err && err.message) || String(err));
    return { ok: false, error: 'Could not reach the sign-in service.' };
  }
}

module.exports = { passwordAuth, sendMagicLink, normalizeCredentials, gotrueErrorMessage, sessionFragment };
