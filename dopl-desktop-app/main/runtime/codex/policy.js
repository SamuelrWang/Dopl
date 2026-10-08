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

// The Codex app's "Approve for me": `on-request` prompts go to Codex's own reviewer instead of a person
// (0.155.1 echoes `guardian_subagent` as `auto_review`). Sent only with `mode`: a narrower pick asks
// someone, and `never` raises nothing to review. It approves a Dopl channel post past Dopl's outbound
// gate, accepted by Samuel 2026-09-25 (F-765, `test/codex-auto-review-live.test.mjs`).
const APPROVALS_REVIEWER = Object.freeze({ key: 'approvals_reviewer', value: 'guardian_subagent', mode: 'on-request' });

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
// is compared, per granular key. ⚠ FAIL CLOSED (2026-10-08): `approvalPolicy` is a REQUIRED field of the
// response (`ThreadStartResponse`, 0.155.1 schema), so an absent echo is a protocol Dopl cannot read —
// refused, never assumed to have taken.
function assertPolicyTook(sent, response) {
  const asked = sentPolicy(sent);
  if (asked === undefined || asked === null || asked === '') return;
  const got = response && response.approvalPolicy;
  if (got === undefined || got === null || got === '') {
    throw new Error('Codex started the thread without saying which approval policy it applied — refusing a '
      + 'session whose restrictions Dopl cannot confirm.');
  }
  const askedKey = typeof asked === 'string' ? asked : granularKey(asked);
  const gotKey = typeof got === 'string' ? got : granularKey(got);
  if (askedKey && askedKey === gotKey) return;
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  throw new Error(
    `Codex started the thread at approval policy \`${show(got)}\` after Dopl asked for \`${show(asked)}\` — `
    + 'refusing a session that would run wider than the operator chose.'
  );
}

// The sandbox Dopl sends (`sandbox_mode` words) → the `SandboxPolicy.type` the response echoes.
const SANDBOX_ECHO = Object.freeze({
  'read-only': 'readOnly',
  'workspace-write': 'workspaceWrite',
  'danger-full-access': 'dangerFullAccess',
});

// The reviewer word Codex echoes for what Dopl sent (it accepts the legacy `guardian_subagent` and
// answers `auto_review`); no reviewer sent = approvals go to a person (`user`).
const REVIEWER_ECHO = Object.freeze({ guardian_subagent: 'auto_review', auto_review: 'auto_review' });

function refuse(what) {
  return new Error(`Codex started the thread with ${what} — refusing a session that would not run under `
    + 'the restrictions the operator chose.');
}

// The sandbox fields Dopl knows how to read as "not wider" (0.155.1 / 0.160.1 `SandboxPolicy`). The two
// `exclude*` flags only NARROW what is writable, so any boolean is fine there.
const NARROWING_FLAGS = ['excludeSlashTmp', 'excludeTmpdirEnvVar'];
// ⚠ NOT `false` (reviewer re-check): for an UNKNOWN field Dopl cannot tell whether `false` means "off" or
// "restriction off" (`restrictReads: false`), so only absent / null / [] / {} pass.
const isEmptyish = (v) => v === undefined || v === null
  || (Array.isArray(v) && v.length === 0) || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Why this restricted sandbox echo is (or may be) wider than Dopl asked, or null. Pure, type-strict:
 *  `networkAccess` must be absent or `false`; `writableRoots` absent or `[]`; an unknown field must be empty. */
function sandboxWidening(box) {
  if ('networkAccess' in box && box.networkAccess !== undefined && box.networkAccess !== false) {
    return box.networkAccess === true ? 'network access on'
      : `a network setting Dopl cannot read (${JSON.stringify(box.networkAccess)})`;
  }
  if ('writableRoots' in box && box.writableRoots !== undefined) {
    if (!Array.isArray(box.writableRoots)) return `writable folders Dopl cannot read (${JSON.stringify(box.writableRoots)})`;
    if (box.writableRoots.length) return `extra writable folders (${box.writableRoots.length})`;
  }
  for (const k of NARROWING_FLAGS) {
    if (k in box && box[k] !== undefined && typeof box[k] !== 'boolean') return `a sandbox setting Dopl cannot read (${k})`;
  }
  for (const k of Object.keys(box)) {
    if (k === 'type' || k === 'networkAccess' || k === 'writableRoots' || NARROWING_FLAGS.indexOf(k) !== -1) continue;
    if (!isEmptyish(box[k])) return `a sandbox setting Dopl does not recognise (${k})`;
  }
  return null;
}

/** Every safety setting Dopl sent, read back off the `thread/start|resume` answer. Throws (fail CLOSED) on
 *  a mismatch AND on an echo Dopl cannot read: the run is refused rather than started unconfirmed. */
function assertThreadTook(sent, response, sameDir) {
  const r = response && typeof response === 'object' ? response : null;
  if (!r) throw refuse('no answer Dopl could read');
  assertPolicyTook(sent, r);
  if (sent && sent.sandbox != null) {
    const want = SANDBOX_ECHO[sent.sandbox];
    const box = r.sandbox && typeof r.sandbox === 'object' ? r.sandbox : null;
    const got = box && typeof box.type === 'string' ? box.type : '';
    if (!want || !got) throw refuse(`a sandbox Dopl cannot read (asked \`${sent.sandbox}\`)`);
    if (got !== want) throw refuse(`sandbox \`${got}\` after Dopl asked for \`${sent.sandbox}\``);
    // Wider than asked inside the same mode — read STRICTLY by type (Codex self-audit M2): a field Dopl
    // cannot read as "off" refuses, so a future representation ("enabled", an object of roots) never passes.
    if (got !== 'dangerFullAccess') {
      const problem = sandboxWidening(box);
      if (problem) throw refuse(problem);
    }
  }
  const askedRev = (sent && sent.approvalsReviewer) || null;
  const gotRev = typeof r.approvalsReviewer === 'string' ? r.approvalsReviewer : '';
  if (!gotRev) throw refuse('no reviewer Dopl could read');
  const wantRev = askedRev ? REVIEWER_ECHO[askedRev] : 'user';
  if ((REVIEWER_ECHO[gotRev] || gotRev) !== wantRev) {
    throw refuse(`approvals routed to \`${gotRev}\` after Dopl asked for \`${askedRev || 'user'}\``);
  }
  // The MODEL (Codex self-audit M3): `ThreadStartResponse.model` is required. A requested model must be the
  // one running — a build that accepts the field and ignores it would run another model (with the chosen
  // effort) silently. With none requested, Codex must still say which model it chose. `sent.model` is the
  // roster row's own LAUNCH value (`model/list › model`, `launch-spec.js › launchModelOf`), which is what the
  // echo names — never assumed equal to the row's `id`.
  const askedModel = sent && typeof sent.model === 'string' ? sent.model.trim() : '';
  const gotModel = typeof r.model === 'string' && r.model.trim() ? r.model.trim()
    : (r.thread && typeof r.thread.model === 'string' ? r.thread.model.trim() : '');
  if (!gotModel) throw refuse('no model Dopl could read');
  if (askedModel && gotModel !== askedModel) {
    throw new Error(`Codex started the thread on model \`${gotModel}\` after Dopl asked for \`${askedModel}\` — `
      + 'refusing a session that would run a model the operator did not choose.');
  }
  if (sent && sent.cwd) {
    if (typeof r.cwd !== 'string' || !r.cwd) throw refuse('no working folder Dopl could read');
    if (!sameDir(r.cwd, sent.cwd)) throw refuse('a different working folder than the one Dopl sandboxed');
  }
}

module.exports = {
  nativeApprovalPolicy, placePolicy, assertPolicyTook, assertThreadTook, sandboxWidening, SANDBOX_ECHO,
  NEVER_NATIVE, GRANULAR_KEYS, APPROVALS_REVIEWER,
};
