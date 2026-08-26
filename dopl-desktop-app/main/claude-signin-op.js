// THE IN-APP CLAUDE CODE SIGN-IN — Q6's missing RECOVERY half, and it was only ever the wire.
//
// ⚠ WHAT ALREADY WORKED. Detection has been complete since Q6: `session-auth.js ›
// holdIfNoCredential` preflights a windowless launch and HOLDS it rather than burning a session,
// `session-query.js` turns an auth-shaped mid-session failure into that same hold, and the
// channels surface says so out loud ("Your agent is waiting for you to sign in to Claude Code.",
// `channels-v2/agent-composer.tsx`). The REMEDY existed too — `claude-auth.js › startSignInFlow`
// (native dialog, then `claude setup-token` under a pty against the bundled binary, Terminal as
// tier 1) and `session-auth.js › resumeAfterSignIn` (idempotent, test-covered).
//
// ⚠ WHAT DID NOT. Neither had a single production caller. Nothing could ENTER the flow, so a
// re-post into a held session was refused with `auth-hold` forever and no dialog could ever
// appear. This module is that missing call and nothing else: it REWRITES NEITHER FUNCTION.
//
// ⚠ ITS OWN FILE RATHER THAN A BODY IN `session-ipc-ops.js` — §1's 500-line cap, on the
// `session-launch-op.js` precedent. What stays at the IPC surface is the op name, the sender
// binding and the refusal shape.
//
// ⚠ SUCCESS IS RE-PROBED, NEVER REPORTED. `startSignInFlow` resolves `undefined` on every path:
// a completed sign-in, a declined dialog, a failed pty and the single-flight no-op are
// indistinguishable from here. So the answer comes from `credentialState()` AFTER the flow, with
// the probe cache dropped first — its 5s click-rate TTL would otherwise answer with the state
// this flow just changed. That is also the honest reading of the question: what the caller needs
// to know is whether this Mac can run a session NOW, not which tier finished.
//
// ⚠ ONE FLOW PER CALL, AND THE SINGLE-FLIGHT STAYS WHERE IT IS. `claude-auth.js` already refuses
// to stack two sign-ins; a second latch here would be a second answer to one question. N held
// sessions still produce exactly ONE dialog, because the flow is driven once and the RESUME is
// the fan-out (`session-auth.js › resumeHeldSessions`).
//
// ⚠ ONE REFUSAL SHAPE, `{ ok: false }`, and it carries no reason. A declined dialog, a failed
// pty and a forged call from an unbound sender all answer identically, on the same rule every op
// in `session-ipc-ops.js` follows. The renderer needs no more than that: it clears the waiting
// banner on `ok` and leaves it standing otherwise.

const claudeAuth = require('./claude-auth');
const sessionAuth = require('./session-auth');
const { diag } = require('./diag');

// WHICH `claude` THE SIGN-IN DRIVES — the BUNDLED binary FIRST, in the same order and for the
// same reason `claude-runtime.js › sessionSpawnAvailable` uses: the executable a session really
// runs ships inside the app bundle (`sdk-loader.resolveClaudeExecutable`, asar-unpacked and
// signed), and most machines we distribute to never installed a `claude` on PATH at all —
// offering them a sign-in that needs one is the silent-drop bug that module was written for. The
// external CLI (`claude-resolve.js › getClaudeBinPath`, through the spawner facade) is the
// fallback, so a developer machine behaves exactly as it did.
//
// ⚠ BOTH REQUIRES ARE LAZY AND BOTH FAILURES DEGRADE. `sdk-loader` pulls `electron.app` at
// module scope; a throw here must mean "no bundled binary" and let the external probe answer,
// never take the sign-in down. A null from both is not an error either — `startSignInFlow` goes
// straight to its Terminal tier, which is the one path that needs no path from us.
async function resolveClaudeBin() {
  try {
    const bundled = require('./sdk-loader').resolveClaudeExecutable();
    if (bundled) return bundled;
  } catch (err) {
    diag('claude signin: bundled binary unresolved', err && err.message);
  }
  try {
    return await require('./session-spawner').getClaudeBinPath();
  } catch (err) {
    diag('claude signin: external cli unresolved', err && err.message);
    return null;
  }
}

/**
 * Run the sign-in, then release every session this Mac is holding on it.
 * `{ ok }` reports the CREDENTIAL's state after the flow, never the flow's own outcome.
 */
async function signIn() {
  try {
    await claudeAuth.startSignInFlow({ getClaudeBin: resolveClaudeBin });
  } catch (err) {
    // The orchestrator swallows its own errors; this is belt for the require above it.
    diag('claude signin: flow threw', err && err.message);
  }
  sessionAuth.forget(); // the probe is a click-rate cache, and this is the moment it is wrong
  if (!sessionAuth.credentialState().usable) {
    diag('claude signin: no usable credential after the flow');
    return { ok: false };
  }
  const resumed = await sessionAuth.resumeHeldSessions();
  diag('claude signin: signed in; held sessions resumed:', resumed);
  return { ok: true, resumed: resumed };
}

module.exports = { signIn };
