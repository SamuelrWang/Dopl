// AXIS A'S NATIVE HALF — which `approval_policy` Dopl actually SENDS for the operator's pick, where
// on `thread/start` it rides, and the echo check that proves it took.
//
// 🔒 ⚠ **THE OPERATOR'S `never` IS NOT CODEX'S `never`, AND THAT IS THE CLAUDE PATTERN PORTED**
// (Samuel, 2026-09-22: "Okay, I guess we can try that."). Dopl never hands Claude its widest mode —
// `runtime/claude/launch-spec.js` pins `permissionMode: 'default'` and Dopl's own gate implements
// bypass by auto-answering — so every channel call still reaches the gate. Codex's native `never`
// broke that: MEASURED 2026-09-22 (codex-cli 0.155.1) a `dopl_channel` call under it raised NO
// request and FAILED ("MCP tool call requires approval, but approval policy is never"), so a Codex
// agent on `never` could not read or post at all.
//
// So the operator-facing `never` ("no approval prompts from Codex") is sent as `granular` with
// every category Codex would REJECT under `never` also rejected, and ONE category — MCP
// elicitations — left asking. Measured side by side against `never`, same sandbox, scripted model
// (`test/codex-never-policy.test.mjs` re-measures it):
//   in-sandbox shell, in-workspace patch   ran, no request            (identical)
//   `require_escalated` shell              rejected, no request       (identical)
//   patch / write outside writable roots   rejected, no request       (identical)
//   network under workspace-write          no network, no request     (identical)
//   `dopl_channel`                         FAILED  →  elicitation reaches Dopl's gate, which
//                                          answers per Axis A/B (no human card where the
//                                          Messaging row says none)
// ⚠ NOTHING WIDENS: every `false` below is a category Codex auto-REJECTS (it does not auto-approve),
// which is exactly `never`'s own answer for it. The one `true` routes a call that used to fail
// into Dopl's gate — the gate decides, and the hard-deny, forced thread tag and audit all apply.
const NEVER_NATIVE = Object.freeze({
  granular: Object.freeze({
    sandbox_approval: false,
    rules: false,
    skill_approval: false,
    request_permissions: false,
    mcp_elicitations: true,
  }),
});

// The operator's `granular` pick: until the five rows gain a persisted UI path, every category asks.
const GRANULAR_NATIVE = Object.freeze({
  granular: Object.freeze({
    mcp_elicitations: true,
    rules: true,
    sandbox_approval: true,
    request_permissions: true,
    skill_approval: true,
  }),
});

// The five keys the schema declares, in one place, for the echo comparison.
const GRANULAR_KEYS = Object.keys(GRANULAR_NATIVE.granular);

/** The native `approval_policy` for an ALREADY-NORMALISED Dopl mode (`tools.normalizeToolMode`). */
function nativeApprovalPolicy(normalized) {
  if (normalized === 'never') return clone(NEVER_NATIVE);
  if (normalized === 'granular') return clone(GRANULAR_NATIVE);
  return normalized;
}

function clone(policy) {
  return { granular: Object.assign({}, policy.granular) };
}

/**
 * Put the policy on a `thread/start` params object.
 *
 * 🔒 ⚠ **AN OBJECT POLICY RIDES `config.approval_policy`, NOT `approvalPolicy`** (MEASURED
 * 2026-09-22): the typed field refuses the `granular` shape with `-32600 "askForApproval.granular
 * requires experimentalApi capability"` — which is also why the operator's own `granular` pick
 * could never launch before this. Opting the whole connection into the experimental API would
 * change every notification shape the normaliser reads; the thread `config` override takes the
 * same TOML value, and the response echoes it back as `approvalPolicy` exactly as sent, so
 * `assertPolicyTook` still proves it. A string policy keeps the typed field.
 */
function placePolicy(threadStart, policy) {
  const out = threadStart;
  if (policy && typeof policy === 'object') {
    out.config = Object.assign({}, out.config || {}, { approval_policy: policy });
    delete out.approvalPolicy;
  } else {
    out.approvalPolicy = policy;
  }
  return out;
}

function sentPolicy(sent) {
  const s = sent || {};
  if (s.approvalPolicy !== undefined) return s.approvalPolicy;
  return s.config && s.config.approval_policy !== undefined ? s.config.approval_policy : undefined;
}

// `granular` with every schema key present; absent keys read as `false`, the server's own default.
function granularKey(policy) {
  const g = policy && typeof policy === 'object' && policy.granular && typeof policy.granular === 'object'
    ? policy.granular : null;
  if (!g) return null;
  return GRANULAR_KEYS.map((k) => `${k}=${g[k] === true}`).join(',');
}

/**
 * 🔒 THE POLICY ACTUALLY TOOK — checked against the app-server's own echo.
 *
 * ⚠ **`thread/start` IGNORES A FIELD IT DOES NOT RECOGNISE AND ANSWERS WITH ITS DEFAULT**
 * (MEASURED 2026-09-22): the pre-v2 `approval_policy` spelling was ACCEPTED and the thread reported
 * `on-request`, not the `never` asked for. A renamed field silently WIDENS a launch, so the echo
 * (`ThreadStartResponse.approvalPolicy`, REQUIRED by the schema) is compared.
 * ⚠ SINCE 2026-09-22 THE OBJECT FORM IS COMPARED TOO. `never` now travels as `granular`, so a
 * string-only check would have stopped guarding the widest operator pick. MEASURED: the echo of a
 * `config.approval_policy` granular object is that object, every key present — so the comparison
 * is per schema key, and a STRING echo for an object ask (the server fell back) is a mismatch.
 * 🔒 UNKNOWN IS NOT A MISMATCH (`docs/INVARIANTS.md`): an absent/null echo is left alone.
 */
function assertPolicyTook(sent, response) {
  const asked = sentPolicy(sent);
  if (asked === undefined || asked === null || asked === '') return;
  const got = response && response.approvalPolicy;
  if (got === undefined || got === null || got === '') return;
  const askedKey = typeof asked === 'string' ? asked : granularKey(asked);
  const gotKey = typeof got === 'string' ? got : granularKey(got);
  if (askedKey && askedKey === gotKey) return;
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  throw new Error(
    `Codex started the thread at approval policy \`${show(got)}\` after Dopl asked for \`${show(asked)}\` — `
    + 'refusing a session that would run wider than the operator chose.'
  );
}

module.exports = {
  nativeApprovalPolicy, placePolicy, assertPolicyTook, sentPolicy,
  NEVER_NATIVE, GRANULAR_NATIVE, GRANULAR_KEYS,
};
