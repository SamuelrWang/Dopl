// The one assembly point for every Grok spawn (fresh, resumed, post-sign-in), so the deny list, the hook, the
// private home + Dopl's config files, the session mode and the env scrub hold on all.

const client = require('./client');
const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const configHome = require('./config-home');
const policy = require('./policy');
const models = require('./models');
const resolveBin = require('./resolve-bin');
const mcp = require('./mcp');
const normalizer = require('./normalize');
const { handleFor, cancelTurn } = require('./launch-handle');
const { makeFrameQueue } = require('../kit/frame-queue');
const kitUsage = require('../kit/usage');
const channelDirs = require('../../channel-dirs');
const store = require('../../session-store');
const sessionCredential = require('../../session-credential');
const sessionDirected = require('../../session-directed');
const capability = require('../capability');
const { diag } = require('../../diag');

// ── ENVIRONMENT ──────────────────────────────────────────────────────────────────────────────
// The scrub (every inherited credential, every GROK_/XAI_ knob) is `config-home.js › buildScrubbedEnv`.
const buildScrubbedEnv = configHome.buildScrubbedEnv;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' ? v : '');

// ── EFFORT ───────────────────────────────────────────────────────────────────────────────────
// Sent only when the launched model offers it on a vouching catalog (each model lists its own
// `reasoningEfforts`); otherwise dropped (Grok runs the model's default) and recorded as drift.
function effortFor(s) {
  const asked = s && s.dimensions && typeof s.dimensions[models.DIMENSION] === 'string' ? s.dimensions[models.DIMENSION].trim() : '';
  if (!asked) return '';
  let offered = {};
  try {
    const catalogs = require('../model-catalog');
    offered = catalogs.offeredDimensions(catalogs.peek('grok'), s.model || '', { [models.DIMENSION]: asked });
  } catch (_) { offered = {}; }
  if (offered[models.DIMENSION] === asked) return asked;
  require('../sdk-shape').recordDrift('grok', 'effort', `"${asked}" could not be confirmed against this model; not sent`);
  return '';
}

// ── SPEC ─────────────────────────────────────────────────────────────────────────────────────

/** `{ session, dispatch }` → the opaque payload core hands back to `start` / `resume` unread. */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  const st = (s && s.state) || {};
  const toolMode = tools.normalizeToolMode(st.toolMode);
  // No token, no Dopl server (the session still launches): an entry that 401s looks like a live path.
  const server = mcp.buildDoplServerEntry({
    profile: s.profile, toolSet: s.doplToolSet, workspaceId: s.workspaceId,
    bearer: sessionCredential.sessionBearer(s), slotKey: store.slotKey(s),
  });
  return {
    session: s,
    dispatch: req.dispatch,
    prompt: s.pushIterator,
    args: client.agentArgs(),
    cfg: tools.buildSessionToolConfig(s.profile),
    sessionMeta: policy.sessionMeta(toolMode),
    mcpServers: server ? [server] : [],
    model: typeof s.model === 'string' ? s.model.trim() : '',
    effort: effortFor(s),
    env: buildScrubbedEnv(),
    cwd: channelDirs.sessionSpawnDir(s.channelId),
    resumeSessionId: s.resumeSdkId || null,
  };
}

/** The gate as the approval driver asks it: core's held callback, `{ behavior, message }`. */
function gateFor(s, dispatch) {
  return axisB.makeCanUseTool(s, dispatch, diag);
}

/** `availableModels[]._meta.totalContextTokens` by id (the SIGNED-IN roster's — 256k on 2026-10-13). */
function windowsFrom(roster, into) {
  const map = into || new Map();
  for (const row of Array.isArray(obj(roster).availableModels) ? roster.availableModels : []) {
    const n = obj(obj(row)._meta).totalContextTokens;
    if (str(row.modelId) && typeof n === 'number' && n > 0) map.set(row.modelId, n);
  }
  return map;
}

// Start a run. Synchronous by contract (two-children bug). Boot: spawn, `initialize` (no `authenticate`,
// ever — `client.js › cachedTokenOffered`), `session/new|load` with Dopl's MCP entry and `_meta`, then the
// model (and effort) per session, each read back. A push while a turn runs is a STEER (`_x.ai/interject`,
// LIVE: applied inside the running turn); otherwise it is the next `session/prompt`.
function start(spec) {
  const s = spec.session;
  const frames = makeFrameQueue();
  const log = typeof spec.log === 'function' ? spec.log : diag;
  // `pending` = OUR `session/prompt` requests in flight (Grok QUEUES a prompt sent mid-turn — LIVE); `foreign`
  // = a turn Grok started itself: an interjection that lands after a turn ended runs as its own
  // `interject-fallback-…` turn with no request of ours (LIVE, 2026-10-13 live tier). `replaying` = between
  // `session/load` and its answer, when Grok replays the whole history (LIVE — the old "OK" came back).
  const link = {
    conn: null, closed: false, interruptPending: false, pending: 0, foreign: false, replaying: false,
    turnDone: Promise.resolve(), sessionId: spec.resumeSessionId || null, driver: null,
    busy() { return this.pending > 0 || this.foreign; },
  };
  const t = { model: null, windows: new Map(), total: null, msg: '', thought: '', names: new Map(), endForeign: null };
  // The session's running total is Dopl's own sum of per-prompt totals; a prompt with no usage carries it.
  const usageCarry = kitUsage.makeUsageCarry();

  const driver = approval.makeApprovalDriver({
    gate: typeof spec.gate === 'function' ? spec.gate : gateFor(s, spec.dispatch),
    cfg: spec.cfg || tools.buildSessionToolConfig(s && s.profile),
    onUnknown: (method) => frames.push({ method: normalizer.UNKNOWN_REQUEST, params: { method } }),
    log,
  });
  link.driver = driver;

  const flushThought = () => { if (t.thought) { frames.push({ method: normalizer.THOUGHT, params: { text: t.thought } }); t.thought = ''; } };
  const flushMessage = () => { if (t.msg) { frames.push({ method: normalizer.MESSAGE, params: { text: t.msg } }); t.msg = ''; } };
  const flush = () => { flushThought(); flushMessage(); };
  const unsafe = (text) => {
    if (link.closed) return;
    frames.push({ method: normalizer.UNSAFE, params: { text } });
  };
  const CONTENT = ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'];

  /** One finished turn → the prompt-result frame (usage from OUR request's answer; a foreign turn carries). */
  function pushResult(result) {
    const meta = obj(obj(result)._meta);
    const per = normalizer.tokensFrom(meta.usage);
    if (per.session !== null) {
      t.total = (t.total || 0) + per.session;
      usageCarry.observe({ totalTokens: t.total });
    }
    const model = str(meta.modelId) || t.model;
    frames.push({ method: normalizer.PROMPT_RESULT, params: {
      stopReason: str(obj(result).stopReason), cancellationCategory: str(meta.cancellationCategory) || null,
      cumulative: usageCarry.forTurn(per.session !== null ? { totalTokens: t.total } : null),
      usageUnread: !!meta.usage && per.session === null,
      contextUsed: meta.totalTokens, contextWindow: t.windows.get(model) || null, model,
    } });
  }

  function beginForeign() {
    link.foreign = true;
    link.turnDone = new Promise((r) => { t.endForeign = r; });
  }
  function endForeign(params) {
    link.foreign = false;
    if (t.endForeign) { t.endForeign(); t.endForeign = null; }
    if (link.pending > 0) return; // our queued prompt's answer closes the render
    flush();
    driver.endTurn();
    if (!link.closed) pushResult({ stopReason: str(params.stopReason) });
  }

  const onNotification = (msg) => {
    const method = str(msg && msg.method);
    const params = obj(msg && msg.params);
    if (method === 'session/update') {
      if (link.replaying) return;
      const u = obj(params.update);
      const kind = str(u.sessionUpdate);
      if (CONTENT.indexOf(kind) !== -1 && !link.busy()) beginForeign();
      const text = str(obj(u.content).text);
      if (kind === 'agent_message_chunk') { flushThought(); t.msg += text; return; }
      if (kind === 'agent_thought_chunk') { flushMessage(); t.thought += text; return; }
      if (kind === 'tool_call' || kind === 'tool_call_update') flush();
      if (kind === 'tool_call') { const call = normalizer.toolCallOf(u); if (call.id) t.names.set(call.id, call.name); }
      if (kind === 'tool_call_update' && u.status === 'completed' && driver.wasUnasked(str(u.toolCallId))) {
        frames.push({ method: normalizer.UNASKED, params: { tool: t.names.get(str(u.toolCallId)) || '' } });
      }
      frames.push(msg);
      return;
    }
    // OUR prompt ends with its request's answer; a turn Grok started itself ends here.
    if (method === '_x.ai/session/prompt_complete') { if (link.foreign) endForeign(params); return; }
    if (method === '_x.ai/sessions/changed') {
      const why = policy.yoloReported(params, link.sessionId);
      if (why) unsafe(why);
      return;
    }
    if (method === '_x.ai/session_notification') {
      const u = obj(params.update);
      if (u.sessionUpdate === 'model_changed' && str(u.model_id)) t.model = u.model_id;
      return;
    }
    if (method === '_x.ai/models/update') { windowsFrom(params, t.windows); return; }
    frames.push(msg);
  };

  function endPrompt(result, err) {
    link.pending = Math.max(0, link.pending - 1);
    flush();
    if (!link.busy()) driver.endTurn();
    if (link.closed) return;
    if (err) {
      frames.push({ method: normalizer.PROMPT_FAILED, params: {
        message: str(err && err.message), code: err && err.code, cumulative: usageCarry.forTurn(null), model: t.model,
      } });
      return;
    }
    pushResult(result);
  }

  function runPrompt(text) {
    link.pending += 1;
    let done;
    link.turnDone = new Promise((r) => { done = r; });
    link.conn.request('session/prompt', { sessionId: link.sessionId, prompt: [{ type: 'text', text }] })
      .then((r) => endPrompt(r, null), (err) => endPrompt(null, err))
      .finally(done);
  }

  // A steer. `queued` is final: Grok folds the text into the running turn, or — when the turn ended meanwhile
  // — runs it as a turn of its own (LIVE); re-sending it would run it twice. Only a refused interject becomes
  // a prompt (which Grok queues behind the running turn).
  async function steer(text) {
    let status = '';
    try {
      const r = obj(await link.conn.request('_x.ai/interject', { sessionId: link.sessionId, text }));
      status = str(obj(r.result).status) || str(r.status);
    } catch (err) {
      log('grok: interject refused —', (err && err.message) || err);
    }
    if (status === 'queued') sessionDirected.steerJoined(s, text);
    else runPrompt(text);
  }

  let env;
  try {
    env = configHome.isolatedEnv(spec.env);
  } catch (err) {
    frames.fail(err);
    return handleFor(link, frames, t);
  }

  (async () => {
    // ONE binary for the whole launch; a test or a verified caller may pin it (`spec.bin`).
    const found = spec.bin ? { ok: true, path: spec.bin } : resolveBin.resolveGrokBin();
    if (!found.ok) throw new Error(found.reason);
    if (link.closed) return;
    const conn = client.connect({
      bin: found.path, args: spec.args, env, cwd: spec.cwd, log, onNotification,
      onServerRequest: (msg) => driver.onServerRequest(msg),
      onExit: (code, signal, spawnError) => { if (!link.closed) frames.fail(spawnError || new Error(`grok agent exited (code ${code}, signal ${signal})`)); },
    });
    link.conn = conn;
    const init = await client.handshake(conn, appVersion());
    if (!client.cachedTokenOffered(init)) {
      frames.push({ method: normalizer.AUTH_REQUIRED, params: { text: 'Grok is not signed in for Dopl (no cached sign-in offered).' } });
      return;
    }
    const base = { cwd: spec.cwd, mcpServers: spec.mcpServers || [], _meta: spec.sessionMeta || policy.sessionMeta() };
    let result;
    if (spec.resumeSessionId) {
      link.replaying = true;
      try { result = obj(await conn.request('session/load', Object.assign({ sessionId: spec.resumeSessionId }, base))); } finally { link.replaying = false; }
    } else {
      result = obj(await conn.request('session/new', base));
    }
    link.sessionId = str(result.sessionId) || spec.resumeSessionId || null;
    if (!link.sessionId) throw new Error('Grok started a session with no id');
    windowsFrom(result.models, t.windows);
    t.model = str(obj(result.models).currentModelId) || policy.optionValue(result.configOptions, 'model');
    // The model is per SESSION (`-m` is ignored by `grok agent`, LIVE) and read back off the echo.
    if (spec.model && spec.model !== t.model) {
      const r = obj(await conn.request('session/set_config_option', { sessionId: link.sessionId, configId: 'model', value: spec.model }));
      policy.assertOptionTook(r.configOptions, 'model', spec.model, 'model');
      t.model = spec.model;
    }
    if (spec.effort) {
      // Plain string (LIVE: `{ value: "low" }` is -32602). Effort is not a restriction: a refusal is drift.
      try {
        const r = obj(await conn.request('session/set_config_option', { sessionId: link.sessionId, configId: 'reasoning_effort', value: spec.effort }));
        policy.assertOptionTook(r.configOptions, 'reasoning_effort', spec.effort, 'reasoning effort');
      } catch (err) {
        require('../sdk-shape').recordDrift('grok', 'effort', `"${spec.effort}" not applied: ${(err && err.message) || err}`);
      }
    }
    frames.push({ method: normalizer.SESSION_STARTED, params: { sessionId: link.sessionId, model: t.model } });
    for await (const m of spec.prompt) {
      if (link.closed) return;
      const text = String((m && m.message && m.message.content) || '');
      if (!text) continue;
      if (link.busy()) await steer(text);
      else runPrompt(text);
      // A Stop that arrived before the child could take it stops the turn it was meant for.
      if (link.interruptPending) { link.interruptPending = false; void cancelTurn(link); }
    }
  })().catch((err) => {
    if (link.closed) return;
    // `-32000 "Authentication required"` (LIVE) is the auth hold, never a crash — and never self-healed by
    // an `authenticate` call.
    if (err && err.code === normalizer.AUTH_CODE) {
      frames.push({ method: normalizer.AUTH_REQUIRED, params: { text: str(err.message) } });
      return;
    }
    frames.fail(err);
  });

  return handleFor(link, frames, t);
}

/** Resume a parked session: `session/load` after a restart (LIVE). Usage restarts per process
 *  (`usageResetsOnResume: true`), so core zeroes the baseline (`capability.js › canResume`). */
function resume(spec, _priorHandle) {
  const descriptor = require('./index').descriptor;
  if (!capability.canResume(descriptor)) {
    throw new Error(capability.resumeRefusal(descriptor) || 'this runtime cannot resume a conversation');
  }
  return start(spec);
}

const appVersion = () => require('../../app-version').appVersion();

module.exports = { buildLaunchSpec, start, resume, buildScrubbedEnv, effortFor, windowsFrom };
