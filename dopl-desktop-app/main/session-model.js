// session-model.js — WHICH MODEL A SESSION RUNS ON, and HOW FULL ITS CONTEXT WINDOW IS.
//
// TWO FEATURES, ONE TABLE, which is why they share a file: the per-session model PICKER (a
// frozen enum that ends up as child argv) and the CONTEXT METER (a frozen map from the model
// the SDK reports back to that model's window size). Both are answers about the same closed
// set of models, and keeping them in two files would have meant two lists to drift apart.
//
// SECURITY — THE ENUM IS ARGV. `options.model` is handed to the SDK, which passes it to the
// bundled `claude` binary as `--model <value>`. So nothing here sanitizes a free string: it
// COERCES to a member of a frozen list, exactly like channel-prefs.normalizePreset does for
// the two posture axes, and anything unknown lands on 'default' — which sets NO `model` option
// at all, i.e. the CLI's own pick, which is what every session did before this existed. Fail
// closed at EVERY boundary: the preload coerced, session-ipc coerced (both deleted), the durable record
// coerces on write, session-engine coerces what a spec hands in, and buildSdkOptions coerces
// once more at the last step before a child process can see it.
//
// WHERE THE VALUES COME FROM. Both tables were read off the BUNDLED CLI
// (@anthropic-ai/claude-agent-sdk-darwin-arm64, SDK 0.3.220), never from memory:
//   ALIASES  `claude --help` documents --model as "an alias for the latest model (e.g.
//            'fable', 'opus', or 'sonnet') or a model's full name", and the binary's own
//            alias table resolves opus -> claude-opus-5, sonnet -> claude-sonnet-5,
//            haiku -> claude-haiku-4-5, fable -> claude-fable-5. The picker stores the ALIAS
//            rather than a dated id precisely because an alias is version-stable: a shipped
//            desktop build does not go stale the week a new model lands.
//   WINDOWS  the same binary carries a model registry with `context:{window:…}` per model.
//            Every row below is transcribed from it and says which one it is.
// A model this build has never heard of gets NO denominator, and the meter then shows raw
// tokens instead of a made-up percentage.
//
// ⚠ **AND SINCE 2026-09-22 THE TABLE IS THE FALLBACK, NOT THE ANSWER.** A runtime that REPORTS its
// own window on the wire (Codex: `tokenUsage.modelContextWindow`) beats it — see `› contextEvent`
// for the rule and the argument. Do not grow this table a row for a runtime that already answers;
// that is a maintenance debt taken on to duplicate a fact the platform states per turn.
//
// ⚠ **SINCE 2026-09-22 THE PICKER'S LIST IS LIVE, AND THESE TABLES ARE ITS FALLBACK.** This
// paragraph used to say `Query.supportedModels()` "needs a LIVE query … hence the frozen list".
// It does not need a TURN: `runtime/claude/roster.js` reads it off a CLI handshake with a prompt
// that never yields (MEASURED — zero messages, no API request). The live roster is what a picker
// offers and what a launch resolves against (`runtime/claude/models.js`); `MODEL_IDS` / `ID_TO_ALIAS`
// below answer only when that read FAILS, and they also name the legacy spellings an old record
// may still carry. ⚠ DO NOT ADD A ROW HERE FOR A NEW MODEL — the live roster already offers it.
//
// THE SENTINEL BLOCK below is PURE: no electron / fs / SDK / require reference inside it, so
// test/session-model.test.mjs slices it and evaluates it verbatim in a plain Node context (the
// WATCHER-PURE idiom). That is not decoration — it is the guarantee that the two frozen tables,
// which every other layer coerces against, cannot quietly grow a dependency on app state. The
// OBSERVER below the block is the imperative half: it takes the session object and a dispatch,
// holds no module state, and reaches only the shared diag logger.

// ⚠ **THIS MODULE REQUIRES NOTHING, AND THAT IS NOW LOAD-BEARING (2026-09-21, U5).** It carried
// `const { diag } = require('./diag')` from the days of the `› observe` watcher; that watcher left
// on 2026-08-31 and the import went unused, but `diag.js` requires `electron` at its top level, so
// the dead line made this file un-loadable outside an Electron main process. `main/runtime/
// claude/models.js` had to reach it through a LAZY `modelTable()` for exactly that reason, and the
// Claude descriptor could therefore not DECLARE its own model vocabulary — which is what forced
// every shared storage module to import this file's enums directly and validate a CODEX pick
// against them. Dropping one dead require is what let the ids move behind the adapter.
// ⚠ SO DO NOT ADD A REQUIRE HERE. If this file ever needs to log, hand the logger in.

// ─── BEGIN SESSION-MODEL (pure; unit-tested via source extraction) ───────────

// THE PICKER'S CLOSED SET. [0] is the fail-closed member, the same convention the two mode
// tables use ('manual' / 'ask'): 'default' asks for nothing and therefore risks nothing.
// ⚠ THIS IS THE ONLY COPY (re-measured 2026-08-22). It read "a renderer copy lives in
// session.html + session-preload.js and is pinned against this one" — both files were deleted
// with the session window on 2026-08-20 (F-228), and the four-copy agreement test that pinned
// them ended in the same change. `test/session-model.test.mjs § 2` states the surviving census
// and the rule to re-apply if a new surface ever offers this enum: a surface may only offer
// values main will spend, asserted by DRIVING each copy's coercion, never by grepping.
const MODEL_CHOICES = ['default', 'opus', 'sonnet', 'haiku', 'fable'];

// ── ⚠ THE SECOND VOCABULARY: FULL MODEL IDS (2026-08-22, Samuel's model-selection ruling) ────
//
// The ruling names the values the operator picks as FULL IDS, not aliases, and the SPA renders
// exactly those. This tree already had a frozen enum and it is ALIASES, for a reason its header
// states and that has not stopped being true: an alias is version-stable, so a shipped desktop
// build does not go stale the week a new model lands. Both are right about different things, so
// there are two lists and ONE of them reaches argv.
//
//   MODEL_IDS       what a UI offers and what the DURABLE per-channel posture stores. The
//                   operator's pick round-trips through the bridge unchanged, which is what lets
//                   a select show what it set.
//   MODEL_CHOICES   what becomes `--model <argv>`. Unchanged, still the last gate, still fails
//                   closed to 'default' (no `model` option at all — the CLI's own pick).
//
// ⚠ THE MAP IS THE SEAM AND IT IS DELIBERATELY LOSSY IN ONE PLACE: `claude-haiku-4-5-20251001` is
// a DATED id and resolves to the `haiku` alias, which the bundled CLI resolves to
// `claude-haiku-4-5`. That is the same model, and taking the alias is what keeps the argv
// version-stable — but it means the value that reaches the child is not byte-identical to the
// value the operator picked, and a future ruling that needs a pinned date has to change THIS
// line rather than discovering the difference in the field.
const MODEL_IDS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
];
const ID_TO_ALIAS = {
  'claude-fable-5': 'fable',
  'claude-opus-5': 'opus',
  'claude-sonnet-5': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
};

// A stored/picked model ID, or '' for "absent" — which means the SDK default, i.e. today's
// behaviour for every channel that has never chosen one. Fail-closed like every other coercion
// here: an unknown string is ABSENT, never passed through.
function normalizeModelId(value) {
  return MODEL_IDS.indexOf(value) === -1 ? '' : value;
}

// The argv-safe ALIAS for a picked id, or 'default' when nothing valid was picked.
function aliasForModelId(value) {
  const id = normalizeModelId(value);
  return id ? ID_TO_ALIAS[id] : MODEL_CHOICES[0];
}

// ⚠ IT ACCEPTS BOTH VOCABULARIES SINCE 2026-08-22, and still answers in exactly one. A caller
// holding a full id (the durable posture) and a caller holding an alias (the per-session picker)
// must not have to know which one the layer below wants — that is how a value reaches argv
// un-coerced. Everything unrecognised is still 'default'.
function normalizeModel(value) {
  if (MODEL_CHOICES.indexOf(value) !== -1) return value;
  return aliasForModelId(value);
}

/**
 * ONE LINK OF A LAUNCH'S MODEL PRECEDENCE CHAIN: the alias this value asks for, or `''` meaning
 * **the chain continues** (2026-08-23, F-285).
 *
 * ⚠ IT IS `normalizeModel` WITH ONE DIFFERENCE, AND THE DIFFERENCE IS THE WHOLE POINT.
 * `'default'` is not a pick — it is "the CLI's own", i.e. no opinion — so it must not END a chain
 * whose lower links may have one. Every launch lane spells its precedence as
 * `chainModel(a) || chainModel(b) || …`, so a link that names nothing this build knows steps
 * aside instead of silently spending the SDK default and discarding the rest. ⚠ F-5's old
 * corollary — "an unknown model FALLS BACK, never refuses" — is REVERSED (2026-09-22, below).
 * ⚠ IT LIVES HERE, NOT IN A LANE, because there are two lanes — the button
 * (`session-launch-op.js › templateModel`) and the directive (`launch-directives.js › spawn`) —
 * and a rule restated once per lane is a rule that drifts in one of them.
 */
// ⚠ **VOCABULARY-FREE SINCE 2026-09-22.** It answered `normalizeModel(value)` and so turned every
// id this build's frozen table did not know into `''` — the chain then FELL THROUGH to the next
// link and, at the bottom, to the product fallback: an MCP launch asking for a model this build
// predated (or mistyped) started Sonnet and echoed the id it was asked for. A link now answers
// the pick AS GIVEN, and the launch funnel resolves it on the live roster or REFUSES it with a
// sentence (`session-launch.js`, `runtime/model-catalog.js › modelRefusal`).
// ⚠ `'default'` STILL STEPS ASIDE — it is "no opinion", not a model — and so does absent.
function chainModel(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return !v || v === 'default' ? '' : v;
}

// ── ⚠ THE PRODUCT'S DEFAULT MODEL (2026-09-06, Samuel's back-fill ruling) ────────────────────
//
// ⚠ **IT IS THE DESKTOP'S HALF OF A PINNED TWIN.** The web declares the same id as
// `src/features/channels/lib/agent-models.ts › AGENT_MODEL_FALLBACK`, and the two trees cannot
// import each other — the exact situation `agent-models.ts › AGENT_MODEL_ALIASES` already
// restates `MODEL_CHOICES` / `ID_TO_ALIAS` for. `test/session-model.test.mjs` pins them against
// each other by READING the web file, so a change to one that misses the other fails rather than
// ships. Do not "simplify" either side to a literal at a call site.
//
// ⚠ **WHY IT EXISTS: A DROPDOWN MUST NOT NAME A MODEL THE LAUNCH WILL NOT PASS.** Samuel removed
// the "Default" option and ruled that every channel behaves as though set to a real model. The
// web half alone would have made the Settings row DISPLAY Sonnet while an unpicked channel still
// launched with no `--model` at all — a control stating a fact it does not cause. This is the
// launch half, so display and launch agree by construction.
//
// ⚠ **THIS IS A PRODUCT CHOICE, NOT A FACT ABOUT THE CLI.** "Default" never named a model; it
// meant no `--model` argument, i.e. whatever the bundled CLI picks, which nothing here knows and
// which can move without this tree shipping. So this pins a channel to Sonnet rather than to
// "whatever the CLI does today", and that cost was accepted explicitly.
const LAUNCH_MODEL_FALLBACK = 'claude-sonnet-5';

// The value that may become `--model <argv>`, or null for "set no model option at all".
// It re-normalizes rather than trusting its caller, because this is the last gate.
//
// ⚠ **`'default'` NOW RESOLVES TO THE PRODUCT FALLBACK RATHER THAN TO `null`** (2026-09-06). A
// chain that ended with no opinion used to spend the CLI's own pick; it spends Sonnet now.
//
// ⚠ THE `null` RETURN IS NOT DELETED, AND THAT IS DELIBERATE. It is still what a caller gets for
// a value that cannot resolve at all, and `buildSdkOptions` still reads it as "set no model
// option" — the shape that lets a runtime with no model concept launch. What changed is which
// INPUTS reach it, not what it means.
//
// ⚠ `chainModel` IS UNCHANGED AND MUST STAY UNCHANGED. It answers `''` for `'default'` so a link
// with no opinion STEPS ASIDE and the lower links get their turn (F-285). Resolving the fallback
// there instead would end every chain at its first link, so a channel's stored model could never
// beat a template's — the precedence order would silently invert.
function modelArg(value) {
  const choice = normalizeModel(value);
  return choice === 'default' ? aliasForModelId(LAUNCH_MODEL_FALLBACK) : choice;
}

// ── CONTEXT WINDOWS ─────────────────────────────────────────────────────────
const WINDOW_200K = 200000;
const WINDOW_1M = 1000000;

const CONTEXT_WINDOWS = {
  // The four aliases the picker offers, at whatever each one resolves to today. Keyed here as
  // well as by id so a meter has a denominator even before the first turn reports a real id.
  opus: WINDOW_1M, // -> claude-opus-5
  sonnet: WINDOW_1M, // -> claude-sonnet-5
  haiku: WINDOW_200K, // -> claude-haiku-4-5
  fable: WINDOW_1M, // -> claude-fable-5
  // The ids the SDK reports on system/init and per result.
  'claude-opus-5': WINDOW_1M, // registry: native_1m
  'claude-opus-4-8': WINDOW_1M, // registry: native_1m
  'claude-opus-4-7': WINDOW_1M, // registry: native_1m
  'claude-opus-4-6': WINDOW_200K, // 200k; 1M only via the [1m] suffix below
  'claude-opus-4-5': WINDOW_200K,
  'claude-opus-4-1': WINDOW_200K,
  'claude-opus-4': WINDOW_200K,
  'claude-opus-4-0': WINDOW_200K, // the CLI lists this spelling beside claude-opus-4
  'claude-sonnet-5': WINDOW_1M, // registry: native_1m
  'claude-sonnet-4-6': WINDOW_200K,
  'claude-sonnet-4-5': WINDOW_200K,
  'claude-sonnet-4': WINDOW_200K,
  'claude-sonnet-4-0': WINDOW_200K,
  'claude-haiku-4-5': WINDOW_200K,
  'claude-fable-5': WINDOW_1M, // registry: native_1m
  'claude-mythos-5': WINDOW_1M, // registry: native_1m
};

// The window size for a model id or alias, or null when this build cannot say.
function contextWindowFor(model) {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return null;
  // THE EXPLICIT LONG-CONTEXT VARIANT. The CLI marks the 200k models `supports_1m_suffix` and
  // ships ids like `claude-sonnet-4-6[1m]`; on those the suffix IS the window, so it is read
  // before the table rather than after it (the base row says 200k and would be wrong).
  if (id.slice(-4) === '[1m]') return WINDOW_1M;
  if (Object.prototype.hasOwnProperty.call(CONTEXT_WINDOWS, id)) return CONTEXT_WINDOWS[id];
  // A DATED id (`claude-opus-4-5-20251101`) is the same model as its undated row.
  const undated = id.replace(/-\d{8}$/, '');
  if (undated !== id && Object.prototype.hasOwnProperty.call(CONTEXT_WINDOWS, undated)) {
    return CONTEXT_WINDOWS[undated];
  }
  return null; // unknown model: no denominator, and never a guessed one
}

// HOW MUCH OF THE WINDOW A TURN LEFT OCCUPIED. It is the size of the prompt the model LAST
// saw: the uncached input, plus everything read back from cache, plus everything written to
// cache. Output tokens are deliberately NOT counted — they are what the model wrote, not what
// it read, and they only start occupying the window on the NEXT turn, where they arrive as
// input. Every field is coerced: a missing or junk usage block reads as 0, never as NaN.
function promptTokens(usage) {
  const u = usage || {};
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
  };
  return n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
}

// HOW MUCH THIS QUERY HAS SPENT IN TOTAL — every token billed, output included. This is the
// OTHER number, and it is deliberately a different function from `promptTokens` above: spend is
// what the run COST (so output counts, and it only ever climbs), occupancy is what the model
// last READ (so output does not count, and it falls after a compaction). Reading one off the
// other is the bug session-model's header spends a paragraph on.
//
// ⚠ ITS INPUT IS THE `result` EVENT'S `usage`, which the bundled CLI builds by summing its
// running per-model totals — i.e. the SESSION TOTAL FOR THIS QUERY, not this turn's. It
// therefore behaves exactly like `total_cost_usd` beside it: cumulative within a query, and
// RESTARTING FROM ZERO on a resumed one. The accumulation across resume cycles is
// session-io.js's, beside the identical cost arithmetic; this function only reads the block.
// Every field is coerced: a missing or junk usage block reads as 0, never as NaN.
function sessionTokens(usage) {
  const u = usage || {};
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
  };
  return (
    n(u.input_tokens) +
    n(u.output_tokens) +
    n(u.cache_read_input_tokens) +
    n(u.cache_creation_input_tokens)
  );
}

// The reducer event a finished turn produces, or null when there is nothing measured to say.
// Built here (rather than inline in the observer) so the shape is testable without a session.
//
// ── ⚠ THE PRECEDENCE RULE (2026-09-22): A SERVER-REPORTED WINDOW BEATS THIS FILE'S TABLE ─────
//
// `reportedWindow` is the denominator THE PLATFORM SAID IT IS METERING AGAINST, carried here from
// the runtime's own stream (`runtime/events.js › context.window`; Codex reads it off
// `tokenUsage.modelContextWindow`, MEASURED at 258400 on `codex-cli 0.155.1`). When it is present
// it WINS, and `contextWindowFor` is the fallback. The argument, in order:
//
//   1. THE SERVER'S NUMBER IS CURRENT BY CONSTRUCTION; THE TABLE IS CURRENT BY MAINTENANCE.
//      `CONTEXT_WINDOWS` above is a transcription of one bundled binary's model registry, frozen
//      the day this build shipped. Every model a vendor releases makes it a little more wrong, and
//      nothing in the running app can tell that it has gone stale. A number that arrives on the
//      wire each turn cannot go stale at all. This is why Codex rows were NOT added to the table:
//      that would buy one release's worth of correctness and owe an edit forever.
//   2. THE SERVER'S NUMBER IS THE ONE BEING ENFORCED. The window a platform meters against is not
//      purely a property of the model id — it moves with the account, the tier, and any per-thread
//      configuration. A denominator that disagrees with the one the platform will actually
//      compact against is worse than no denominator, because the operator's use for this gauge is
//      a DECISION ("do I start a fresh session") rather than a statistic.
//   3. THE TABLE STILL ANSWERS FOR EVERY RUNTIME THAT REPORTS NOTHING. The Claude lane reports no
//      window (`runtime/claude/normalize.js` calls `events.context` with two arguments), so it
//      lands on `contextWindowFor` exactly as it always did — this changes no Claude behaviour.
//
// ⚠ AND ABSENT IS NOT ZERO, ON BOTH ARMS. A `reportedWindow` that is missing, junk, or `0` falls
// THROUGH to the table rather than being spent as a window; an unknown model then yields `null`,
// which downstream renders as raw tokens with no percentage — never as "0 tokens available".
function contextEvent(tokens, model, reportedWindow) {
  if (!(tokens > 0)) return null;
  const reported = Number(reportedWindow);
  const window = Number.isFinite(reported) && reported > 0 ? reported : contextWindowFor(model);
  return { type: 'context', tokens: tokens, window: window, model: model || null };
}

// ─── END SESSION-MODEL ───────────────────────────────────────────────────────

// WHY NOT `result.usage`, which is right there on the same event the cost is read from: it is
// the SESSION TOTAL, not this turn's prompt. The bundled CLI builds it by summing its running
// per-model totals (`Object.values(modelUsage)` reduced over inputTokens / cacheReadInputTokens
// / cacheCreationInputTokens), so `input_tokens` there climbs monotonically for the whole run.
// A context gauge fed from it would only ever go up, would sail past 100%, and would never
// correct after an auto-compaction — the exact opposite of what the operator needs it for.
//
// The LAST assistant message of a turn carries the usage of the LAST API request, and that IS
// the prompt the model just saw.
//
// ⚠ THE WATCHER THAT READ THAT RAW STREAM — `› observe` — LEFT ON 2026-08-31 (runtime-adapter
// port, step 4). It was a SECOND normalizer: it parsed the platform's own message schema
// directly (`system`/`init`, the subagent-attribution field, the per-message `usage` block, the
// mid-session model switch) and sat in the consume loop beside the render mapping. A boundary
// that owned only the render mapping would have left it in core to fail the vocabulary scan, and
// would have left the golden fixtures covering a third of the surface.
//
// SO THE SPLIT IS: the ADAPTER extracts the numbers per message and reports them
// (`main/runtime/claude/normalize.js` -> a `context` CoreEvent), and CORE remembers the last one
// and turns it into the reducer's event when the turn ends (`session-io.js › applyCoreEvents`).
// Both halves of the rule that made this file's header worth writing survive intact: a
// SUBAGENT's message never meters, because a delegated run has its own window; and a turn that
// measured nothing says nothing rather than painting a zero (`› contextEvent` below).

module.exports = {
  MODEL_CHOICES,
  MODEL_IDS, // 2026-08-22: what a UI offers and the durable posture stores
  normalizeModelId,
  aliasForModelId,
  normalizeModel,
  chainModel, // 2026-08-23: one link of a launch's model precedence chain ('' = keep going)
  modelArg,
  // 2026-09-06 (Samuel's back-fill ruling): the PRODUCT's default model — the desktop half of a
  // twin the web declares as `AGENT_MODEL_FALLBACK`. Exported so the pin test can read it;
  // nothing else should, because `modelArg` is where it is spent.
  LAUNCH_MODEL_FALLBACK,
  contextWindowFor,
  promptTokens,
  sessionTokens,
  contextEvent,
};
