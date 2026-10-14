// Axis A's native half: the MSP approval mode and permission profile Dopl sends on `session/start` /
// `session/resume`, and the echo check that proves they took (the `Session` object carries both back).

const tools = require('./tools');

// The operator's `allowAll` is SENT as `onRequest` (deliberate — the Codex `never` precedent,
// `codex/policy.js › NEVER_NATIVE`): native `allowAll` raises no approval at all, so a Dopl channel post
// would run with no consent card. Under `onRequest` MSP still prompts for an MCP tool that is not
// `readOnlyHint` (MSP docs; Dopl's `dopl_channel` is not), and Dopl's own gate then allows every other
// subject `allowAll` lists (`tools.js › axisAAllows`). ⚠ Unproven without a real model turn — smoke item
// (docs/specs/new-runtimes-grok-muse-opencode.md §4).
const NATIVE_MODE = Object.freeze({ promptUnmatched: 'promptUnmatched', onRequest: 'onRequest', allowAll: 'onRequest' });

/** The approval mode Dopl sends for an operator pick (normalised, fail-closed to the narrowest). */
function nativeApprovalMode(mode) {
  return NATIVE_MODE[tools.normalizeToolMode(mode)];
}

/** `{ approvalMode, permissionProfile }` for a session: the profile is containment's (`tools.js`). */
function sessionPolicy(toolMode, cfg) {
  const native = (cfg && cfg.native) || {};
  return { approvalMode: nativeApprovalMode(toolMode), permissionProfile: native.permissionProfile || tools.ASK_PROFILE };
}

function refuse(what) {
  return new Error(`Muse started the session with ${what} — refusing a session that would not run under the `
    + 'restrictions the operator chose.');
}

/**
 * Every safety setting Dopl sent, read back off the `session/start|resume` answer. Throws (fail CLOSED) on
 * a mismatch AND on an echo Dopl cannot read. `sent`: `{ approvalMode, permissionProfile, modelId?,
 * workspaceRoot? }`; `sameDir(a, b)` compares folders.
 */
function assertSessionTook(sent, result, sameDir) {
  const s = result && result.session && typeof result.session === 'object' ? result.session : null;
  if (!s) throw refuse('no session Dopl could read');
  const mode = s.approvalMode && typeof s.approvalMode.mode === 'string' ? s.approvalMode.mode : '';
  if (!mode) throw refuse('no approval mode Dopl could read');
  if (mode !== sent.approvalMode) throw refuse(`approval mode \`${mode}\` after Dopl asked for \`${sent.approvalMode}\``);
  const profile = s.permissionState && typeof s.permissionState.profileId === 'string' ? s.permissionState.profileId : '';
  if (!profile) throw refuse('no permission profile Dopl could read');
  if (profile !== sent.permissionProfile) throw refuse(`permission profile \`${profile}\` after Dopl asked for \`${sent.permissionProfile}\``);
  // The AI judge never decides for Dopl: a profile whose reviewer is not a person is refused.
  const authority = s.permissionState.reviewerAuthority;
  if (authority && authority !== 'human') throw refuse(`approvals reviewed by \`${authority}\`, not a person`);
  if (sent.modelId && s.modelId !== sent.modelId) {
    throw new Error(`Muse started the session on model \`${s.modelId}\` after Dopl asked for \`${sent.modelId}\` — `
      + 'refusing a session that would run a model the operator did not choose.');
  }
  if (sent.workspaceRoot) {
    if (typeof s.workspaceRoot !== 'string' || !s.workspaceRoot) throw refuse('no workspace folder Dopl could read');
    if (typeof sameDir === 'function' && !sameDir(s.workspaceRoot, sent.workspaceRoot)) throw refuse('a different workspace folder');
  }
}

module.exports = { nativeApprovalMode, sessionPolicy, assertSessionTook, NATIVE_MODE };
