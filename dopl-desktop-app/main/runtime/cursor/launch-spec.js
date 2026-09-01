// THE LAUNCH SHAPE — ⚠ THE ONE ASSEMBLY POINT FOR EVERY SPAWN ON THIS RUNTIME.
//
// Fresh launch, recreated shell and post-sign-in relaunch ALL come through here, so the deny list,
// the sandbox pin, the in-process tool surface and the model coercion hold identically on all of
// them. That discipline is the other two lanes' and it ports verbatim; what changes is what there
// is to pin.
//
// ⚠ THE PINS THAT ARE NOT PREFERENCES ON THIS RUNTIME:
//   the RESTRICTED PROFILES PIN the sandbox.  `read_only` and `dopl_only` are CONTAINMENT: they
//                            set `local.sandboxOptions.enabled` themselves and the operator's
//                            Axis-A pick does not move them. `full`'s supervision IS Axis A plus
//                            the sandbox row, so there the operator's choice rides.
//   `disallowedTools`        the profile's deny list in this runtime's permission-string
//                            vocabulary, where DENY BEATS ALLOW — which is the only reason the
//                            operator's own `~/.cursor/cli-config.json` cannot widen a session
//                            Dopl launched (see the ambient-fence note below).
//   NO `mcpServers`          Dopl's surface is `customTools`, not a server; a third-party server
//                            would be the operator's, and the restricted profiles deny `Mcp(*)`.
//   `agents: {}`             no subagents are DECLARED, which is this runtime's only documented
//                            delegation lever (§5 item X11).
//
// ⚠ AND THREE THINGS THE OTHER LANES PIN THAT THIS ONE CANNOT, each stated rather than discovered:
//   1. NO SCRUBBED ENVIRONMENT, BECAUSE THERE IS NO CHILD PROCESS. The SDK runs IN THIS PROCESS
//      and reads `process.env` directly, so a "scrub" would mean mutating the app's own
//      environment — a global side effect, not a fence on one session.
//      `descriptor.ambientFences.envDeny` is therefore `[]` and says so. The research names no
//      permission-affecting environment variable for this runtime; §5 item X20 asks, and a
//      POSITIVE answer there is a real problem on this runtime rather than a line to add.
//   2. NO `--ignore-user-config` ANALOGUE. `codex app-server` takes a flag that skips the
//      operator's own config file; nothing in `cursor-research.md` gives this runtime one, and it
//      reads permission strings from `~/.cursor/cli-config.json`, `<project>/.cursor/cli.json`,
//      a team dashboard and up to four hook tiers. What stands in for the flag is that DENY BEATS
//      ALLOW: an operator's `permissions.allow` cannot open something this launch denied. It does
//      NOT stop their config DENYING more, which is a safe direction, and it does not reach the
//      hook tiers at all. §5 item X13.
//   3. NO RUN-MODE FIELD. The run modes are documented as a product setting and as CLI flags
//      (`-f/--force`); the SDK field that carries one is NOT named anywhere in the research, so
//      this launch WRITES NONE rather than inventing a key (§5 item X19). Until it is captured,
//      the operator's Axis-A pick governs DOPL's own gate — which is real, immediate and the half
//      that decides whether a message leaves the machine — while CURSOR's own autonomy sits at the
//      SDK's default. ⚠ THAT MAKES THE DENY LIST AND THE SANDBOX THE WHOLE OF THIS RUNTIME'S
//      CONTAINMENT, which is why `tools.js` writes both and why X14 (what vocabulary
//      `disallowedTools` reads) is design-changing rather than a field note.

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

// ⚠ CURSOR'S OWN DEFAULT, NAMED SO IT IS VISIBLE RATHER THAN INHERITED. The sandbox is a SEPARATE
// axis from the run mode on this runtime (`toolMode.secondaryAxis`), and a `full` session with no
// sandbox pick lands where a Cursor user expects. Reading it tolerantly here means wiring that
// control is a UI change and not a launch change.
const SANDBOX_DEFAULT = true;

function nativePair(s, cfg) {
  // A restricted profile PINS both values — containment is not the operator's to widen from the
  // mode picker, on any runtime.
  if (cfg.native) return { runMode: cfg.native.runMode, sandbox: cfg.native.sandbox };
  const st = (s && s.state) || {};
  const sandbox = typeof st.sandboxEnabled === 'boolean' ? st.sandboxEnabled : SANDBOX_DEFAULT;
  return { runMode: tools.normalizeToolMode(st.toolMode), sandbox };
}

function appVersion() {
  try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
}

function userDataDir() {
  try { return require('electron').app.getPath('userData'); } catch (_) { return ''; }
}

/**
 * The OPAQUE launch payload core hands straight back to `start` / `resume`.
 *
 * ⚠ CORE NEVER LOOKS INSIDE IT. The prompt rides along because on this runtime a turn is a CALL
 * (`agent.send()`) and on another it is a streamed iterable, and core must not hold that
 * difference.
 * ⚠ ONE ARGUMENT, CARRYING THE ENGINE'S TWO INJECTED HANDLES: the in-process tools need the
 * dispatch (to paint a card) and the replay-aware quiet emitter (to resolve one an auto-allowed
 * post painted), and this module must not require the engine back.
 */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  const cfg = tools.buildSessionToolConfig(s.profile);
  const pair = nativePair(s, cfg);
  const wiring = mcp.buildWiring(s.workspaceId, sessionCredential.sessionBearer(s), store.slotKey(s));
  // ⚠ THE PROFILE'S DENY LIST PLUS THE CREDENTIAL-PATH RULES, JOINED HERE AND NOT IN THE TABLE.
  // The rules read the app's own userData directory, which only exists at launch — see
  // `tools.js › buildSessionToolConfig`'s note for why keeping them out of the table is what stops
  // the descriptor describing containment the gate does not apply.
  const deny = cfg.disallowedTools.concat(tools.buildSecretPathDenyRules(userDataDir()));

  const options = {
    // Item 7: the per-channel folder (else ~/Downloads). CONTEXT, not a fence — the sandbox is the
    // fence. ⚠ Whether this runtime walks up from it to load `.cursorrules` is §5 item B2.
    local: { cwd: channelDirs.sessionSpawnDir(s.channelId), sandboxOptions: { enabled: pair.sandbox } },
    // ⚠ THE DENY LIST, WHICH IS MOST OF THIS RUNTIME'S CONTAINMENT. See the header's item 3.
    disallowedTools: deny.slice(),
    // ⚠ NO SUBAGENTS DECLARED. This runtime's subagents are the CLIENT's to define, so declaring
    // none is the only documented delegation deny there is — and it is not a PROVEN one (X11).
    agents: {},
  };
  const model = typeof s.model === 'string' ? s.model.trim() : '';
  // `''` (or anything the roster does not know) sets no field at all — the platform's own pick,
  // which is `descriptor.models.defaultMeansAbsent`.
  if (model) options.model = model;

  return {
    session: s,
    dispatch: req.dispatch,
    emitQuiet: req.emitQuiet,
    prompt: s.pushIterator,
    options,
    // ⚠ CARRIED AND DELIBERATELY NOT WRITTEN INTO `options` — header item 3. Kept on the spec so
    // the day X19 answers, wiring it is one line here and no change anywhere else.
    runMode: pair.runMode,
    policy: cfg.doplToolsPolicy,
    deny: deny.slice(),
    wiring,
    resumeAgentId: s.resumeSdkId || null,
    model,
  };
}

// ── THE HANDLE ───────────────────────────────────────────────────────────────────────────────
//
// ⚠ IT IS BUILT AND RETURNED SYNCHRONOUSLY: core assigns it to the session IMMEDIATELY, and an
// await between "the agent exists" and "something points at it" is the two-children bug — a second
// agent still holding this session's channel access with nothing left to stop it. An ASYNC
// GENERATOR is what makes that free here: calling it constructs the iterator and runs no body
// until the consume loop asks for the first frame.

/**
 * Every raw frame this run produces, in order, with the two synthetic ones spliced in.
 *
 * ⚠ THE SYNTHETIC FRAMES ARE WHY THIS IS A GENERATOR AND NOT `run.stream()` HANDED STRAIGHT BACK.
 * The agent handle arrives as the RESULT of `Agent.create()` and the turn's COST arrives from
 * `agent.getUsage()` — neither is a stream event, and a pure normalizer cannot go and fetch them.
 * See `normalize.js`'s header for why the cost one is load-bearing rather than tidy.
 */
async function* frames(spec, live) {
  let agent = null;
  try {
    const custom = await axisB.axisBTools({
      session: spec.session,
      dispatch: spec.dispatch,
      emitQuiet: spec.emitQuiet,
      log: diag,
      policy: spec.policy,
      deny: spec.deny,
      // ⚠ NO WIRING => NO DOPL SURFACE, AND THE SESSION STILL LAUNCHES. A half-built surface that
      // 401s on every call would tell the agent it HAS a delivery path and let it watch that path
      // fail. Pre-sign-in and a bare harness both land here.
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
      // ⚠ RE-STAMPED, BECAUSE `agent.model` IS `undefined` AFTER A RESUME UNLESS RESPECIFIED
      // (`models.reStampOnResume`). The session's own pick is the honest answer when the platform
      // reports none, and `''` stays absent rather than becoming a guessed id.
      model: (agent && agent.model) || spec.model || null,
    };

    // The prompt pump. ⚠ ONE PUSH, ONE RUN. `agent.send()` starts a run and `run.stream()` is that
    // run's events; there is no documented mid-run steer on this runtime (§5 item X0), so a later
    // push is a NEW run rather than an append. `session.steer` is `'unverified'` for exactly this.
    for await (const m of spec.prompt) {
      const text = String((m && m.message && m.message.content) || '');
      if (!text) continue;
      const run = await agent.send(text);
      for await (const ev of run.stream()) {
        // ⚠ LOGGED, NOT RENDERED. A `request` frame is this platform saying it is waiting for an
        // approval nobody can answer (§5 item X1); the normalizer emits nothing for it, and this
        // line is what makes a stalled turn diagnosable instead of mysterious.
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
    // ⚠ THE REJECTION COMES BACK THROUGH THE NORMALIZER, NOT THROUGH CORE. Core does not decide
    // which failures mean "no credential"; it hands the text over and reads the answer.
    yield { type: normalizer.ERROR_MESSAGE_TYPE, text: (err && err.message) || String(err) };
  }
}

/** The turn's usage AND its cost, as one synthetic frame. */
async function turnFrame(agent, run, spec) {
  let usage = null;
  let cost = null;
  try { usage = (run && run.usage) || null; } catch (_) { usage = null; }
  try {
    cost = (agent && typeof agent.getUsage === 'function') ? await agent.getUsage() : null;
  } catch (_) {
    // ⚠ A COST READ THAT FAILED IS `null`, NEVER `0`. A zero is a budget that never trips.
    cost = null;
  }
  return { type: normalizer.TURN_COMPLETED, usage, cost, model: (agent && agent.model) || spec.model || null };
}

/**
 * Start a run. ⚠ SYNCHRONOUS BY CONTRACT — see the handle note above.
 */
function start(spec) {
  const live = { agent: null };
  spec.conn = spec.wiring.usable ? mcp.connect(spec.wiring, appVersion()) : null;
  const iter = frames(spec, live);
  return {
    [Symbol.asyncIterator]() { return iter; },
    next() { return iter.next(); },
    /**
     * ⚠ THIS RUNTIME HAS NO INTERRUPT, AND THIS METHOD REFUSES OUT LOUD RATHER THAN NO-OPPING.
     * `cursor-research.md` documents `agent.send()` and `run.stream()` and NO interrupt and NO
     * steer API — §5 item X0, and the design's step 8 says a runtime Dopl cannot stop is a runtime
     * that does not ship. `capability.js › canInterrupt` reads `'unverified'` as false so the Stop
     * control is not offered at all; this exists because `session-engine.js › runEffect` case
     * `interruptQuery` also fires on `abandon_timeout`, and a silent no-op there is the shape
     * where nobody ever learns the actuator is missing.
     * ⚠ IT DELIBERATELY DOES NOT CLOSE THE TOOL SURFACE. An interrupt in Dopl means "stop this
     * turn", not "end this session", and disarming the session's Dopl access on an interrupt would
     * be a strictly worse lie than doing nothing: the session would survive with no delivery path.
     * The latch belongs to `close()`, which IS the end.
     */
    interrupt() {
      diag('cursor: interrupt requested and this runtime exposes none (§5 X0) —',
        'the turn continues on the runtime\'s side; Dopl is not able to stop a session it started');
      return Promise.resolve();
    },
    /**
     * ⚠ THE ONE THING DOPL CAN REALLY STOP HERE, and it is a partial one. Closing the latch makes
     * every in-process Dopl tool refuse, so an ended session cannot post, cannot read the channel
     * and cannot write the workspace whatever it is still doing. It does not stop the run.
     */
    close() {
      axisB.closeSession(spec.session);
      try { if (live.agent && typeof live.agent[Symbol.asyncDispose] === 'function') live.agent[Symbol.asyncDispose](); } catch (_) { /* best effort */ }
      try { iter.return(); } catch (_) { /* best effort */ }
    },
  };
}

/**
 * Resume a parked conversation — ⚠ REFUSED ON THIS RUNTIME, AND THE REFUSAL IS THE POINT.
 *
 * `session-park.js › resumeParked` zeroes both cost/token delta baselines on the explicit
 * ASSUMPTION that a resumed conversation restarts its cumulative totals. `cursor-research.md` says
 * nothing about `Agent.resume`'s usage semantics (§5 item X4), and a runtime that CONTINUES the
 * total makes every delta negative, `session-io.js` clamps it to zero, cost stops accumulating and
 * `session-state.js › costCapReached` is never reached — the budget control silently stops
 * existing, with no error and no symptom until a bill arrives. ⚠ AND THE STAKE IS HIGHER HERE THAN
 * ON EITHER OTHER RUNTIME, because this is the one platform that reports a REAL BILLED COST
 * (`meter.cost.billed`), so the cap it would silently disable is a cap over money actually
 * charged.
 *
 * ⚠ SO THE ADAPTER REFUSES AT ITS OWN DOOR rather than declaring a block nothing enforces. This
 * asks `capability.js › canResume` rather than restating the rule — one declaration, one
 * enforcement, and answering X4 turns both green with no code change here.
 * ⚠ A COLD LAUNCH IS UNAFFECTED, which is the whole design of the field.
 */
function resume(spec, _priorHandle) {
  const descriptor = require('./index').descriptor;
  if (!capability.canResume(descriptor)) {
    throw new Error(capability.resumeRefusal(descriptor) || 'this runtime cannot resume a conversation');
  }
  return start(spec);
}

module.exports = {
  buildLaunchSpec, start, resume, frames, turnFrame, nativePair, SANDBOX_DEFAULT,
};
