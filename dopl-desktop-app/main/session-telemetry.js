// SESSION TELEMETRY — the QUANTIZATION and the CADENCE FLOOR that let the eight rich fields ride
// `channel_sessions` without turning the state-change push into a heartbeat.
//
// Its own file on the seam `session-metrics.js` took out of `session-summary.js` (§1: one file,
// one reason to change). `session-state-push.js` answers "WHEN does this machine write, and what
// may it honestly claim"; this answers "HOW COARSE is a number allowed to be before it is worth a
// write". PURE, no require of its own, and `session-state-push.js` requires it ABOVE its BEGIN
// sentinel so its harness injects the real module rather than a slice plus a stub.
//
// THE PROBLEM. `lastActivityAt` is stamped at the engine's dispatch funnel, many times per TURN
// (`session-summary.js › noteActivity`). Unquantized and unfloored, the push's own digest gate
// stops gating anything: the set digest moves on every SDK event, so a writer that "writes when a
// session's DERIVED state actually moves" writes per event.
//
// TWO MECHANISMS, AND NEITHER IS A TIMER:
//   QUANTIZE  a number is rounded DOWN to its bucket before it becomes part of the row, so the
//             digest cannot move on drift smaller than the bucket. The ROW carries the quantized
//             value — quantizing only the digest would leave a precise number on the wire that the
//             gate is not watching, and a peer reading a stale exact figure is worse than a coarse
//             honest one.
//   FLOOR     a set whose STATE half did not move waits out `TELEMETRY_MIN_INTERVAL_MS` since this
//             workspace's last successful write. A DELAY, NEVER A SCHEDULE: nothing is queued, no
//             timer is armed, the digest is not recorded, and the session's NEXT projection move
//             re-evaluates.
//
// A STATE CHANGE BYPASSES THE FLOOR. `state` is what a peer's card is ABOUT, and delaying
// `working -> idle` by up to ten seconds to save a write is the wrong trade. The floor governs
// CHURN only.
//
// NULL IS NOT ZERO, AND ZERO IS NOT NULL. `metricOrNull`'s discipline survives quantization intact
// — null in, null out at every step — and `tokensSpent: 0` on the wire means "measured, and under
// one bucket" where `null` means "nothing has measured this".

// ─── BEGIN SESSION-TELEMETRY (pure; unit-tested via source extraction) ───────────────────
// No require / electron / fs reference from here down, so test/session-telemetry.test.mjs
// slices this block and evaluates it verbatim in a plain Node context.

// ── THE BUCKETS, WITH THEIR DERIVATIONS ──────────────────────────────────────────────────

// CONTEXT OCCUPANCY, as a FRACTION OF THE WINDOW rather than an absolute count, because the
// surface that reads it is a PERCENTAGE meter: the same 5 000 tokens is a fifth of a 25k step on
// a 200k window and a twentieth of one on a 1M window. Bucketing by fraction makes the wire's
// resolution match the reader's — one bucket is one visible notch on the meter — on every model.
// 5% ⇒ at most 20 distinct values across a full window, so a session that fills its context from
// empty costs at most 20 digest moves on this field for its whole life.
const CONTEXT_BUCKET_FRACTION = 0.05;

// …AND THE ABSOLUTE FALLBACK for a model this build has no window row for
// (`session-model.js › contextWindowFor` answers null and never guesses a denominator). With no
// denominator there is no percentage to be a fraction of, so the bucket has to be meaningful as an
// ABSOLUTE count — which is also what the reader renders in that case. 5 000 tokens is about one
// small prompt, and deliberately FINER than any known model's bucket (half the 10 000 a 200k
// window gives, a tenth of the 1M one's 50 000), so an unknown model is never quantized MORE
// coarsely than a known one: extra resolution costs at most extra writes, already bounded by
// `TELEMETRY_MIN_INTERVAL_MS`, while too coarse a bucket destroys the signal and nothing bounds
// that.
const CONTEXT_BUCKET_FALLBACK_TOKENS = 5000;

// LIFETIME SPEND is a COUNT, not an occupancy, so it has no denominator to be a fraction of and
// no ceiling to run out of — it only ever climbs. 10 000 tokens is roughly one substantial turn
// on this workload, so the field moves about once per turn instead of once per assistant
// message; and a long session that burns a million tokens costs 100 digest moves rather than
// thousands.
const TOKENS_BUCKET = 10000;

// ── THE CADENCE FLOOR ────────────────────────────────────────────────────────────────────
// The derivation is an arithmetic on the write rate. Unfloored, a continuously working agent moves
// `lastActivityAt` on every engine dispatch, so the ceiling on writes would be the SDK's event
// rate. Floored at 10s the ceiling is 6 writes per minute PER WORKSPACE no matter how many
// sessions run here (the push groups by workspace and posts the whole set), and it is approached
// only while something is genuinely moving — an idle machine writes NOTHING, which is the shape
// `presence.js` (every 30s per listener, unconditionally, ~120 writes/hour forever) cannot claim.
// 10s is also the reader's resolution: the peer Agents tab polls `channel_sessions` on
// `PEER_SESSIONS_POLL_MS` (30s), so a churn field delivered faster could not be SEEN sooner.
const TELEMETRY_MIN_INTERVAL_MS = 10000;

/**
 * A number or nothing, restating `session-metrics.js › metricOrNull`'s rule at this boundary.
 * `typeof` FIRST, never a bare `Number()`: `Number(null)` and `Number('')` are both 0, so a
 * coercion-only guard turns every absence into a confident zero. Restated rather than imported
 * because this block is sliced and evaluated with no requires; the two are pinned against each
 * other in test/session-telemetry.test.mjs.
 */
function numberOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

// ── THE LABEL RULE, RESTATED FROM THE SERVER'S OWN (measured 2026-08-22) ─────────────────
// `schema-sessions.ts` validates these three with `safeLabel(subject, N)`, whose `SAFE_LABEL_RE`
// (`src/shared/lib/safe-label.ts`) rejects control chars, zero-width and bidi overrides, and the
// separators several renderers still treat as newlines: a field that can never hold a newline
// cannot forge a line in the SERVER's voice inside an MCP result that forgot to neutralize.
//
// THIS SIDE STRIPS WHERE THE SERVER REJECTS, and the asymmetry is the point. zod validates the
// ARRAY, so one bad character in one `toolLabel` would 400 the WHOLE push; `retryable(400)` is
// false, the digest is never recorded, and `read_sessions` answers `[]` for this machine — LIVE
// sessions included — for the life of the run. A tool name can come from the operator's own MCP
// servers, so the character set is not ours to assume.
//
// The classes are the complement of `SAFE_LABEL_RE`'s, written as `\uXXXX` and never as literals:
// a control character pasted into source is invisible in review and, inside a character class, a
// syntax error waiting for the next editor to normalize it.
const UNSAFE_LABEL_RE = /[\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/gu;

// ⚠ THE THREE BOUNDS ARE THE SERVER'S, FIELD FOR FIELD (`schema-sessions.ts`, 2026-08-22).
// `detail` is 40 rather than 200 deliberately on that side — it is a KEY, and a bound that fits
// a sentence invites one, which would be operator-only prose on a PEER-VISIBLE column.
const DETAIL_MAX = 40;
const TOOL_LABEL_MAX = 80;
const MODEL_MAX = 120;
// ⚠ A FOURTH BOUND, 2026-08-22 (agent identities). It is NOT a telemetry field — it rides
// the STATE half below — but the SANITIZER it needs is `labelOrNull`, and a second copy of
// the server's charset rule is exactly what this module exists to prevent. 120 is
// `agent_identities.name`'s own bound and `channel_sessions.identity_name`'s.
const IDENTITY_NAME_MAX = 120;

/** A display string for the wire, or null: unsafe characters removed, whitespace collapsed,
 *  bounded. Same discipline as `session-summary.js › displayText`, plus the server's charset. */
function labelOrNull(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.replace(UNSAFE_LABEL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || null;
}

/**
 * EPOCH MS -> AN ISO-8601 INSTANT WITH AN OFFSET, or null.
 *
 * The units do not survive the crossing, and this is the one place that knows it: everything on
 * this machine speaks EPOCH MS, while the columns are `TIMESTAMPTZ` validated by
 * `schema-sessions.ts` as `z.string().datetime({ offset: true })` — a raw number is not a rounding
 * difference but a zod failure that 400s the WHOLE report, unretryably blanking the machine's rows
 * for the run. The LOCAL wire is unchanged; the conversion happens here, on the server row alone.
 * An unrepresentable stamp is null, not an exception: `new Date(x).toISOString()` throws outside
 * the ECMAScript time range, and a corrupt stamp must cost this field, never the whole push.
 */
function isoOrNull(value) {
  const n = numberOrNull(value);
  if (n === null || n === 0) return null; // 0 is the epoch, which is not a stamp anything took
  try {
    return new Date(n).toISOString();
  } catch (_err) {
    return null;
  }
}

/**
 * THE BUCKET SIZE FOR ONE SESSION'S CONTEXT METER — a fraction of its own window, or the absolute
 * fallback when this build has no window for the model. NEVER ZERO: a window smaller than 20
 * tokens would round the fraction to 0 and make the quantizer divide by it.
 */
function contextBucket(window) {
  const w = numberOrNull(window);
  if (w === null || w <= 0) return CONTEXT_BUCKET_FALLBACK_TOKENS;
  return Math.max(1, Math.round(w * CONTEXT_BUCKET_FRACTION));
}

/**
 * Round a measured count DOWN to its bucket. DOWN, not nearest: the number answers "at least this
 * much", and rounding up would let a meter claim occupancy that has not happened. null in, null out.
 */
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
 * THE EIGHT RICH FIELDS OF A WIRE ROW, from one `session-summary.js` report entry. The names are
 * the summary's: `detail` / `toolLabel` from `liveSummary`, the metrics from
 * `session-metrics.js › metrics`, and `model` is `s.liveModel` else the operator's pick else null
 * — the SDK's own reported id first, the only honest answer to "which model is really answering".
 *
 * `contextWindow` is NOT quantized and must not be: it is the DENOMINATOR, a frozen table lookup
 * that never drifts, and rounding it would move the percentage the numerator was bucketed against.
 * It IS floored to an integer, because `schema-sessions.ts` validates all three counts with
 * `.int()`. `startedAt` is stamped once at construction and never moves. `lastActivityAt` is
 * deliberately unquantized — it is the one field an orchestrator reads to tell "still going" from
 * "wedged", so its cost is bounded by `TELEMETRY_MIN_INTERVAL_MS`, a rate bound rather than a
 * value bound. Both stamps cross as ISO-8601; see `isoOrNull`.
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
    // ── THE HEALTH HALF, 2026-09-01 (T25 / T50 / T51 / T83) ──────────────────────────────
    // `session-health.js` derives all seven; this decides how coarse each may be on the wire.
    //
    // `turns`, `deniedCalls` and `lastWakeSeq` are NOT quantized, for one reason: small integers
    // that move rarely — orders of magnitude below `lastActivityAt`'s per-dispatch churn, which is
    // the rate the quantizer exists for. Bucketing `turns` to 10 would destroy the field; the
    // difference between 1 turn and 4 IS the signal.
    // `tokensDelta` takes `tokensSpent`'s own bucket, so the two move together — a delta quantized
    // finer than its total would move on drift no reader can see.
    // `stale` is a boolean and is deliberately in the CHURN half (`STATE_FIELDS` does not list
    // it): it is derived from a WALL CLOCK, so in the state half it would flip a set past the
    // cadence floor on a timer. Floored, it lands on the session's next real move.
    turns: numberOrNull(x.turns),
    tokensDelta: quantizeTokens(x.tokensDelta),
    stale: x.stale === true,
    deniedCalls: numberOrNull(x.deniedCalls),
    lastDeniedTool: labelOrNull(x.lastDeniedTool, TOOL_LABEL_MAX),
    lastWakeSeq: numberOrNull(x.lastWakeSeq),
    lastWakeAt: isoOrNull(x.lastWakeAt),
  };
}

// ── THE STATE HALF OF A ROW ──────────────────────────────────────────────────────────────
//
// This list is the floor's whole definition of "a state change", so it is a literal rather than
// "the row minus the eight". A field added to `reportRow` must be classified DELIBERATELY:
// defaulting a new field into the state half makes it bypass the floor forever, and defaulting it
// into the churn half can silently delay something a peer's card is about.
//
// Every member is a fact about WHICH SESSION THIS IS or what it is doing at the coarse grain.
//
// `identityName` joined 2026-08-22: the identity the operator configured this agent to wear. Free
// to push past the floor, because `context.identity` is a SPAWN-TIME capture that can move at most
// once per session.
// `color` joined 2026-09-13: the identity a reader uses to tell two agents apart in a transcript,
// and it must push immediately or the box stays neutral for up to `TELEMETRY_MIN_INTERVAL_MS`
// after the agent starts. Free for a stronger reason than `identityName`'s — the server RESOLVES
// rather than stores it, and `session-colors.ts` rule 1 keeps whatever a session already holds, so
// it cannot oscillate and does not inherit `session-store.js`'s durable-whitelist hazard: a resume
// reporting no colour is overruled by rule 1, where one reporting no `identityName` NULLS it.
// `displayName` joined 2026-09-16 (F-708), missing by oversight rather than classification — what
// a person calls this session is a fact about which session it is. The cost was not the
// ten-second delay: a rename moves only the FULL-row digest, so a churn-only set inside the window
// is neither written nor digest-recorded and waits for a next projection move that a quiet machine
// never makes. Free for `identityName`'s reason — a rename is an operator gesture, not a counter.
const STATE_FIELDS = [
  'sessionKey', 'channelId', 'threadId', 'name', 'state', 'channelName', 'threadTitle',
  'identityName', 'color', 'displayName',
];

/** One stable string over the STATE half of a whole row set. ⚠ SET MEMBERSHIP IS PART OF IT:
 *  a session appearing or leaving changes this string even when every surviving row's state is
 *  identical, which is what makes an arrival and the replace-protocol's delete-by-omission both
 *  count as state changes. */
function stateDigest(rows) {
  return JSON.stringify((rows || []).map((row) => STATE_FIELDS.map((f) => (row || {})[f])));
}

/**
 * MAY A CHURN-ONLY SET BE WRITTEN NOW? It answers about the FLOOR alone — the caller has already
 * established that the set moved and that its state half did not. `lastAt` is when this workspace
 * last STORED a set, or null for "never", which is never floored: the first write for a workspace
 * carries its whole set.
 */
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
  IDENTITY_NAME_MAX, // 2026-08-22: the agent-identity name's bound, on both ends
  // THE DESKTOP'S ONE COPY OF THE SERVER'S SHORT-LABEL CHARSET, exported 2026-08-22 so
  // `identity-resolve.js` can VALIDATE renderer-supplied launch overrides against it (F-281:
  // `@/shared/lib/safe-label` imports zod, so no renderer surface can reach `SAFE_LABEL_RE` and
  // MAIN is the only real validator). Two copies of a neutralizer drift, and the copy that drifts
  // is the one that stops neutralizing.
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
