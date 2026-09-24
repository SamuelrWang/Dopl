// THE CREDENTIAL LANE. A session's one credential is the token Dopl's own sign-in stored
// (`claude-token.js`, safeStorage), handed to the CLI as `CLAUDE_CODE_OAUTH_TOKEN`; the operator's own
// Claude Code login is never read. Every require is lazy: `main/runtime/index.js` must stay requireable
// from a plain Node harness (`session-profiles.js` asks the registry for every gate decision).

const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';

const storedToken = () => require('../../claude-token').getStoredOAuthToken();

/** `{ usable, source }`: is Dopl's token stored? `source` feeds the diag line and the roster key. */
function credentialState() {
  const usable = !!storedToken();
  return { usable, source: usable ? 'dopl-token' : null };
}

/** `env` (already scrubbed of inherited credentials) plus Dopl's token, when one is stored. */
function withCredential(env) {
  const token = storedToken();
  if (token) env[TOKEN_ENV] = token;
  return env;
}

/** The in-app sign-in (`claude-auth.js`): `{ ok }` once a token is stored. */
function signIn() {
  return require('../../claude-auth').signIn();
}

/** Drop Dopl's token (a Dopl sign-out). True when nothing usable is left. */
function signOut() {
  return require('../../claude-token').clearStoredOAuthToken();
}

const descriptor = {
  interactiveSignIn: true,
  probe: 'dopl-token',
};

module.exports = { credentialState, withCredential, signIn, signOut, descriptor, TOKEN_ENV };
