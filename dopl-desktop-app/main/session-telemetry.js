// SESSION TELEMETRY — the QUANTIZATION and the CADENCE FLOOR that let the eight rich fields
// ride `channel_sessions` without turning the state-change push into a heartbeat.
//
// ⚠ WHY IT IS ITS OWN FILE, and it is the same seam `session-metrics.js` took out of
// `session-summary.js` (§1: one file, one reason to change). `session-state-push.js` answers
// "WHEN does this machine write, and what may it honestly claim" — identity, the replace
// protocol, the bounded retry. This answers "HOW COARSE is a number allowed to be before it is
// worth a write", which moves when the field set moves or when the cost arithmetic moves. It is
// also the cheaper split: that file measured 465 lines before this wave and the §1 cap is 500.
//
// ⚠ PURE, no require of its own, and `session-state-push.js` requires it ABOVE its BEGIN
// sentinel so its harness injects the real module — one program under test rather than a slice
// plus a stub. Same idiom as `session-metrics.js` / `session-detail.js`.
//
// ── THE PROBLEM THIS EXISTS FOR ──────────────────────────────────────────────────────────
//
// ⚠ `lastActivityAt` IS STAMPED AT THE ENGINE'S DISPATCH FUNNEL — many times per TURN
// (`session-summary.js › noteActivity`). Put it on the wire unquantized and unfloored and the
// push's own digest gate stops gating anything: the set digest moves on every SDK event, so the
// writer that "writes when a session's DERIVED state actually moves" would write per event. That
// is `presence.js`'s always-on cost with extra steps, and it is the exact defect
// `session-state-push.js`'s header forbids in capitals.
//
// TWO MECHANISMS, AND NEITHER IS A TIMER:
//
//   QUANTIZE  a number is rounded DOWN to its bucket before it becomes part of the row, so the
//             digest cannot move on drift smaller than the bucket. ⚠ THE ROW CARRIES THE
//             QUANTIZED VALUE, not the raw one. Quantizing only the digest would leave the wire
//             carrying a precise number the gate is not watching — a peer would read a stale
//             exact figure, which is worse than an honest coarse one.
//   FLOOR     a set whose STATE half did not move waits out `TELEMETRY_MIN_INTERVAL_MS` since
//             this workspace's last successful write. ⚠ A DELAY, NEVER A SCHEDULE: nothing is
//             queued and no timer is armed. The push simply does not happen, the digest is not
//             recorded, and the session's NEXT projection move re-evaluates. An agent that goes
//             quiet inside the floor window costs zero writes and its last churn rides out on
//             its next real state change — which is the same bargain the bounded retry already
//             makes.
//
// ⚠ A STATE CHANGE BYPASSES THE FLOOR. `state` is what a peer's card is ABOUT; delaying
// `working -> idle` by up to ten seconds to save a write is the wrong trade in the one direction
// that matters. The floor governs CHURN only.
//
// ── NULL IS NOT ZERO, AND ZERO IS NOT NULL ───────────────────────────────────────────────
// ⚠ `metricOrNull`'s discipline survives quantization intact: null in, null out, at every step.
// An UNMEASURED metric is never rounded into a confident 0.
// ⚠ AND `0` IS A REAL QUANTIZED ANSWER that must not be confused with it: `tokensSpent: 0` on
// the wire means "measured, and under one bucket", where `null` means "nothing has measured
// this". A reader that renders them the same is choosing to; the wire keeps them apart.

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
// (`session-model.js › contextWindowFor` answers null and never guesses a denominator).
//
// ⚠ WITH NO DENOMINATOR THERE IS NO PERCENTAGE TO BE A FRACTION OF, so the bucket has to be
// meaningful as an ABSOLUTE count — which is also what the reader renders in that case (the
// meter shows raw tokens rather than a made-up percentage). 5 000 tokens is about one small
// prompt: fine enough that a raw count still visibly moves, coarse enough that it cannot move
// per SDK event.
// ⚠ AND IT IS DELIBERATELY FINER THAN ANY KNOWN MODEL'S BUCKET — half the 10 000 the smallest
// window this build knows (200k) would produce, a tenth of the 1M one's 50 000. An unknown
// model is therefore never quantized MORE COARSELY than a known one. The trade is the right way
// round: extra resolution costs at most extra writes, and those are already bounded above by
// `TELEMETRY_MIN_INTERVAL_MS`, while too coarse a bucket destroys the signal outright and
// nothing bounds that.
const CONTEXT_BUCKET_FALLBACK_TOKENS = 5000;

// LIFETIME SPEND is a COUNT, not an occupancy, so it has no denominator to be a fraction of and
// no ceiling to run out of — it only ever climbs. 10 000 tokens is roughly one substantial turn
// on this workload, so the field moves about once per turn instead of once per assistant
// message; and a long session that burns a million tokens costs 100 digest moves rather than
// thousands.
const TOKENS_BUCKET = 10000;

// ── THE CADENCE FLOOR ────────────────────────────────────────────────────────────────────
//
// ⚠ THE DERIVATION IS AN ARITHMETIC ON THE WRITE RATE, AND IT IS THE WHOLE JUSTIFICATION.
// Unfloored, a continuously working agent moves `lastActivityAt` on every engine dispatch —
// dozens per turn — so the ceiling on writes would be the SDK's event rate. Floored at 10s the
// ceiling is 6 writes per minute PER WORKSPACE no matter how many sessions are running on this
// machine (the push groups by workspace and posts the whole set), and it is a CEILING that is
// only approached while something is genuinely moving: an idle machine writes NOTHING, which a
// heartbeat by definition cannot claim.
//
// ⚠ COMPARE THE THING IT MUST NOT BECOME: `presence.js` beats every 30s per listener per
// workspace UNCONDITIONALLY — ~120 writes/hour/machine forever, asleep or awake. This is a
// different shape, not a faster version of the same one: bounded ABOVE by 360/hour/workspace
// while work is happening, and exactly 0 when it is not.
//
// ⚠ 10s IS ALSO THE READER'S RESOLUTION. The peer Agents tab polls `channel_sessions` on
// `PEER_SESSIONS_POLL_MS` (30s), so a churn field delivered faster than this floor could not be
// SEEN sooner anyway — the floor gives up nothing the surface was going to render.
const TELEMETRY_MIN_INTERVAL_MS = 10000;

/**
 * A number or nothing, restating `session-metrics.js › metricOrNull`'s rule at this boundary.
 * ⚠ `typeof` FIRST, never a bare Number(): `Number(null)` is 0 and `Number('')` is 0, so a
 * coercion-only guard turns every absence into a confident zero — the one lie the whole
 * metric-or-null discipline exists to prevent. It is RESTATED rather than imported because this
 * block is sliced and evaluated with no requires; the two are pinned against each other in
 * test/session-telemetry.test.mjs.
 */
function numberOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

// ── ⚠ THE LABEL RULE, RESTATED FROM THE SERVER'S OWN (measured 2026-08-22) ───────────────
//
// `schema-sessions.ts` validates these three with `safeLabel(subject, N)`, whose
// `SAFE_LABEL_RE` (`src/shared/lib/safe-label.ts`) REJECTS control chars, zero-width and bidi
// overrides, and the line/paragraph separators several renderers still treat as newlines. Its
// header states why: a field that can never hold a newline cannot forge a line in the SERVER's
// voice inside an MCP result that forgot to neutralize.
//
// ⚠ THIS SIDE STRIPS WHERE THE SERVER REJECTS, and the asymmetry is the point. zod validates the
// ARRAY: one bad character in one `toolLabel` would 400 the WHOLE push, `retryable(400)` is
// false, the digest is never recorded, and every later push for that workspace fails identically
// — `read_sessions` answers `[]` for the machine, LIVE sessions included, for the life of the
// run. That is the exact wedge `serverReportable` / `nameReportable` already exist for, reached
// by a fourth road. A tool name can come from the operator's own MCP servers, so the character
// set is not ours to assume.
// ⚠ THE CLASSES, ESCAPED — the complement of `SAFE_LABEL_RE`'s own, character for character.
// Written as `\uXXXX` and never as the literals: a control character pasted into source is
// invisible in review and, inside a character class, is a syntax error waiting for the next
// editor to normalize it.
const UNSAFE_LABEL_RE = /[\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/gu;

// ⚠ THE THREE BOUNDS ARE THE SERVER'S, FIELD FOR FIELD (`schema-sessions.ts`, 2026-08-22).
// `detail` is 40 rather than 200 deliberately on that side — it is a KEY, and a bound that fits
// a sentence invites one, which would be operator-only prose on a PEER-VISIBLE column.
const DETAIL_MAX = 40;
const TOOL_LABEL_MAX = 80;
const MODEL_MAX = 120;
// ⚠ A FOURTH BOUND, 2026-08-22 (agent templates). It is NOT a telemetry field — it rides
// the STATE half below — but the SANITIZER it needs is `labelOrNull`, and a second copy of
// the server's charset rule is exactly what this module exists to prevent. 120 is
// `agent_templates.name`'s own bound and `channel_sessions.template_name`'s.
const TEMPLATE_NAME_MAX = 120;

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
 * ⚠ THE UNITS DO NOT SURVIVE THE CROSSING, AND THIS IS THE ONE PLACE THAT KNOWS IT. Everything
 * on this machine — `s.startedAt`, `s.lastActivityAt`, `metricOrNull`, the local summaries
 * bridge and every renderer reading it — speaks EPOCH MS. The columns are `TIMESTAMPTZ` and
 * `schema-sessions.ts` validates them as `z.string().datetime({ offset: true })`, so a raw
 * number is not a rounding difference: it is a zod failure that 400s the WHOLE report, which is
 * unretryable and blanks the machine's rows for the run.
 * ⚠ AND THE LOCAL WIRE IS UNCHANGED. `DesktopSessionSummary` still carries epoch ms; the
 * conversion happens HERE, on the server row alone, so no renderer has to learn a second unit.
 * ⚠ AN UNREPRESENTABLE STAMP IS NULL, NOT AN EXCEPTION. `new Date(x).toISOString()` throws on a
 * value outside the ECMAScript time range, and a corrupt stamp must cost this field, never the
 * whole push.
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
 * THE BUCKET SIZE FOR ONE SESSION'S CONTEXT METER — a fraction of its own window, or the
 * absolute fallback when this build has no window for the model.
 * ⚠ NEVER ZERO. A window smaller than 20 tokens would round the fraction to 0 and make the
 * quantizer divide by it; `Math.max(1, …)` is that guard, not a style choice.
 */
function contextBucket(window) {
  const w = numberOrNull(window);
  if (w === null || w <= 0) return CONTEXT_BUCKET_FALLBACK_TOKENS;
  return Math.max(1, Math.round(w * CONTEXT_BUCKET_FRACTION));
}

/**
 * Round a measured count DOWN to its bucket. ⚠ DOWN, not nearest: the number's job is to answer
 * "at least this much", and rounding up would let a meter claim occupancy that has not happened.
 * null in, null out.
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
 * THE EIGHT RICH FIELDS OF A WIRE ROW, from one `session-summary.js` report entry.
 *
 * ⚠ THE NAMES ARE THE SUMMARY'S, VERIFIED AGAINST IT: `detail` / `toolLabel` come from
 * `liveSummary`, and `contextUsed` / `contextWindow` / `tokensSpent` / `startedAt` /
 * `lastActivityAt` from `session-metrics.js › metrics`, spread into it. `model` is
 * `s.liveModel` else the operator's pick else null — the SDK's own reported id first, which is
 * the only honest answer to "which model is really answering".
 *
 * ⚠ `contextWindow` IS NOT QUANTIZED and must not be. It is the DENOMINATOR — a frozen table
 * lookup that either exists or does not — so it never drifts, and rounding it would move the
 * percentage the numerator was bucketed against. It IS floored to an integer, because
 * `schema-sessions.ts` validates all three counts with `.int()`.
 * ⚠ `startedAt` IS NOT QUANTIZED EITHER: it is stamped once at construction and never moves, so
 * it can cost at most one digest move per session however precise it is.
 * ⚠ `lastActivityAt` IS NOT QUANTIZED, DELIBERATELY, AND THE FLOOR IS WHY. It is the one field
 * an orchestrator reads to tell "still going" from "wedged", and a bucket coarse enough to stop
 * it moving would be coarse enough to destroy that answer. Its write cost is bounded by
 * `TELEMETRY_MIN_INTERVAL_MS` instead — a rate bound rather than a value bound.
 * ⚠ BOTH STAMPS CROSS AS ISO-8601, NOT AS EPOCH MS — see `isoOrNull`. The local summaries wire
 * is unchanged; only the server row converts.
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
    // ── ⚠ THE HEALTH HALF, 2026-09-01 (T25 / T50 / T51 / T83) ──────────────────────────────
    // `session-health.js` derives all seven; this decides how coarse each may be on the wire.
    //
    // ⚠ `turns`, `deniedCalls` AND `lastWakeSeq` ARE NOT QUANTIZED, AND THE REASON IS THE SAME
    // FOR ALL THREE: they are SMALL INTEGERS THAT MOVE RARELY. A turn count moves once per turn,
    // a denial count only when something is refused, and a wake seq only when a wake lands —
    // orders of magnitude below `lastActivityAt`'s per-dispatch churn, which is the rate the
    // quantizer exists for. Bucketing `turns` to 10 would also destroy the field: the difference
    // between 1 turn and 4 IS the signal.
    // ⚠ `tokensDelta` TAKES `tokensSpent`'S OWN BUCKET, so the two move together. A delta
    // quantized more finely than the total it is derived from would move on drift the total
    // cannot show, which is a digest that ticks for a number no reader can see change.
    // ⚠ `stale` IS A BOOLEAN AND IS DELIBERATELY IN THE CHURN HALF (`STATE_FIELDS` below does
    // NOT list it). It is derived from a WALL CLOCK, so putting it in the state half would let it
    // flip a set past the cadence floor on a timer — the exact "digest gate stops gating" defect
    // this whole module exists to prevent. Floored, it lands on the session's next real move,
    // which is at most ten seconds late for a fact that took ten minutes to become true.
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
// ⚠ THIS LIST IS THE FLOOR'S WHOLE DEFINITION OF "A STATE CHANGE", so it is a literal rather
// than "the row minus the eight". A field added to `reportRow` must be classified DELIBERATELY:
// defaulting a new field into the state half makes it bypass the floor forever, and defaulting
// it into the churn half can silently delay something a peer's card is about.
//
// EVERY MEMBER IS A FACT ABOUT WHICH SESSION THIS IS OR WHAT IT IS DOING AT THE COARSE
// GRAIN — the vocabulary that existed before this wave, which is exactly the set the
// state-change-only contract was written about.
// ⚠ `templateName` JOINED 2026-08-22 AND THE CLASSIFICATION IS DELIBERATE, per this block's
// own instruction. It is a fact about WHICH SESSION THIS IS — the identity the operator
// configured this agent to wear — so it belongs here and not in the churn half. Putting it
// in the state half means a change pushes IMMEDIATELY, past the cadence floor, and that is
// free: `context.template` is a SPAWN-TIME capture that is never re-resolved, so the value
// can move at most once per session, at its first push.
const STATE_FIELDS = [
  'sessionKey', 'channelId', 'threadId', 'name', 'state', 'channelName', 'threadTitle',
  'templateName',
];

/** One stable string over the STATE half of a whole row set. ⚠ SET MEMBERSHIP IS PART OF IT:
 *  a session appearing or leaving changes this string even when every surviving row's state is
 *  identical, which is what makes an arrival and the replace-protocol's delete-by-omission both
 *  count as state changes. */
function stateDigest(rows) {
  return JSON.stringify((rows || []).map((row) => STATE_FIELDS.map((f) => (row || {})[f])));
}

/**
 * MAY A CHURN-ONLY SET BE WRITTEN NOW? ⚠ It answers about the FLOOR alone — the caller has
 * already established that the set moved and that its state half did not.
 * `lastAt` is when this workspace last STORED a set, or null for "never", which is never
 * floored: the first write for a workspace is the one carrying its whole set.
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
  TEMPLATE_NAME_MAX, // 2026-08-22: the agent-template name's bound, on both ends
  // ⚠ THE DESKTOP'S ONE COPY OF THE SERVER'S SHORT-LABEL CHARSET, exported 2026-08-22 so
  // `template-resolve.js` can VALIDATE renderer-supplied launch overrides against it (F-281:
  // `@/shared/lib/safe-label` imports zod, so no renderer surface can reach `SAFE_LABEL_RE` and
  // MAIN is the only real validator). It lives here because this is where it already was, and
  // "two copies of a neutralizer drift, and the copy that drifts is the one that stops
  // neutralizing" is that module's own rule about exactly this.
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
