// DOES THIS MACHINE HAVE A DOPL DELIVERY PATH? (2026-10-10, launch-critical)
//
// Its own module for `claude-runtime.js`'s reason, and it is the same shape of defect one file
// over: a question with no home gets answered by whatever sat nearest, and the answer is to a
// DIFFERENT question. The one asked here is narrow and it is the only one this file answers:
//
//   WILL A SESSION LAUNCHED RIGHT NOW GET THE `dopl` MCP SERVER AT ALL?
//
// It will not without a bearer. `runtime/claude/mcp.js › buildMcpServers` returns `{}` when there is no
// token (`if (!token) return {}`), the child's init message then reports no `dopl` server,
// `mcp-connect.js › doplStatus` reads that as `missing`, and `mcp-connect-guard.js` ends the
// session `mcp-unreachable` — one retry later, and LONG after `session-launch-op.js` answered
// the clicking human `{ ok: true, agentId }`. NEVER RUN A MUTE AGENT is already the ruling
// (`mcp-connect-guard.js`); this is that ruling moved EARLIER, to before "started", where the
// human who clicked is still looking.
//
// ⚠ IT DOES NOT PROBE THE NETWORK. Reachability of `/api/mcp` is `mcp-connect.js › warmMcpRoute`
// (25s, and explicitly may not fail a launch) and the guard behind it. This asks only whether
// the CREDENTIAL exists, which is local, cheap and decidable — and which is what the external-CLI
// defect actually broke (`mcp-config.js`'s device-token block).
// ⚠ A FAILED PROBE IS NOT A NO, exactly as `session-launch.js › credentialMissing` has it: every
// throw, and an unloadable `mcp-config` (it is electron-bound, so under `node --test` it is),
// answers '' and the launch proceeds. This file may refuse only on a fact it actually read.

'use strict';

/**
 * WHY a session launched now would have no Dopl tools: '' (it would have them), `signed-out`, or
 * `mint-failed`. Never throws.
 *
 * ⚠ THE CACHED BEARER IS CHECKED FIRST and it is sync, so the healthy machine — the overwhelming
 * case — spends one electron-store read on the click path and awaits nothing. The mint is
 * attempted only when there is no cached token to spend, which is the whole of "if the token
 * STILL cannot be minted, fail visibly".
 */
async function deliveryBlockedReason() {
  let mcpConfig = null;
  try {
    mcpConfig = require('./mcp-config');
    if (mcpConfig.deviceTokenForSpawn()) return '';
    if (await mcpConfig.ensureDeviceToken()) return '';
  } catch (err) {
    require('./diag').diag('delivery-path: credential probe failed — launching anyway', err && err.message);
    return '';
  }
  // Both refusals are visible, but they are not the same instruction to the operator: one is
  // "sign in", the other "this did not reach Dopl". The discriminator costs an await and runs
  // only on the failing path.
  try {
    return (await require('./auth').ensureSignedIn()) ? 'mint-failed' : 'signed-out';
  } catch (_) {
    return 'mint-failed';
  }
}

// ⚠ `disabled`, NOT A NEW WIRE WORD, and that is deliberate. The launch refusal set is CLOSED —
// schema (`src/features/channels/schema-launch-modes.ts`), service, copy map
// (`use-launch-controls.ts`) and a migration CHECK on `refusal_reason` — and `launch()` is the
// funnel for the directive lane too, which PERSISTS the word it returns. `session-launch.js`
// already refuses `windowlessFloorRefusal` as `disabled` for exactly this reason, and
// `disabled`'s shipped line is "The agent could not be started", which is precisely what
// happened.
// ⚠ AND `detail` IS WHAT THE OPERATOR READS, not just the diag log (corrected 2026-10-11). This block
// said "nothing renders it today" and that was already untrue when it was written:
// `use-launch-controls.ts` sets the launch error to `res.detail ? res.detail : launchRefusalText(...)`,
// so main's own sentence WINS over the generic copy whenever one was sent. Every `disabled` refusal in
// `session-launch.js` carries one for that reason.
// ⚠ AND THE RESIDUAL IS CLOSED, not outstanding. This block said a dedicated wire word was still needed
// so the UI could say WHICH of the two refusals it was — but the two DETAIL strings below already
// discriminate them, in the sentence the operator is shown ("Not signed in to Dopl…" vs "The desktop
// could not get this machine a Dopl credential…"). A new word would move nothing except the copy's
// owner, at the price of a four-place change ending in a migration.
const DETAIL = {
  'signed-out': 'Not signed in to Dopl, so this agent would have no Dopl tools and no way to post. Sign in, then launch.',
  'mint-failed': 'The desktop could not get this machine a Dopl credential, so the agent would have no Dopl tools and no way to post.',
};

/** `null` to proceed, else the `launch()` refusal for this reason. Pure. */
function muteRefusal(reason) {
  const detail = Object.hasOwn(DETAIL, reason) ? DETAIL[reason] : '';
  if (!detail) return null;
  return { skipped: 'disabled', detail };
}

module.exports = { deliveryBlockedReason, muteRefusal };
