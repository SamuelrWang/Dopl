// THE LAUNCH SHAPE — the one assembly point for every spawn on this runtime. The pins:
//   restricted profiles pin the sandbox (containment is not the operator's to widen);
//   `disallowedTools` — the deny list, where deny beats allow, is what stops the operator's own
//     `~/.cursor/cli-config.json` widening a Dopl session (it cannot stop it narrowing);
//   no `mcpServers` (Dopl's surface is `customTools`), and `agents: {}` (no declared subagents).
// Not pinnable here: the SDK runs IN this process (no child env to scrub), there is no config
// isolation, and no documented run-mode field — so the deny list and the sandbox are the whole of
// this runtime's containment.

const client = require('./client');
const tools = require('./tools');
const axisB = require('./axis-b');
const mcp = require('./mcp');
const normalizer = require('./normalize');
const channelDirs = require('../../channel-dirs');
const store = require('../../session-store');
const sessionCredential = require('../../session-credential');
const capability = require('../capability');
const { diag } = require('../../diag');

// Cursor's own default for a `full` session with no sandbox pick.
const SANDBOX_DEFAULT = true;

function nativePair(s, cfg) {
  // A restricted profile pins both values.
  if (cfg.native) return { runMode: cfg.native.runMode, sandbox: cfg.native.sandbox };
  const st = (s && s.state) || {};
  const sandbox = typeof st.sandboxEnabled === 'boolean' ? st.sandboxEnabled : SANDBOX_DEFAULT;
  return { runMode: tools.normalizeToolMode(st.toolMode), sandbox };
}

const appVersion = () => require('../../app-version').appVersion();

function userDataDir() {
  try { return require('electron').app.getPath('userData'); } catch (_) { return ''; }
}

/** The opaque launch payload core hands back to `start` / `resume` (a turn here is a CALL,
 *  `agent.send()`); the engine's dispatch rides it so this module never requires the engine. */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  const cfg = tools.buildSessionToolConfig(s.profile);
  const pair = nativePair(s, cfg);
  const wiring = mcp.buildWiring(s.workspaceId, sessionCredential.sessionBearer(s), store.slotKey(s));
  // The credential-path rules join here, not in the table: they read userData, known only at launch.
  const deny = cfg.disallowedTools.concat(tools.buildSecretPathDenyRules(userDataDir()));

  const options = {
    // The per-channel folder (else ~/Downloads): context, not a fence — the sandbox is the fence.
    local: { cwd: channelDirs.sessionSpawnDir(s.channelId), sandboxOptions: { enabled: pair.sandbox } },
    disallowedTools: deny.slice(),
    // No declared subagents: the only documented delegation deny here (unproven).
    agents: {},
  };
  const model = typeof s.model === 'string' ? s.model.trim() : '';
  // No model means no field: the platform's own pick.
  if (model) options.model = model;

  return {
    session: s,
    dispatch: req.dispatch,
    prompt: s.pushIterator,
    options,
    // Carried, not written into `options`: the SDK field for a run mode is undocumented.
    runMode: pair.runMode,
    policy: cfg.doplToolsPolicy,
    deny: deny.slice(),
    wiring,
    resumeAgentId: s.resumeSdkId || null,
    model,
  };
}

// The handle is built and returned SYNCHRONOUSLY (the two-children bug): an async generator runs no
// body until the consume loop asks for the first frame.

/** Every raw frame this run produces, with two synthetic ones spliced in: the agent handle (the
 *  RESULT of `Agent.create()`) and each turn's usage (off the finished `run`) — neither is a stream event. */
async function* frames(spec, live) {
  let agent = null;
  try {
    const custom = await axisB.axisBTools({
      session: spec.session,
      dispatch: spec.dispatch,
      log: diag,
      policy: spec.policy,
      deny: spec.deny,
      // No wiring, no Dopl surface — the session still launches (a surface that 401s would lie).
      list: spec.wiring.usable ? () => spec.conn.list() : null,
      call: spec.wiring.usable ? (name, args) => spec.conn.call(name, args) : null,
    });
    const options = Object.assign({}, spec.options);
    options.local = Object.assign({}, options.local, { customTools: custom || [] });
    agent = spec.resumeAgentId
      ? await client.resumeAgent(spec.resumeAgentId, options)
      : await client.createAgent(options);
    live.agent = agent;
    yield {
      type: normalizer.AGENT_CREATED,
      agentId: (agent && (agent.id || agent.agentId)) || spec.resumeAgentId || null,
      // `agent.model` is undefined after a resume, so the session's own pick stands in.
      model: (agent && agent.model) || spec.model || null,
    };

    // One push, one run: there is no documented mid-run steer, so a later push is a new run.
    for await (const m of spec.prompt) {
      const text = String((m && m.message && m.message.content) || '');
      if (!text) continue;
      const run = await agent.send(text);
      for await (const ev of run.stream()) {
        // Logged, not rendered: the platform awaits an approval nothing can answer (a stalled turn).
        if (ev && ev.type === 'request') {
          diag('cursor: the runtime is awaiting its own approval and there is no responder API —',
            'request', String((ev.request_id || ev.requestId || '')).slice(0, 24),
            '(§5 X1; the windowless floor is what normally prevents this)');
        }
        yield ev;
      }
      yield await turnFrame(agent, run, spec);
    }
  } catch (err) {
    // The rejection goes through the normalizer, which decides what "no credential" looks like.
    yield { type: normalizer.ERROR_MESSAGE_TYPE, text: (err && err.message) || String(err) };
  }
}

/** The turn's token usage, as one synthetic frame. */
async function turnFrame(agent, run, spec) {
  let usage = null;
  try { usage = (run && run.usage) || null; } catch (_) { usage = null; }
  return { type: normalizer.TURN_COMPLETED, usage, model: (agent && agent.model) || spec.model || null };
}

/** Start a run. Synchronous by contract. */
function start(spec) {
  const live = { agent: null };
  spec.conn = spec.wiring.usable ? mcp.connect(spec.wiring, appVersion()) : null;
  const iter = frames(spec, live);
  return {
    [Symbol.asyncIterator]() { return iter; },
    next() { return iter.next(); },
    /** No interrupt exists on this runtime (the ship gate): log it rather than no-op silently
     *  (`abandon_timeout` also fires this). The tool surface stays open — that latch is `close()`'s. */
    interrupt() {
      diag('cursor: interrupt requested and this runtime exposes none (§5 X0) —',
        'the turn continues on the runtime\'s side; Dopl is not able to stop a session it started');
      return Promise.resolve();
    },
    /** Closes the latch so every in-process Dopl tool refuses; it does not stop the run itself. */
    close() {
      axisB.closeSession(spec.session);
      try { if (live.agent && typeof live.agent[Symbol.asyncDispose] === 'function') live.agent[Symbol.asyncDispose](); } catch (_) { /* best effort */ }
      try { iter.return(); } catch (_) { /* best effort */ }
    },
  };
}

/** Resume a parked conversation — refused while `usageResetsOnResume` is unmeasured; the adapter
 *  asks `capability.canResume` rather than restating it. A cold launch is unaffected. */
function resume(spec, _priorHandle) {
  const descriptor = require('./index').descriptor;
  if (!capability.canResume(descriptor)) {
    throw new Error(capability.resumeRefusal(descriptor) || 'this runtime cannot resume a conversation');
  }
  return start(spec);
}

module.exports = {
  buildLaunchSpec, start, resume, frames, nativePair,
};
