// The quantization and the cadence floor that let the rich fields ride `channel_sessions` without turning
// the state-change push into a heartbeat (`lastActivityAt` moves on every dispatch). QUANTIZE rounds a number
// down to its bucket on the ROW itself; FLOOR delays a churn-only set (never a schedule). A state change bypasses
// the floor. Null is not zero, and zero is not null.

// ─── BEGIN SESSION-TELEMETRY (pure; unit-tested via source extraction) ───────────────────

// No require / electron / fs from here down: the suite slices and evaluates this block.

// Context occupancy buckets by FRACTION of its own window (one bucket = one visible notch on the meter).
const CONTEXT_BUCKET_FRACTION = 0.05;

// With no reported window, an absolute bucket finer than any known window's, so it is never coarser.
const CONTEXT_BUCKET_FALLBACK_TOKENS = 5000;

// Lifetime spend only climbs: about one move per substantial turn.
const TOKENS_BUCKET = 10000;

// At most 6 churn writes per minute per workspace, only while something moves; the peers poll every 30s anyway.
const TELEMETRY_MIN_INTERVAL_MS = 10000;

// `session-metrics.js › metricOrNull`'s rule restated (this block may not require); pinned by its suite.
function numberOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

// The complement of the server's SAFE_LABEL_RE (`src/shared/lib/safe-label.ts`): this side STRIPS where the
// server rejects, because one bad character 400s the whole array unretryably. Escapes, never literals.
const UNSAFE_LABEL_RE = /[\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/gu;

// The server's bounds, field for field (`schema-sessions.ts`); `detail` is a key, so it stays short.
const DETAIL_MAX = 40;
const TOOL_LABEL_MAX = 80;
const MODEL_MAX = 120;
// Not a telemetry field (it rides the state half) but it needs `labelOrNull`: the column's own bound.
const IDENTITY_NAME_MAX = 120;

/** A display string for the wire, or null: unsafe characters removed, collapsed, bounded. */
function labelOrNull(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.replace(UNSAFE_LABEL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || null;
}

// Epoch ms -> ISO-8601 with offset (the columns are TIMESTAMPTZ and zod rejects a number, 400ing the whole
// report); an unrepresentable stamp costs this field, never the push.
function isoOrNull(value) {
  const n = numberOrNull(value);
  if (n === null || n === 0) return null;
  try {
    return new Date(n).toISOString();
  } catch (_err) {
    return null;
  }
}

// Never zero: a tiny window would round the fraction to 0 and the quantizer would divide by it.
function contextBucket(window) {
  const w = numberOrNull(window);
  if (w === null || w <= 0) return CONTEXT_BUCKET_FALLBACK_TOKENS;
  return Math.max(1, Math.round(w * CONTEXT_BUCKET_FRACTION));
}

// DOWN, not nearest: the number means "at least this much". Null in, null out.
function quantize(value, bucket) {
  const n = numberOrNull(value);
  if (n === null) return null;
  const b = bucket > 0 ? bucket : 1;
  return Math.floor(n / b) * b;
}

function quantizeContext(used, window) {
  return quantize(used, contextBucket(window));
}

function quantizeTokens(spent) {
  return quantize(spent, TOKENS_BUCKET);
}

/**
 * The rich fields of a wire row from one summary entry. `contextWindow` is the denominator and is not
 * bucketed (only floored to an integer for `.int()`); `lastActivityAt` stays exact (it tells "going" from
 * "wedged") and is bounded by the floor instead.
 */
function telemetryFields(e) {
  const x = e || {};
  return {
    detail: labelOrNull(x.detail, DETAIL_MAX),
    toolLabel: labelOrNull(x.toolLabel, TOOL_LABEL_MAX),
    model: labelOrNull(x.model, MODEL_MAX),
    contextUsed: quantizeContext(x.contextUsed, x.contextWindow),
    contextWindow: quantize(x.contextWindow, 1),
    tokensSpent: quantizeTokens(x.tokensSpent),
    startedAt: isoOrNull(x.startedAt),
    lastActivityAt: isoOrNull(x.lastActivityAt),
    // The health half: small rare integers stay exact; `tokensDelta` shares the spend bucket; `stale` is clock-
    // derived, so it rides the CHURN half (in the state half it would bypass the floor on a timer).
    turns: numberOrNull(x.turns),
    tokensDelta: quantizeTokens(x.tokensDelta),
    stale: x.stale === true,
    deniedCalls: numberOrNull(x.deniedCalls),
    lastDeniedTool: labelOrNull(x.lastDeniedTool, TOOL_LABEL_MAX),
    lastWakeSeq: numberOrNull(x.lastWakeSeq),
    lastWakeAt: isoOrNull(x.lastWakeAt),
  };
}

// The floor's whole definition of "a state change": a literal, so every new row field is classified
// deliberately. Identity-like fields (name, colour, display name) are free to push past the floor.
const STATE_FIELDS = [
  'sessionKey', 'channelId', 'threadId', 'name', 'state', 'channelName', 'threadTitle',
  'identityName', 'color', 'displayName',
];

/** One string over the state half of a row set; membership is part of it (an arrival or a delete-by-omission
 *  counts as a state change). */
function stateDigest(rows) {
  return JSON.stringify((rows || []).map((row) => STATE_FIELDS.map((f) => (row || {})[f])));
}

/** May a churn-only set be written now? A workspace never written is never floored. */
function floorAllows(lastAt, now) {
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt)) return true;
  return now - lastAt >= TELEMETRY_MIN_INTERVAL_MS;
}

// ─── END SESSION-TELEMETRY ───────────────────────────────────────────────────────────────

module.exports = {
  CONTEXT_BUCKET_FRACTION,
  CONTEXT_BUCKET_FALLBACK_TOKENS,
  TOKENS_BUCKET,
  TELEMETRY_MIN_INTERVAL_MS,
  STATE_FIELDS,
  DETAIL_MAX,
  TOOL_LABEL_MAX,
  MODEL_MAX,
  IDENTITY_NAME_MAX,
  // The desktop's one copy of the server's label charset; `identity-resolve.js` validates overrides with it (F-281).
  UNSAFE_LABEL_RE,
  numberOrNull,
  labelOrNull,
  isoOrNull,
  contextBucket,
  quantize,
  quantizeContext,
  quantizeTokens,
  telemetryFields,
  stateDigest,
  floorAllows,
};
