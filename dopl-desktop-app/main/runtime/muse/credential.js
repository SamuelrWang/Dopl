// Is this machine signed in to Muse FOR DOPL? The one credential a session uses is the `auth.json` Dopl's
// own sign-in installed in the private home (`config-home.js`, file backend); the operator's
// `~/.config/muse`, their Keychain and any `META_API_KEY` in their environment are never read (Samuel,
// 2026-10-13: the user's Muse subscription through Muse's own sign-in, like Codex's Dopl-owned auth.json).

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
