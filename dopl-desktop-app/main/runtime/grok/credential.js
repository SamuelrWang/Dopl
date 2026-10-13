// Is this machine signed in to Grok FOR DOPL? The one credential a session uses is the `auth.json` Dopl's own
// sign-in installed in the private home (`config-home.js`, `GROK_AUTH_PATH`) — the user's SuperGrok / X Premium
// subscription through Grok's own login (Samuel, 2026-10-13: *"why do we need api key? … just use the
// subscription"*). The operator's `~/.grok`, and any `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY` in their
// environment, are never read (`config-home.js › buildScrubbedEnv`). The file is checked for PRESENCE only —
// never opened by Dopl. Whether Grok accepts it is the launch's handshake (`initialize.authMethods` offers
// `cached_token` only for a token it holds, `client.js › cachedTokenOffered`) → an auth hold, never an
// `authenticate` call.

const configHome = require('./config-home');

/** `{ usable, source }`: is Dopl's `auth.json` in the home the next session runs in? */
function credentialState() {
  const usable = configHome.hasAuth();
  return { usable, source: usable ? 'dopl-auth-file' : null };
}

/** The in-app sign-in (`login.js`): `{ ok }` once Dopl's `auth.json` is installed. */
async function signIn() {
  try {
    const outcome = await require('./login').signIn();
    return { ok: !!outcome && outcome.ok === true };
  } catch (_) {
    return { ok: false };
  }
}

/** Cancel the sign-in in flight → true when one ran. */
function cancelSignIn() {
  return require('./login').cancel();
}

/** Remove Dopl's `auth.json` (a Dopl sign-out). True when none is left. */
function signOut() {
  try {
    configHome.removeAuth();
    return true;
  } catch (_) {
    return false;
  }
}

const descriptor = {
  interactiveSignIn: true,
  probe: 'dopl-auth-file',
};

module.exports = { credentialState, signIn, cancelSignIn, signOut, descriptor };
