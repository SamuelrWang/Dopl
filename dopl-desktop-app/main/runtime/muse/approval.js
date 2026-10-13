// MSP APPROVALS → DOPL'S GATE → `approval/decide`. The one translator (INVARIANTS §11.0i approval slot).
//
// MSP splits an approval in two: a held server request `approval/request` that is answered with a
// PRESENTATION RECEIPT (`{}`) only, and the decision, which travels as the `approval/decide` COMMAND naming
// one of the approval's own `availableChoices` and its `currentRequirementId` (a multi-stage shell approval
// asks once per stage; `approval/updated` moves the requirement). The `approval/requested` notification and
// the request carry the same params; either starts the decision, once per (approvalId, stage).
// Fails closed everywhere: an unreadable approval is denied; one Dopl cannot answer interrupts the turn.

const tools = require('./tools');

// The gate's name for a subject kind Dopl does not know — the SHARED prefix (`../sdk-shape.js`): never a
// standing grant, denied outright on a restricted profile. MSP: "unknown kinds … never auto-approved".
const UNKNOWN_PREFIX = require('../sdk-shape').UNRECOGNISED_REQUEST_PREFIX;

const APPROVAL_REQUEST = 'approval/request';
const APPROVAL_REQUESTED = 'approval/requested';
const APPROVAL_UPDATED = 'approval/updated';

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' ? v : '');

/** The name the gate is asked about: the subject kind, or for `tool` the tool's own name. */
function gateName(params) {
  const p = obj(params);
  const subject = obj(p.subject);
  const kind = str(subject.kind);
  if (kind === tools.TOOL_SUBJECT) {
    const name = str(p.toolName) || str(subject.toolName);
    return name || `${UNKNOWN_PREFIX}tool`;
  }
  if (tools.SUBJECT_KINDS.indexOf(kind) !== -1) return kind;
  return `${UNKNOWN_PREFIX}${kind || 'unknown'}`;
}

function compact(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

/** What the gate (and the operator's card) sees: the tool's own arguments, or the subject's facts. */
function gateInput(params) {
  const p = obj(params);
  const subject = obj(p.subject);
  if (str(subject.kind) === tools.TOOL_SUBJECT) {
    let args = null;
    try { args = JSON.parse(str(p.rawArgs)); } catch (_) { args = null; }
    return args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  }
  const stages = Array.isArray(subject.stages) ? subject.stages : [];
  return compact({
    command: str(subject.command) || (stages.length ? stages.map((s) => (Array.isArray(s.argv) ? s.argv.join(' ') : '')).join(' | ') : ''),
    path: subject.path, access: subject.access, host: subject.host, port: subject.port,
    protocol: subject.protocol, target: subject.target,
  });
}

/** The choice that carries a verdict — ONCE-scoped only (a session/persistent grant records one click on a
 *  ledger Dopl cannot read, the Codex `acceptForSession` rule), or null when the approval offers none. */
function choiceFor(choices, verdict) {
  const list = Array.isArray(choices) ? choices.filter((c) => c && typeof c.choiceId === 'string') : [];
  const once = (decision) => list.find((c) => c.decision === decision && (c.scope === 'once' || c.scope == null));
  if (verdict === 'allow') return once('approved') || null;
  return once('denied') || list.find((c) => c.decision === 'denied') || list.find((c) => c.decision === 'abort') || null;
}

/** The dedupe key for one stage of one approval. */
function stageKey(params) {
  const p = obj(params);
  const req = obj(p.currentRequirementId);
  return `${str(p.approvalId)}#${Number.isInteger(req.sourceIndex) ? req.sourceIndex : '?'}`;
}

/**
 * The approval driver for one session. `o`:
 *   `gate(name, input, meta)` → Promise<'allow'|'deny'>;
 *   `request(method, params)` → the connection's request;  `sessionId()` → the live session id;
 *   `commandId()` → a UUIDv7;  `onStuck(why)` → interrupt the turn (no choice could carry the verdict);
 *   `onUnknown(method)` → show a server request Dopl does not know;  `log`.
 * Returns `{ onServerRequest(msg), onNotification(msg) }`.
 */
function makeApprovalDriver(o) {
  const log = typeof o.log === 'function' ? o.log : () => {};
  const seen = new Set();

  async function decide(params) {
    const p = obj(params);
    if (!str(p.approvalId) || !p.currentRequirementId) return;
    const key = stageKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    let verdict = 'deny';
    try {
      verdict = (await o.gate(gateName(p), gateInput(p), { requestId: key, toolUseID: str(p.itemId) || null })) === 'allow' ? 'allow' : 'deny';
    } catch (_) { verdict = 'deny'; } // a gate that throws is not an operator who said yes
    let choice = choiceFor(p.availableChoices, verdict);
    // An allow with no once-scoped approve choice is not widened to a session grant: it is denied.
    if (!choice && verdict === 'allow') choice = choiceFor(p.availableChoices, 'deny');
    if (!choice) {
      log(`muse: approval ${key} offers no choice Dopl can send — interrupting the turn`);
      if (typeof o.onStuck === 'function') o.onStuck('no-choice');
      return;
    }
    try {
      await o.request('approval/decide', {
        sessionId: str(p.sessionId) || o.sessionId(),
        approvalId: p.approvalId,
        requirementId: p.currentRequirementId,
        choiceId: choice.choiceId,
        commandId: o.commandId(),
      });
    } catch (err) {
      log(`muse: approval/decide refused for ${key} —`, (err && err.message) || err);
      if (typeof o.onStuck === 'function') o.onStuck('decide-refused');
    }
  }

  return {
    // The receipt only; the decision is a separate command (never awaited here: a receipt must not wait
    // on a person). A request Dopl does not know is SHOWN and refused, never answered in a guessed shape.
    onServerRequest(msg) {
      const method = str(msg && msg.method);
      if (method === APPROVAL_REQUEST) {
        void decide(msg.params);
        return {};
      }
      if (typeof o.onUnknown === 'function') o.onUnknown(method);
      throw rpcError(-32601, `Dopl does not answer Muse's ${method || '(no method)'} request in this version`);
    },
    onNotification(msg) {
      const method = str(msg && msg.method);
      if (method === APPROVAL_REQUESTED) { void decide(msg.params); return true; }
      if (method === APPROVAL_UPDATED) {
        const p = obj(msg.params);
        // A new stage of a multi-stage approval: asked again, under its own requirement.
        if (p.currentRequirementId && Array.isArray(p.availableChoices)) void decide(p);
        return true;
      }
      return false;
    },
  };
}

// Descriptor half — Axis A's answer shape.
const descriptor = {
  // `approval/request` + `approval/requested` park the turn until Dopl's `approval/decide`.
  heldCallback: true,
  // MSP gates subject KINDS (shell, file access, network…) and names a tool only for `tool` subjects.
  granularity: 'category',
  categories: tools.SUBJECT_KINDS.slice(),
};

module.exports = {
  makeApprovalDriver, gateName, gateInput, choiceFor, stageKey, descriptor, rpcError, UNKNOWN_PREFIX,
};
