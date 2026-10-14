// WHAT DOPL READS FROM MUSE — and nothing else (`../sdk-shape.js`). Checked against each build's OWN
// description (`shape.js`, `muse schema … --experimental`) at launch and before the updater adopts a build.
// Tiered by what a gap costs: SAFETY and CORE refuse, COSMETIC is a drift note. Every item is read by this
// adapter's code and present in the measured shape (`test/fixtures/muse/shape-1.4.7-R6101.1.json`).

module.exports = Object.freeze({
  // A gap here could start a session with a Dopl restriction silently off.
  safety: {
    methods: ['initialize', 'session/start', 'session/resume', 'approval/decide'],
    results: {
      // `policy.js › assertSessionTook` reads every one back before a turn runs.
      'session/start': ['session.approvalMode.mode', 'session.permissionState.profileId', 'session.modelId', 'session.workspaceRoot'],
      'session/resume': ['session.approvalMode.mode', 'session.permissionState.profileId'],
      'initialize': ['schema.version', 'grantedCapabilities', 'museHome'],
    },
    // `approval.js` names the gate's question from these and answers with a listed choice.
    notifications: {
      'approval/requested': ['approvalId', 'currentRequirementId.sourceIndex', 'availableChoices.choiceId',
        'availableChoices.decision', 'subject.kind', 'toolName', 'rawArgs'],
    },
    requests: { 'approval/request': ['approvalId'] },
    // The approval modes Dopl sends must be words this build accepts (`policy.js`).
    values: { 'session/start approvalMode': ['promptUnmatched', 'onRequest'] },
  },
  // A gap here breaks the session: no turn, no reply, no sign-in.
  core: {
    methods: ['turn/start', 'turn/interrupt', 'model/list', 'account/read', 'account/loginStart', 'account/loginCancel'],
    results: {
      'session/start': ['session.sessionId'],
      'turn/start': ['turnId', 'disposition'],
      'account/loginStart': ['verificationUrl', 'userCode'],
      'account/read': ['state'],
    },
    notifications: {
      'turn/started': ['turnId'],
      'turn/completed': ['turnId', 'terminal', 'error.kind', 'error.message'],
      'item/started': ['item.itemId', 'item.kind'],
      'item/completed': ['item.itemId', 'item.kind', 'item.status', 'item.text', 'item.tool', 'item.args'],
      'account/loginCompleted': ['outcome'],
    },
    values: { 'turn/start ifBusy': ['steer'], 'account/loginStart type': ['deviceCode'] },
  },
  // A gap here degrades a label, the meter or a status line — never the session.
  cosmetic: {
    results: {
      'model/list': ['models.modelId', 'models.displayLabel', 'models.isDefault', 'models.contextLimit',
        'models.reasoningEffortVariants.tier'],
    },
    notifications: {
      'session/tokenUsage': ['cumulative.totalTokens', 'promptTokens'],
      'session/contextUsage': ['usedTokens', 'windowTokens'],
      'session/modelChanged': ['modelId'],
    },
  },
});
