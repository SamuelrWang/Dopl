// Axis A's native half: the `approval_policy` Dopl sends for the operator's pick, where it rides on
// `thread/start`, and the echo check that proves it took.

// Native `never` makes `dopl_channel` fail with no request, so the operator's `never` is sent as
// `granular` with only `mcp_elicitations: true` (deliberate — keep). Every `false` is a category Codex
// auto-rejects, as under `never`; the one `true` routes channel calls into Dopl's gate
// (re-measured by `test/codex-parity-fences-live.test.mjs`).
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

// An object policy must ride `config.approval_policy`: the typed `approvalPolicy` rejects `granular`
// without experimentalApi (-32600). A string policy keeps the typed field.
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

// `thread/start` ignores an unrecognised field and answers its default (a silent widening), so the echo
// is compared, per granular key. An absent/null echo is unknown, not a mismatch.
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
  nativeApprovalPolicy, placePolicy, assertPolicyTook,
  NEVER_NATIVE, GRANULAR_KEYS,
};
