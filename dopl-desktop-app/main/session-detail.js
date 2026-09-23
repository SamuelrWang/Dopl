// The finer activity signal BESIDE the pill (and the end reason): additive and local-only, because the
// server's `state` enum is three-valued and one unknown value 400s the whole push (INVARIANTS §11).

const { mcpShortName } = require('./mcp-tool-names');
// Free vars inside the block below, like `mcpShortName` (the one tool-name normalizer); neither pulls electron.
const runtimeRegistry = require('./runtime');
const runtimeCopy = runtimeRegistry.copy;

// ─── BEGIN SESSION-DETAIL-PURE (injectable; unit-tested via source extraction) ────────

// `mcpShortName`, `runtimeRegistry` and `runtimeCopy` are free vars from here down.

// A closed set: the renderer maps each to copy and renders nothing for an unknown key.
const DETAIL_THINKING = 'thinking';
const DETAIL_TOOL = 'tool';
const DETAIL_POSTING = 'posting';
const DETAIL_PERMISSION = 'permission';
const DETAIL_AWAITING_PEER = 'awaiting_peer';
const DETAIL_AWAITING_INBOUND = 'awaiting_inbound';
const DETAIL_KINDS = [
  DETAIL_THINKING, DETAIL_TOOL, DETAIL_POSTING, DETAIL_PERMISSION,
  DETAIL_AWAITING_PEER, DETAIL_AWAITING_INBOUND,
];

// A tool label is peer-adjacent display text: one line, collapsed, caption-bounded.
const TOOL_LABEL_CAP = 32;

/** Record the last event kind (pass-through events included: they say what was rendered). Runs on every
 *  event inside `dispatch`, so it only assigns. */
function noteEvent(s, event) {
  if (!s || !event || typeof event.type !== 'string') return;
  s.lastEventKind = event.type;
  if (event.type !== 'tool_use') return;
  s.lastToolLabel = toolLabel(event.payload && event.payload.name);
}

// Through the gate's own normalizer, never a second matcher over a raw tool name (F-139).
function toolLabel(name) {
  if (typeof name !== 'string') return null;
  const short = mcpShortName(name).replace(/\s+/g, ' ').trim().slice(0, TOOL_LABEL_CAP).trim();
  return short || null;
}

/**
 * `(state, last event kind) -> detail key`, or null. It only ever refines a `working` pill: a held permission
 * outranks the tool that hit it; agent output clears the thinking chip; the fallback is `thinking` because a
 * turn is known to be in flight here.
 */
function detailFor(state, lastEventKind, pill) {
  if (pill !== 'working') return null;
  const st = state || {};
  if (st.activity === 'awaiting_permission') return DETAIL_PERMISSION;
  if (st.activity === 'awaiting_peer') return DETAIL_AWAITING_PEER;
  if (st.activity === 'awaiting_inbound') return DETAIL_AWAITING_INBOUND;
  if (lastEventKind === 'tool_use') return DETAIL_TOOL;
  if (lastEventKind === 'outbound_post') return DETAIL_POSTING;
  if (lastEventKind === 'assistant') return null;
  return DETAIL_THINKING;
}

/**
 * Why a run stopped: the frozen vendor-neutral code, re-said from the record's OWN runtime descriptor at read
 * time. The adapter's `diag` sentence passes through unparsed; its producers are the redaction boundary (no
 * token, prompt or full path). Null for an ordinary end.
 */
function endReasonFor(rec) {
  const r = rec || {};
  const code = typeof r.endCode === 'string' ? r.endCode : '';
  const detail = typeof r.diag === 'string' && r.diag ? r.diag : null;
  if (!code && !detail) return null;
  const descriptor = runtimeRegistry.descriptorFor(r.runtimeId);
  const copy = runtimeCopy.errorCopy(descriptor, code, detail);
  return { code: copy.code, text: copy.body, action: copy.action, detail: copy.detail };
}

// ─── END SESSION-DETAIL-PURE ─────────────────────────────────────────────────────────

module.exports = {
  DETAIL_KINDS,
  TOOL_LABEL_CAP,
  noteEvent,
  toolLabel,
  detailFor,
  endReasonFor,
};
