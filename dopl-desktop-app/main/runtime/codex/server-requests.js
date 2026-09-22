// SERVER -> CLIENT REQUESTS for the measured app-server v2 surface.
//
// Each method has its own response schema. Treating all of them as `{ decision }` is not merely
// imprecise: permissions, MCP elicitation and request_user_input reject that shape and can leave
// the turn waiting forever. This module owns the translation and always fails closed.

const DECISION_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
]);

const EMPTY_PERMISSIONS = Object.freeze({
  fileSystem: null,
  network: Object.freeze({ enabled: false }),
});

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

function compact(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function approvalInput(method, params) {
  const p = params && typeof params === 'object' ? params : {};
  if (method === 'item/commandExecution/requestApproval') {
    return compact({ command: p.command, cwd: p.cwd, reason: p.reason });
  }
  if (method === 'item/fileChange/requestApproval') {
    return compact({ grantRoot: p.grantRoot, reason: p.reason });
  }
  if (method === 'item/permissions/requestApproval') {
    return (p.permissions && typeof p.permissions === 'object') ? p.permissions : {};
  }
  return {};
}

async function verdictFor(method, params, decide) {
  try {
    const name = method === 'item/commandExecution/requestApproval' ? 'commandExecution'
      : method === 'item/fileChange/requestApproval' ? 'fileChange'
        : 'request_permissions';
    return await decide(name, approvalInput(method, params));
  } catch (_) {
    return 'deny';
  }
}

async function answer(message, decide) {
  const msg = message && typeof message === 'object' ? message : {};
  const method = String(msg.method || '');
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  const gate = typeof decide === 'function' ? decide : async () => 'deny';

  if (DECISION_METHODS.has(method)) {
    const verdict = await verdictFor(method, params, gate);
    return { decision: verdict === 'allow' ? 'accept' : 'decline' };
  }
  if (method === 'item/permissions/requestApproval') {
    const verdict = await verdictFor(method, params, gate);
    const requested = params.permissions && typeof params.permissions === 'object'
      ? params.permissions : {};
    return {
      permissions: verdict === 'allow' ? requested : EMPTY_PERMISSIONS,
      scope: 'turn',
    };
  }
  // Dopl has no surface for these two interactive prompts yet. A made-up answer would be an
  // operator decision the operator never made, so both take their protocol-valid decline path.
  if (method === 'mcpServer/elicitation/request') return { action: 'decline' };
  if (method === 'item/tool/requestUserInput') return { answers: {} };

  throw rpcError(-32601, `Unsupported Codex server request: ${method || '(missing method)'}`);
}

module.exports = { answer, approvalInput, EMPTY_PERMISSIONS, rpcError };
