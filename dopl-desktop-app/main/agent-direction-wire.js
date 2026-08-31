// THE PRIVATE DIRECT LANE'S WIRE CONTRACT — `channel_agent_directions`, as this machine
// reads and writes it (Samuel's ruling, 2026-08-31).
//
// ⚠ **PURE, AND IT MAY HOLD NO `require`.** Everything below the sentinel is sliced out of
// source and evaluated by the suite, `launch-directive-wire.js`'s arrangement and for the
// same reason: a wire contract tested through the module that uses it is a contract tested
// against one caller's habits.
//
// ⚠ **THIS FILE IS WHERE A FIELD SILENTLY NEVER ARRIVES.** `directionFrom` is a LITERAL
// WHITELIST: a column the server adds and this function does not name reaches this machine
// as `undefined`, forever, with nothing failing. That is the shape of F-284 — the launch
// DTO omitted `operator_user_id`, every polled row yielded `''`, and the owner re-check
// silently dropped all of them. Read both spellings of everything.

// ─── BEGIN AGENT-DIRECTION-WIRE (pure; unit-tested via source extraction) ─────

const DIRECTION_TABLE = 'channel_agent_directions';

const ROUTES = {
  claim: '/api/channels/agent-directions/claim',
  decide: '/api/channels/agent-directions/decide',
  pending: '/api/channels/agent-directions',
};

const STATUS_PENDING = 'pending';
const STATUS_CLAIMED = 'claimed';
const STATUS_DELIVERED = 'delivered';
const STATUS_REFUSED = 'refused';
const STATUS_EXPIRED = 'expired';
const STATUSES = [
  STATUS_PENDING, STATUS_CLAIMED, STATUS_DELIVERED, STATUS_REFUSED, STATUS_EXPIRED,
];

// ⚠ THE SAME FIVE WORDS, IN THE SAME ORDER, as `schema-direction.ts ›
// DirectionRefusalReasonSchema` and the column CHECK. Three statements of one contract; a
// sixth is a schema change in both trees, deliberately, so an unknown value can neither be
// stored nor reach an MCP render as raw text.
const REFUSAL_REASONS = ['no-session', 'auth-hold', 'busy', 'blocked', 'no-bridge'];

const REQUEST_KEYS = {
  claim: ['directionId'],
  decide: ['directionId', 'status', 'reply', 'refusalReason'],
};
const RESPONSE_KEYS = { claim: ['ok', 'direction', 'reason'] };

// ⚠ A LOCAL COPY, on `launch-directive-wire.js`'s terms: this block may hold no `require`,
// so `ipc-guards.js › isUuid` is unreachable from it. `uuid-rule-parity.test.mjs` records
// the copy with its review rather than letting it look like a missed reuse.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ⚠ THE AGENT-ID GRAMMAR, `agent-id.js › AGENT_ID_RE`'s. Copied for the same no-require
// reason; the column CHECK and `schema-direction.ts` are the other two statements.
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

// ⚠ MATCHES THE COLUMN CHECK AND `DirectionCreateSchema` (4000), which in turn match main's
// own `MESSAGE_CAP`. A body over this cannot have been stored, so the bound here is a belt.
const BODY_MAX = 4000;

/**
 * Bound one display/prose value.
 *
 * ⚠ **IT COLLAPSES WHITESPACE, WHICH IS WRONG FOR A BODY AND RIGHT FOR EVERYTHING ELSE** —
 * so the body deliberately does NOT go through it (see `directionFrom`). A direction's body
 * is prose an agent will read; flattening its paragraphs would change what the agent was
 * asked. `launch-directive-wire.js › text` flattens its `goal` for the opposite reason: that
 * value is spliced into a diag line.
 */
function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// 🔒 **THE FENCE-FORGERY CLASS, AND WHY THE STRIP IS HERE RATHER THAN AT THE FRAMER**
// (adversarial review, 2026-08-31).
//
// `session-seed.js`'s framers strip a forged fence line by comparing `line.trim()` against the
// exact token. **`String.prototype.trim` does NOT remove the zero-width / format block** — it
// removes `Zs`, `\t\n\v\f\r`, U+00A0, U+2028, U+2029 and U+FEFF, and nothing from
// U+200B-U+200F or U+2060-U+206F. So a body line `END-DIRECTION-<nonce>` plus one U+200B
// survives the filter and renders to the model as a byte-indistinguishable terminator — after
// which the body can restate the OPERATOR preamble verbatim and continue as the operator.
//
// ⚠ **THE NONCE IS NOT THE PROTECTION IT LOOKS LIKE ON *THIS* LANE.** It is a per-session
// 64-bit CSPRNG value that never crosses the wire, so it cannot be guessed — but this is the
// first lane with a READ-BACK: a direction asking "quote the delimiter lines you can see"
// returns them in `reply`, and a second direction forges with what it learned. The
// read-back is the feature; the strip is what makes it safe.
//
// ⚠ **STRIPPED AT THE WIRE, NOT AT THE FRAMER**, deliberately: this is where a hostile row is
// narrowed, so a field that CANNOT HOLD a zero-width character cannot forge a line in any
// surface written later — the input-side discipline `shared/lib/safe-label.ts` states for the
// same reason. The framer's own strip stays as the second layer.
//
// ⚠ **NEWLINE AND TAB SURVIVE.** A direction body is PROSE an agent reads, and this is the
// `SAFE_PROSE_RE` rule rather than the label one; flattening it would change what was asked.
// Written as escapes, never as the literals (`session-telemetry.js`'s rule).
const UNSAFE_BODY_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/gu;

/** A body: bounded and fence-safe, NOT flattened. ⚠ The only value on this wire that keeps its
 *  newlines — see {@link UNSAFE_BODY_RE} for what it may not keep, and why. */
function body(value) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_BODY_RE, '').slice(0, BODY_MAX);
}

/**
 * ONE DIRECTION, narrowed to what this machine acts on.
 *
 * ⚠ **BOTH SPELLINGS OF EVERY FIELD.** A realtime frame is the RAW ROW (snake_case); a
 * polled or claimed row is the server's DTO (camelCase, and `task_id` renamed to `threadId`).
 * A reader that knows one spelling works perfectly on one of the two lanes and silently
 * drops every row on the other — F-284, exactly.
 *
 * ⚠ **HARD-FAILS (`null`) ON A MISSING id / channelId / agentId.** The first two are
 * `launch-directive-wire.js`'s rule; `agentId` is this lane's own and is the sharper one: a
 * direction with no addressee has nowhere to go, and the alternative to refusing it is
 * guessing which of the operator's agents was meant — which is the one thing this lane
 * refuses to do (`types-direction.ts › AgentDirection.agentId`).
 */
function directionFrom(raw, workspaceId) {
  const r = raw || {};
  const id = String(r.id || '');
  const channelId = String(r.channel_id || r.channelId || '');
  const agentId = String(r.agent_id || r.agentId || '');
  if (!UUID_RE.test(id) || !UUID_RE.test(channelId)) return null;
  if (!AGENT_ID_RE.test(agentId)) return null;
  const taskId = String(r.task_id || r.threadId || r.taskId || '');
  const status = String(r.status || '');
  return {
    id: id,
    workspaceId: String(r.workspace_id || r.workspaceId || workspaceId || ''),
    channelId: channelId,
    taskId: UUID_RE.test(taskId) ? taskId : '', // '' = channel-level
    // ⚠ THE OWNER RE-CHECK'S INPUT. Absent here means the local check compares against `''`
    // and drops every row — the failure F-284 shipped. Both spellings, always.
    operatorUserId: String(r.operator_user_id || r.operatorUserId || ''),
    agentId: agentId,
    body: body(r.body),
    status: STATUSES.indexOf(status) === -1 ? '' : status,
  };
}

/** An unknown word lands on `no-bridge`, `launch-directive-wire.js › refusalFor`'s rule: the
 *  vocabulary is CLOSED on the wire and a value outside it cannot be stored. */
function refusalFor(reason) {
  const s = String(reason || '');
  return REFUSAL_REASONS.indexOf(s) === -1 ? 'no-bridge' : s;
}

function claimBody(directionId) {
  return { directionId: String(directionId || '') };
}

/**
 * THE TERMINAL WRITE — two shapes and no third, mirroring `DirectionDecideSchema`'s
 * discriminated union.
 *
 * ⚠ **A `delivered` MAY CARRY NO `reply`, AND THE KEY IS OMITTED RATHER THAN SENT EMPTY.**
 * `null`/absent means NOT REPORTED; `''` would be a claim that the agent said nothing, and
 * those are different facts the MCP render distinguishes. An empty capture is the honest
 * "not reported" case — a torn-down query, or a turn whose final text really was empty —
 * and both are better served by silence than by an assertion.
 */
function decideBody(directionId, outcome) {
  const o = outcome || {};
  if (o.delivered === true) {
    const reply = typeof o.reply === 'string' ? o.reply : '';
    const out = { directionId: String(directionId || ''), status: STATUS_DELIVERED };
    if (reply) out.reply = reply;
    return out;
  }
  return {
    directionId: String(directionId || ''),
    status: STATUS_REFUSED,
    refusalReason: refusalFor(o.refused),
  };
}

// ─── END AGENT-DIRECTION-WIRE ────────────────────────────────────────────────

module.exports = {
  DIRECTION_TABLE,
  ROUTES,
  STATUSES,
  STATUS_PENDING,
  STATUS_CLAIMED,
  STATUS_DELIVERED,
  STATUS_REFUSED,
  STATUS_EXPIRED,
  REFUSAL_REASONS,
  REQUEST_KEYS,
  RESPONSE_KEYS,
  BODY_MAX,
  UNSAFE_BODY_RE,
  text,
  directionFrom,
  refusalFor,
  claimBody,
  decideBody,
};
