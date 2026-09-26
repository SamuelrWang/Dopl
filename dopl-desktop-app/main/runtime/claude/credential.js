// THE CREDENTIAL LANE. A session's credential is the token Dopl's own sign-in stored (`claude-token.js`,
// safeStorage), handed to the CLI as `CLAUDE_CODE_OAUTH_TOKEN` — or, for a "Use my tools" spawn once the
// operator enabled Chrome & connectors, Dopl's own full claude.ai login (`withFullLogin`). The operator's own
// Claude Code login is never read. Every require is lazy: `main/runtime/index.js` must stay requireable
// from a plain Node harness (`session-profiles.js` asks the registry for every gate decision).

const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
// Moves the bundled CLI's credential store (claude 2.1.220): where the full login lives.
const SECURE_STORE_ENV = 'CLAUDE_SECURESTORAGE_CONFIG_DIR';
const tokenStore = () => require('../../claude-token');

const storedToken = () => tokenStore().getStoredOAuthToken();

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

/**
 * A "Use my tools" spawn (`operator-tools.js › withOperatorTools`) on the full claude.ai login, when the operator
 * enabled one (Samuel, 2026-09-25, ruling 4): the CLI reads it from Dopl's private store, so the login itself
 * never enters an env, and Dopl's inference token is withdrawn because an env token would win.
 */
function withFullLogin(env) {
  if (!hasFullLogin()) return env;
  delete env[TOKEN_ENV];
  env[SECURE_STORE_ENV] = tokenStore().fullLoginDir();
  return env;
}

/** Is the full login enabled (the status row's `full`)? An unreadable store is "no". */
function hasFullLogin() {
  try { return tokenStore().hasFullLogin() === true; } catch (_) { return false; }
}

/** The in-app sign-in (`claude-auth.js`): `{ ok }` once a token is stored. */
function signIn() {
  return require('../../claude-auth').signIn();
}

/** "Enable Chrome & connectors" (`claude-auth.js › signInFull`): `{ ok }` once the full login is stored. */
function signInFull() {
  return require('../../claude-auth').signInFull();
}

/** Drop Dopl's token and its full login (a Dopl sign-out). True when no token is left. */
function signOut() {
  if (tokenStore().hasFullLogin()) require('../../claude-auth').signOutFull();
  return tokenStore().clearStoredOAuthToken();
}

const descriptor = {
  interactiveSignIn: true,
  fullSignIn: true,
  probe: 'dopl-token',
};

module.exports = {
  credentialState, withCredential, withFullLogin, hasFullLogin, signIn, signInFull, signOut, descriptor,
  TOKEN_ENV, SECURE_STORE_ENV,
};
