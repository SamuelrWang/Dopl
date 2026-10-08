// WHAT DOPL READS FROM CODEX — and nothing else (`../sdk-shape.js`). Checked against each build's OWN
// description of itself (`shape.js`) at launch and before the updater adopts a build. Tiered by what a gap
// costs: SAFETY and CORE refuse, COSMETIC is a drift note.
//
// ⚠ ONLY WHAT IS READ. Every item here must be referenced by this adapter's code (the contract suite's
// static tier fails otherwise) and present in the measured fixture (tier 1). A field added "to be safe"
// is a launch refused on a harmless upstream change — the opposite of safe.
// Paths are relative to the params/result object; arrays are transparent (`data.id` = each row's id).

const SANDBOX_ECHO = ['sandbox.type', 'sandbox.networkAccess', 'sandbox.writableRoots'];

// EVERY field Dopl knows how to read on the sandbox echo (`SandboxPolicy`, measured 0.155.1 / 0.160.1 /
// 0.161.0). A CLOSED set: a build that declares any other field is refused by the updater (a new field may
// switch a restriction off in a way Dopl cannot read); `policy.js` reads its strict per-launch backstop
// from this same list. One place to add a field, with its meaning, when Codex adds one.
const SANDBOX_FIELDS = Object.freeze(['type', 'networkAccess', 'writableRoots', 'excludeSlashTmp', 'excludeTmpdirEnvVar']);
const POLICY_ECHO = ['approvalPolicy', 'approvalsReviewer', 'cwd'];

module.exports = Object.freeze({
  // A gap here could start a session with a Dopl restriction silently off.
  safety: {
    closed: {
      'result thread/start sandbox': SANDBOX_FIELDS,
      'result thread/resume sandbox': SANDBOX_FIELDS,
    },
    methods: ['initialize', 'thread/start', 'thread/resume', 'config/read'],
    results: {
      // `policy.js › assertThreadTook` reads every one of these back before a session runs.
      'thread/start': POLICY_ECHO.concat(SANDBOX_ECHO),
      'thread/resume': POLICY_ECHO.concat(SANDBOX_ECHO),
      // `proc-config.js › assertRestrictionsTook` reads the effective config.
      'config/read': ['config'],
    },
    requests: {
      // `server-requests.js` answers these by name; a rename would route them to the unknown path.
      'item/commandExecution/requestApproval': ['command', 'cwd', 'reason'],
      'item/fileChange/requestApproval': ['grantRoot', 'reason'],
      'item/permissions/requestApproval': ['permissions'],
      'mcpServer/elicitation/request': ['serverName', '_meta'],
    },
  },
  // A gap here breaks the session: no turn, no reply, no sign-in.
  core: {
    methods: ['turn/start', 'turn/steer', 'turn/interrupt', 'model/list', 'mcpServerStatus/list',
      'account/login/start', 'account/login/cancel'],
    results: {
      'thread/start': ['thread.id'],
      'thread/resume': ['thread.id'],
      'turn/start': ['turn.id'],
      'model/list': ['data.id'],
      'account/login/start': ['loginId'],
    },
    notifications: {
      'turn/completed': ['turn.id', 'turn.status'],
      'item/started': ['item.id', 'item.type'],
      'item/completed': ['item.id', 'item.type', 'item.status'],
      error: ['willRetry', 'error.message'],
      'account/login/completed': ['loginId', 'success'],
    },
  },
  // A gap here degrades a label, the meter or a status line — never the session.
  cosmetic: {
    results: {
      'model/list': ['data.displayName', 'data.isDefault', 'data.hidden', 'data.defaultReasoningEffort',
        'data.supportedReasoningEfforts.reasoningEffort', 'nextCursor'],
      'turn/steer': ['turnId'],
      'mcpServerStatus/list': ['data.name', 'data.runtimeStatus'],
    },
    notifications: {
      'thread/tokenUsage/updated': ['tokenUsage.total.inputTokens', 'tokenUsage.total.outputTokens',
        'tokenUsage.total.totalTokens', 'tokenUsage.modelContextWindow'],
      'mcpServer/startupStatus/updated': ['name', 'status'],
    },
  },
});
