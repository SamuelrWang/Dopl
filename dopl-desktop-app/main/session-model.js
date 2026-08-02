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
// closed at EVERY boundary: the preload coerces, session-ipc coerces, the durable record
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
// Query.supportedModels() would answer both questions authoritatively, but it needs a LIVE
// query: the picker has to be usable on a pre-consent card, where by construction nothing is
// running yet. Hence the frozen list.
//
// THE SENTINEL BLOCK below is PURE: no electron / fs / SDK / require reference inside it, so
// test/session-model.test.mjs slices it and evaluates it verbatim in a plain Node context (the
// WATCHER-PURE idiom). That is not decoration — it is the guarantee that the two frozen tables,
// which every other layer coerces against, cannot quietly grow a dependency on app state. The
// OBSERVER below the block is the imperative half: it takes the session object and a dispatch,
// holds no module state, and reaches only the shared diag logger.

const { diag } = require('./diag');

// ─── BEGIN SESSION-MODEL (pure; unit-tested via source extraction) ───────────

// THE PICKER'S CLOSED SET. [0] is the fail-closed member, the same convention the two mode
// tables use ('manual' / 'ask'): 'default' asks for nothing and therefore risks nothing.
// A renderer copy lives in session.html + session-preload.js and is pinned against this one.
const MODEL_CHOICES = ['default', 'opus', 'sonnet', 'haiku', 'fable'];

function normalizeModel(value) {
  return MODEL_CHOICES.indexOf(value) === -1 ? MODEL_CHOICES[0] : value;
}

// The value that may become `--model <argv>`, or null for "set no model option at all".
// It re-normalizes rather than trusting its caller, because this is the last gate.
function modelArg(value) {
  const choice = normalizeModel(value);
  return choice === 'default' ? null : choice;
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

// The reducer event a finished turn produces, or null when there is nothing measured to say.
// Built here (rather than inline in the observer) so the shape is testable without a session.
function contextEvent(tokens, model) {
  if (!(tokens > 0)) return null;
  return { type: 'context', tokens: tokens, window: contextWindowFor(model), model: model || null };
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
// the prompt the model just saw. So this watches the raw stream in session-query's consume
// loop, remembers that number, and hands it to the reducer when the turn ends.
//
// A SUBAGENT's messages are skipped (`parent_tool_use_id` set): a Task runs in its own context
// window, so counting its prompt as the session's would make the meter jump and then snap back.
function observe(s, msg, dispatch) {
  if (!s || !msg) return;
  if (msg.type === 'system' && msg.subtype === 'init') {
    // The FIRST honest statement of which model is really running (the picker asked; the CLI
    // decides). It is also the denominator for the very first turn.
    if (typeof msg.model === 'string' && msg.model) s.liveModel = msg.model;
    return;
  }
  if (msg.type === 'assistant') {
    if (msg.parent_tool_use_id != null) return; // a subagent's own window, not this session's
    const m = msg.message || {};
    const tokens = promptTokens(m.usage);
    if (tokens > 0) s.promptTokens = tokens;
    if (typeof m.model === 'string' && m.model) s.liveModel = m.model; // mid-session switch
    return;
  }
  if (msg.type !== 'result' || typeof dispatch !== 'function') return;
  const event = contextEvent(s.promptTokens, s.liveModel);
  if (!event) return; // nothing measured this turn: say nothing rather than paint a zero
  try {
    dispatch(s, event);
  } catch (err) {
    diag('session-model: context dispatch failed', err && err.message);
  }
}

module.exports = {
  MODEL_CHOICES,
  normalizeModel,
  modelArg,
  CONTEXT_WINDOWS,
  contextWindowFor,
  promptTokens,
  contextEvent,
  observe,
};
