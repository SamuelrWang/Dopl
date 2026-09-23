// THE CREDENTIAL LANE — is this machine signed in to THIS runtime, and can we fix it in place?
//
// ⚠ THREE CREDENTIALS, ONE OF WHICH MATTERS, and the copy this lane produces has to name it.
// Operators conflate their Dopl account login, the vendor's desktop app login, and the CLI
// credential held by THIS Mac. A spawned session rides the third and nothing else, which is why
// the sign-in copy names the machine and never says "not logged in" — the operator is usually
// logged into the other two.
//
// ⚠ THE PROBE READS MARKERS, NEVER THE SECRET. A signed-in check that opens the credential store
// pops an OS prompt on a cross-app read, so this lane stats a file and reads an account id and
// stops there. It fails OPEN on an unexpected error: refusing to launch because a probe was
// unreadable would take the machine off the air for a question that is only advisory.
//
// ⚠ THE FIVE VENDOR-NAMED CORE MODULES HAVE NOT MOVED YET, AND THIS FILE SAYS SO RATHER THAN
// COPYING THEM. `claude-auth.js`, `claude-resolve.js`, `claude-runtime.js`, `claude-signin-op.js`
// and `claude-token.js` are the credential de-naming step of the port (design §4 step 6). Its wire
// half landed 2026-09-23: the IPC op is `runtime:signIn` (`main/runtime-signin-op.js`), which
// reaches this module's `signIn` through the registry.
//
// ⚠ EVERY REQUIRE BELOW IS LAZY, AND THAT IS A CONTRACT, NOT A STYLE. The sign-in flow is
// dialog-bound and the loader pulls `electron.app` at module scope; `main/runtime/index.js` must
// stay requireable from a plain Node harness, because `main/session-profiles.js` — a pure module
// two suites evaluate standalone — asks the registry for every gate decision.

/**
 * Is there a usable credential for this runtime on this machine?
 * `{ usable, source }` — `source` names WHICH marker answered, for the diag line.
 */
function credentialState() {
  return require('../../session-auth').credentialState();
}

/**
 * Drive the interactive sign-in, then release every session this Mac is holding on it.
 * ⚠ `{ ok }` REPORTS THE CREDENTIAL'S STATE AFTER THE FLOW, never the flow's own outcome: a
 * dialog the operator dismissed and a pty that died are the same answer to the only question the
 * caller has.
 */
function signIn() {
  return require('../../claude-signin-op').signIn();
}

// Descriptor half.
const descriptor = {
  // ⚠ true: this runtime has a real in-place flow — the app drives the bundled binary's own
  // sign-in for the operator. A key-only runtime declares `null` here and the UI shows a settings
  // pointer instead of a button (§3.2, hide-on-absent).
  interactiveSignIn: true,
  probe: 'on-disk-marker',
};

module.exports = { credentialState, signIn, descriptor };
