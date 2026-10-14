// The one assembly point for every Muse spawn (fresh, parked resume, post-sign-in), so the deny list, the
// host fences, the private home, the approval mode + permission profile and the env scrub hold on all.

const fs = require('fs');
const path = require('path');
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
const { handleFor } = require('./launch-handle');
const { makeFrameQueue, boundedInterrupt } = require('../kit/frame-queue');
const kitUsage = require('../kit/usage');
const channelDirs = require('../../channel-dirs');
const store = require('../../session-store');
const sessionCredential = require('../../session-credential');
const sessionDirected = require('../../session-directed');
const capability = require('../capability');
const { diag } = require('../../diag');

// ── ENVIRONMENT ──────────────────────────────────────────────────────────────────────────────
// The scrub (every inherited credential, every Muse/TBH/Meta knob) is `config-home.js › buildScrubbedEnv`.
const buildScrubbedEnv = configHome.buildScrubbedEnv;

// ── EFFORT ───────────────────────────────────────────────────────────────────────────────────
// Sent only when THIS build's schema lists the value (`shape.js › values`), else what the launched model
// offers on a vouching catalog; neither → dropped (the platform picks) and recorded as drift.
function effortFor(s) {
  const asked = s && s.dimensions && typeof s.dimensions[models.DIMENSION] === 'string' ? s.dimensions[models.DIMENSION].trim() : '';
  if (!asked) return '';
  const sdkShape = require('../sdk-shape');
  const declared = sdkShape.valuesFor('muse', 'turn/start reasoningEffort');
  if (Array.isArray(declared) && declared.length) {
    if (declared.indexOf(asked) !== -1) return asked;
    sdkShape.recordDrift('muse', 'effort', `"${asked}" is outside this build's own list (${declared.join(', ')}); not sent`);
    return '';
  }
  let offered = {};
  try {
    const catalogs = require('../model-catalog');
    offered = catalogs.offeredDimensions(catalogs.peek('muse'), s.model || '', { [models.DIMENSION]: asked });
  } catch (_) { offered = {}; }
  if (offered[models.DIMENSION] === asked) return asked;
  sdkShape.recordDrift('muse', 'effort', `"${asked}" could not be confirmed against this build or model; not sent`);
  return '';
}

// ── SPEC ─────────────────────────────────────────────────────────────────────────────────────

/** `{ session, dispatch }` → the opaque payload core hands back to `start` / `resume` unread. */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  const cfg = tools.buildSessionToolConfig(s.profile);
  const st = (s && s.state) || {};
  const pol = policy.sessionPolicy(st.toolMode, cfg);
  const cwd = channelDirs.sessionSpawnDir(s.channelId);
  const sessionStart = { approvalMode: pol.approvalMode, permissionProfile: pol.permissionProfile, workspaceRoot: cwd };
  const model = typeof s.model === 'string' ? s.model.trim() : '';
  if (model) sessionStart.modelId = model;
  // No token, no Dopl server (the session still launches): an entry that 401s looks like a live path.
  const server = mcp.buildDoplServerEntry({
    profile: s.profile, toolSet: s.doplToolSet, workspaceId: s.workspaceId,
    bearer: sessionCredential.sessionBearer(s), slotKey: store.slotKey(s),
  });
  if (server) sessionStart.config = { mcpServers: { [mcp.SERVER_KEY]: server } };
  const effort = effortFor(s);
  return {
    session: s,
    dispatch: req.dispatch,
    prompt: s.pushIterator,
    args: client.serveArgs({ provider: 'meta', flags: (cfg.native && cfg.native.serveFlags) || [] }),
    sessionStart,
    turnStart: effort ? { reasoningEffort: effort } : {},
    env: buildScrubbedEnv(),
    cwd,
    resumeSessionId: s.resumeSdkId || null,
  };
}

/** Do two absolute paths name the same folder? (`/var` vs `/private/var` on macOS.) */
function sameDir(a, b) {
  const real = (p) => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };
  return real(a) === real(b);
}

/** The gate as the approval driver asks it: core's `{ behavior }` verdict → `'allow' | 'deny'`. */
function gateFor(s, dispatch) {
  const held = axisB.makeCanUseTool(s, dispatch, diag);
  return async (name, input, meta) => {
    const verdict = await held(name, input, meta);
    return verdict && verdict.behavior === 'allow' ? 'allow' : 'deny';
  };
}

// Start a run. Synchronous by contract (two-children bug). Boot: spawn, `initialize` + `initialized`,
// `session/start|resume` read back (`policy.js`), then every push is ONE `turn/start` with `ifBusy:"steer"`:
// the host decides start vs steer vs queue, so a push racing a turn's end never hits `already_terminal`
// (measured on 1.4.7 for `turn/steer`).
function start(spec) {
  const s = spec.session;
  const frames = makeFrameQueue();
  const log = typeof spec.log === 'function' ? spec.log : diag;
  const link = { conn: null, closed: false, interruptPending: false, commandId: () => client.uuidv7() };
  let sessionId = spec.resumeSessionId || null;
  let activeTurnId = null;
  let model = null;
  let latestCumulative = null;
  let contextUsage = null;
  // `cumulative` is the SESSION's running total and never goes backward; a turn that saw no usage update
  // (an interrupt) carries the last one, so the baseline never resets to zero (`kit/usage.js`).
  const usageCarry = kitUsage.makeUsageCarry();

  const stopTurn = () => {
    if (link.conn && sessionId && activeTurnId) void boundedInterrupt(link.conn.request('turn/interrupt', { sessionId, turnId: activeTurnId, commandId: client.uuidv7() }));
  };
  const driver = approval.makeApprovalDriver({
    gate: typeof spec.gate === 'function' ? spec.gate : gateFor(s, spec.dispatch),
    request: (method, params) => link.conn.request(method, params),
    sessionId: () => sessionId,
    commandId: () => client.uuidv7(),
    onStuck: stopTurn,
    onUnknown: (method) => frames.push({ method: normalizer.UNKNOWN_REQUEST, params: { method } }),
    log,
  });

  const onNotification = (msg) => {
    if (driver.onNotification(msg)) { frames.push(msg); return; }
    const method = msg && msg.method;
    const params = (msg && msg.params && typeof msg.params === 'object') ? msg.params : {};
    if (method === 'session/tokenUsage') {
      latestCumulative = params.cumulative && typeof params.cumulative === 'object' ? params.cumulative : null;
      usageCarry.observe(latestCumulative);
      return;
    }
    if (method === 'session/contextUsage') { contextUsage = params; return; }
    if (method === 'session/modelChanged' && typeof params.modelId === 'string') model = params.modelId;
    if (method === 'turn/started' && params.turnId) activeTurnId = String(params.turnId);
    if (method === 'turn/completed') {
      frames.push(Object.assign({}, msg, {
        params: Object.assign({}, params, {
          cumulative: usageCarry.forTurn(latestCumulative),
          contextUsed: contextUsage ? contextUsage.usedTokens : null,
          contextWindow: contextUsage ? contextUsage.windowTokens : null,
          model,
        }),
      }));
      if (!params.turnId || String(params.turnId) === activeTurnId) activeTurnId = null;
      latestCumulative = null;
      return;
    }
    frames.push(msg);
  };

  let env;
  try {
    env = configHome.isolatedEnv(spec.env);
  } catch (err) {
    frames.fail(err);
    return handleFor(link, frames, () => sessionId, () => activeTurnId);
  }

  (async () => {
    // ONE binary for the whole launch; a test or a verified caller may pin it (`spec.bin`).
    const found = spec.bin ? { ok: true, path: spec.bin } : resolveBin.resolveMuseBin();
    if (!found.ok) throw new Error(found.reason);
    if (link.closed) return;
    const conn = client.connect({
      bin: found.path, args: spec.args, env, cwd: spec.cwd, log, onNotification,
      onServerRequest: (msg) => driver.onServerRequest(msg),
      onExit: (code, signal, spawnError) => frames.fail(spawnError || new Error(`muse serve exited (code ${code}, signal ${signal})`)),
    });
    link.conn = conn;
    const init = await client.handshake(conn, appVersion());
    const sent = Object.assign({}, spec.sessionStart || {});
    if (sent.config && !(Array.isArray(init.grantedCapabilities) && init.grantedCapabilities.includes('sessionMcp'))) {
      throw new Error('Muse did not grant per-session MCP servers (`sessionMcp`), so Dopl\'s tools cannot be attached — refusing the session.');
    }
    let result;
    if (spec.resumeSessionId) {
      result = await conn.request('session/resume', { commandId: client.uuidv7(), sessionId: spec.resumeSessionId, config: sent.config });
      // A resumed session keeps its stored mode: Dopl re-selects its own and reads the effective one back.
      const set = await conn.request('session/setApprovalMode', { commandId: client.uuidv7(), sessionId: spec.resumeSessionId, mode: sent.approvalMode });
      result = { session: Object.assign({}, result && result.session, { approvalMode: set && set.effectiveMode }) };
      delete sent.workspaceRoot; delete sent.modelId;
    } else {
      result = await conn.request('session/start', Object.assign({ commandId: client.uuidv7() }, sent));
    }
    // Every safety setting read back off the answer; anything Dopl cannot confirm refuses the run.
    policy.assertSessionTook(sent, result, sameDir);
    sessionId = String(result.session.sessionId || spec.resumeSessionId || '');
    if (!sessionId) throw new Error('Muse started a session with no id');
    model = result.session.modelId || null;
    frames.push({ method: normalizer.SESSION_STARTED, params: { sessionId, model } });
    for await (const m of spec.prompt) {
      const text = String((m && m.message && m.message.content) || '');
      if (!text) continue;
      const r = await conn.request('turn/start', Object.assign(
        { sessionId, commandId: client.uuidv7(), input: [{ type: 'text', text }], ifBusy: 'steer' }, spec.turnStart || {},
      ));
      if (r && r.disposition === 'steered') {
        // A steer joins the live turn (one `turn/completed` answers both); tell directed capture.
        sessionDirected.steerJoined(s, text);
      } else if (r && r.turnId && !activeTurnId && r.disposition === 'started') {
        activeTurnId = String(r.turnId);
      }
      if (link.interruptPending) { link.interruptPending = false; stopTurn(); }
    }
  })().catch((err) => frames.fail(err));

  return handleFor(link, frames, () => sessionId, () => activeTurnId);
}

/** Resume a parked session — REFUSED until `usageResetsOnResume` is measured (`capability.js › canResume`). */
function resume(spec, _priorHandle) {
  const descriptor = require('./index').descriptor;
  if (!capability.canResume(descriptor)) {
    throw new Error(capability.resumeRefusal(descriptor) || 'this runtime cannot resume a conversation');
  }
  return start(spec);
}

const appVersion = () => require('../../app-version').appVersion();

module.exports = { buildLaunchSpec, start, resume, buildScrubbedEnv, sameDir, effortFor };
