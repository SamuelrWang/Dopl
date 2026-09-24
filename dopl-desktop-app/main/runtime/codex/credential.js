// Is this machine signed in to Codex FOR DOPL? The one credential a session uses is the `auth.json` Dopl's
// own sign-in installed in the private CODEX_HOME (`config-home.js`); the operator's `~/.codex` is never read.

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

module.exports = { credentialState, signIn, signOut, descriptor };
