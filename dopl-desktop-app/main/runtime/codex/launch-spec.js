// THE LAUNCH SHAPE — ⚠ THE ONE ASSEMBLY POINT FOR EVERY SPAWN ON THIS RUNTIME.
//
// Fresh launch, parked resume, recreated shell and post-sign-in relaunch ALL come through here, so
// the deny list, the pinned channel-tool approval, the ambient-config isolation and the scrubbed
// env hold identically on all of them. That discipline is the Claude lane's and it ports verbatim;
// what changes is the vocabulary.
//
// ⚠ THE THREE PINS THAT ARE NOT PREFERENCES ON THIS RUNTIME:
//   isolated CODEX_HOME      `config-home.js` gives app-server an app-owned root with auth but no
//                            user config. The previously assumed `--ignore-user-config` flag does
//                            not exist on app-server and made every real launch fail at clap.
//   `tools.dopl_channel.approval_mode`  AXIS B'S PIN, set in `mcp.js` and independent of Axis A.
//                            The operator's tool posture may be as wide as `never`; the channel
//                            tool must still reach the gate, because no tool posture can send a
//                            message.
//   the RESTRICTED PROFILES PIN `sandbox_mode` + `approval_policy`.  `read_only` and `dopl_only`
//                            are CONTAINMENT: they set the native pair themselves and the
//                            operator's Axis-A pick does not move them. `full`'s supervision IS
//                            Axis A plus the sandbox row, so there the operator's choices ride.
//
// 🔒 ⚠ AND THE CLAUDE LANE'S "NEVER HAND OVER THE WIDEST MODE" PIN, PORTED (2026-09-22). There,
// `permissionMode: 'default'` is pinned so a wider platform mode cannot stop the gate being called.
// Here Codex's native `never` did exactly that to the channel tool — it raised no request and the
// call FAILED — so the operator's `never` is SENT as a narrower `granular` whose only asking
// category is MCP elicitation (`policy.js › NEVER_NATIVE`, measured identical to `never` for
// shell, files, escalation and network). The operator-facing mode and its meaning are unchanged.
//
// 🔒 ⚠ AND NATIVE DELEGATION + THE SKILLS CATALOGUE ARE OFF ON EVERY LAUNCH: `features.multi_agent =
// false` (all profiles), a delegation-free model catalog on argv (`catalog.js`, the only lever a
// code-mode model obeys), and the skills fence (`skills-fence.js`). Claude's lane removes `Agent`
// and `Skill` on every profile; these are the same two decisions in Codex's vocabulary.

const client = require('./client');
const tools = require('./tools');
const axisB = require('./axis-b');
const serverRequests = require('./server-requests');
const configHome = require('./config-home');
const policy = require('./policy');
const catalog = require('./catalog');
const skillsFence = require('./skills-fence');
const resolveBin = require('./resolve-bin');
const mcp = require('./mcp');
const normalizer = require('./normalize');
const channelDirs = require('../../channel-dirs');
const store = require('../../session-store');
const sessionOutbound = require('../../session-outbound');
const sessionCredential = require('../../session-credential');
const sessionDirected = require('../../session-directed');
const capability = require('../capability');
const { diag } = require('../../diag');

// ── THE ENVIRONMENT ──────────────────────────────────────────────────────────────────────────
//
// ⚠ A CONSERVATIVE SCRUB OVER THIS VENDOR'S OWN PREFIXES, DECLARED AS UNPROVEN. The Claude lane
// drops permission-affecting env knobs because it MEASURED which ones exist; `codex-research.md`
// documents no environment knob for this runtime at all — its escape hatches are CLI FLAGS
// (`--yolo`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`) and
// CONFIG, both of which the isolated CODEX_HOME and explicit thread fields above fence.
// So this is belt with no documented braces: a pattern that can only REMOVE, shaped like the one
// that was measured on the other runtime, over `CODEX_` / `OPENAI_` keys. §5 item C21 asks whether
// this runtime reads any permission-affecting env var; a positive answer adds names here, and a
// negative one leaves a scrub that cost nothing.
// ⚠ PATH / HOME / the keychain are never removed, and no credential var is dropped: the research
// names none (`credential.js › descriptor.envKeys` is empty and says why), so dropping by pattern
// could only take something we did not mean to.
const PERMISSION_ENV_RE = /PERMISSION|BYPASS|APPROVAL|DONT_ASK|SKIP|AUTO_APPROVE|DANGEROUS|YOLO/i;

function buildScrubbedEnv(extra) {
  const src = process.env || {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (/^(CODEX_|OPENAI_)/.test(k) && PERMISSION_ENV_RE.test(k)) continue;
    out[k] = src[k];
  }
  return Object.assign(out, extra || {});
}

// ── THE NATIVE PAIR ──────────────────────────────────────────────────────────────────────────
//
// ⚠ `workspace-write` IS CODEX'S OWN DEFAULT and its own "auto" pairing with `on-request`
// (`codex-research.md` §2), so a `full` session with no sandbox pick lands where a Codex user
// expects. The row that lets an operator move it is `toolMode.secondaryAxis`, which the UI does
// not render yet; reading it tolerantly here means wiring that control is a UI change and not a
// launch change.
const DEFAULT_SANDBOX = 'workspace-write';
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

// The NATIVE policy for the operator's Axis-A pick. ⚠ `never` and `granular` answer OBJECTS
// (`policy.js`), and a persisted `never` keeps meaning what the picker says — no migration.
function approvalPolicy(mode) {
  return policy.nativeApprovalPolicy(tools.normalizeToolMode(mode));
}

function nativePair(s, cfg) {
  // A restricted profile PINS both values — containment is not the operator's to widen from the
  // mode picker, on any runtime.
  if (cfg.native) return { approval_policy: cfg.native.approval_policy, sandbox_mode: cfg.native.sandbox_mode };
  const st = (s && s.state) || {};
  // ⚠ **THE SANDBOX PICK ARRIVES ON `state.native` SINCE 2026-09-21 (U5), AND BEFORE THAT IT
  // ARRIVED FROM NOWHERE.** This read was `st.sandboxMode`, a field **no producer in the tree ever
  // set** — so the `toolMode.secondaryAxis` row this adapter declares was rendered as data, could
  // not be written, and every `full` session launched at `workspace-write` whatever the operator
  // picked (`docs/REFACTOR-FINDINGS.md` F-390). The bag is validated by
  // `runtime/selection-vocabulary.js › normalizeNative` against the options THIS descriptor
  // declares, stamped at spawn by `session-engine.js`, and read here.
  // ⚠ THE LOCAL RE-CHECK STAYS AND MUST STAY. It is the last step before the value becomes a
  // launch argument, and every other coercion in this tree is re-run at that step.
  const native = (st.native && typeof st.native === 'object') ? st.native : {};
  const asked = native.sandbox_mode;
  const sandbox = SANDBOX_MODES.indexOf(asked) === -1 ? DEFAULT_SANDBOX : asked;
  return { approval_policy: approvalPolicy(st.toolMode), sandbox_mode: sandbox };
}

// ── THE SPEC ─────────────────────────────────────────────────────────────────────────────────

/**
 * The OPAQUE launch payload core hands straight back to `start` / `resume`.
 *
 * ⚠ CORE NEVER LOOKS INSIDE IT. The prompt rides along because on this runtime a turn is a CALL
 * and on another it is a streamed iterable, and core must not hold that difference.
 * ⚠ ONE ARGUMENT, CARRYING THE ENGINE'S TWO INJECTED HANDLES: the held gate needs the dispatch (to
 * paint a card) and the replay-aware quiet emitter (to resolve one an auto-allowed post painted),
 * and this module must not require the engine back.
 */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  const cfg = tools.buildSessionToolConfig(s.profile);
  const pair = nativePair(s, cfg);
  const server = mcp.buildDoplServerEntry(cfg.doplToolsPolicy);
  const wired = mcp.buildMcpEnv(s.workspaceId, sessionCredential.sessionBearer(s), store.slotKey(s));

  // ⚠ NO DOPL SERVER WITHOUT A TOKEN, and the session still launches. A half-built entry that 401s
  // on every call would tell the agent it HAS a delivery path and let it watch that path fail.
  const threadStart = { sandbox: pair.sandbox_mode };
  // ⚠ THE `features` FENCE RIDES EVERY LAUNCH, TOKEN OR NOT (`tools.js › ACCOUNT_FENCE`): the
  // foreign `codex_apps` server mounts from the operator's auth, not from Dopl's entry.
  // ⚠ …AND THE PROJECT-TRUST FENCE (`config-home.js › projectTrustFence`): without it a
  // workspace-write thread auto-trusts its cwd, persists that into the private home (refusing the
  // NEXT launch) and loads `<cwd>/.codex/config.toml` — hooks, MCP servers — from the agent's folder.
  const cwd = channelDirs.sessionSpawnDir(s.channelId);
  // ⚠ …AND THE SKILLS FENCE (`skills-fence.js`): no personal or bundled skill is listed or mentionable.
  threadStart.config = {
    features: Object.assign({}, cfg.features),
    projects: configHome.projectTrustFence(cwd),
    skills: skillsFence.skillsFence({ cwd, codexHome: configHome.privateHome() }),
  };
  if (wired.usable) threadStart.config.mcp_servers = { dopl: server };
  // An OBJECT policy rides `config.approval_policy` (the typed field needs the experimental API).
  policy.placePolicy(threadStart, pair.approval_policy);
  const model = typeof s.model === 'string' ? s.model.trim() : '';
  // `''` (or anything the roster does not know) sets no field at all — the platform's own pick,
  // which is `descriptor.models.defaultMeansAbsent`.
  if (model) threadStart.model = model;
  // ⚠ SAME STORY AS THE SANDBOX ABOVE: this read was `s.state.reasoningEffort`, which nothing
  // produced. It rides the validated native bag now, checked against the six efforts
  // `models.js › REASONING_EFFORTS` declares. An unrecognised one was DROPPED on the way in
  // (`dimensionOptions.reasoningEffort.fallback: 'absent'`), so no field is set and the platform
  // picks — there is no narrowest member to floor to on a dimension that is not containment.
  const effort = (s.state && s.state.native && s.state.native.reasoningEffort) || '';
  const turnStart = effort ? { effort } : {};

  return {
    session: s,
    dispatch: req.dispatch,
    emitQuiet: req.emitQuiet,
    prompt: s.pushIterator,
    // Current app-server rejects approval_policy/sandbox_mode as process config. They are native
    // thread fields; MCP config rides thread/start's explicit `config` object.
    args: [],
    threadStart,
    turnStart,
    env: buildScrubbedEnv(wired.env),
    // Item 7: the per-channel folder (else ~/Downloads). CONTEXT, not a fence — the sandbox is the
    // fence. Set on the child AND passed to `thread/start`, because `thread/list` filters by `cwd`
    // so a thread plainly HAS one, and which of the two the app-server honours is §5 item B2.
    cwd,
    resumeThreadId: s.resumeSdkId || null,
  };
}

// ── THE HANDLE ───────────────────────────────────────────────────────────────────────────────
//
// An async-iterable of raw app-server frames, plus the three verbs core drives it with. ⚠ IT IS
// BUILT AND RETURNED SYNCHRONOUSLY: core assigns it to the session IMMEDIATELY, and an await
// between "the child exists" and "something points at it" is the two-children bug — a second child
// still holding this session's channel access with nothing left to stop it.

function makeFrameQueue() {
  const queue = [];
  let waiting = null;
  let failure = null;
  let closed = false;
  const settle = () => {
    if (!waiting) return;
    const w = waiting; waiting = null;
    if (queue.length) { w.resolve({ value: queue.shift(), done: false }); return; }
    if (failure) { const e = failure; failure = null; w.reject(e); return; }
    if (closed) { w.resolve({ value: undefined, done: true }); }
  };
  return {
    push(frame) { if (!closed) { queue.push(frame); settle(); } },
    // An intentional `handle.close()` closes the queue before the child exits. Ignore the later
    // exit callback in that state; otherwise a normal shutdown is reclassified as a crash on the
    // consumer's next read.
    fail(err) {
      if (closed) return;
      failure = err instanceof Error ? err : new Error(String(err));
      settle();
    },
    close() { closed = true; settle(); },
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
      if (failure) { const e = failure; failure = null; return Promise.reject(e); }
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
    },
  };
}

/**
 * The held approval handler, wired to the same gate every runtime uses.
 *
 * ⚠ THE TRANSLATION TO CODEX'S FOUR WORDS HAPPENS HERE AND NOWHERE ELSE. `axis-b.js ›
 * makeCanUseTool` answers in CORE's verdict vocabulary (`{behavior, message}`) because three core
 * modules mint and read that shape — the operator's own click in `session-permissions.js`, the
 * thread tag in `session-outbound-tag.js`, and `session-outbound.js › wrapGate`, which resolves
 * the card an allowed post painted. A Codex-worded answer upstream of `wrapGate` would sail past
 * it and leave that card on screen forever.
 * ⚠ `updatedInput` IS DROPPED HERE, KNOWINGLY. Codex's approval reply has no slot for rewritten
 * arguments, so the forced thread tag travels the `PreToolUse` route instead
 * (`axis-b.js › preToolUseStamp`) — the design's §0.1 split of "one place decides, one place
 * stamps", with §5 items C6/C17/C18 as its open questions.
 */
function makeApprovalHandler(s, dispatch, emitQuiet) {
  const gate = sessionOutbound.wrapGate(s, axisB.makeCanUseTool(s, dispatch, diag), emitQuiet);
  return async function onServerRequest(msg) {
    const params = msg && msg.params ? msg.params : {};
    return serverRequests.answer(msg, async (name, input) => {
      const verdict = await gate(name, input, {
        requestId: String(msg.id),
        toolUseID: params.itemId || params.item_id || null,
      });
      return verdict && verdict.behavior === 'allow' ? 'allow' : 'deny';
    });
  };
}

/**
 * Start a run. ⚠ SYNCHRONOUS BY CONTRACT — see the handle note above.
 *
 * The boot sequence is the research's own build order: `initialize` (mandatory, with
 * `clientInfo.name = 'dopl'` — the ONLY forensic join between a Codex turn and a Dopl session),
 * then `thread/start` or `thread/resume`, then the first `turn/start`. Every later push from
 * core's prompt iterator becomes `turn/steer`, which is exactly what the composer's "inject
 * instructions while working" behaviour wants.
 */
function start(spec) {
  const s = spec.session;
  const frames = makeFrameQueue();
  let conn = null;
  let threadId = spec.resumeThreadId || null;
  let activeTurnId = null;
  let selectedModel = null;
  let latestUsage = null;

  // Token usage is reported on its own notification in the current v2 protocol, while core
  // expects usage to travel with the terminal turn event. Hold the latest snapshot and attach it
  // to `turn/completed`; the synthetic fields are namespaced by ownership rather than pretending
  // the app-server put usage on that frame itself.
  const onNotification = (msg) => {
    const method = msg && msg.method;
    const params = (msg && msg.params && typeof msg.params === 'object') ? msg.params : {};
    if (method === 'thread/tokenUsage/updated') {
      latestUsage = (params.tokenUsage && typeof params.tokenUsage === 'object')
        ? params.tokenUsage : null;
      return;
    }
    if (method === 'turn/completed') {
      const terminalTurn = params.turn && params.turn.id ? String(params.turn.id) : null;
      const enriched = Object.assign({}, params, {
        usage: latestUsage && latestUsage.total ? latestUsage.total : null,
        promptUsage: latestUsage && latestUsage.last ? latestUsage.last : null,
        // ⚠ **A SIBLING OF `last`/`total`, NOT A MEMBER OF EITHER** — and forwarding only those two
        // is what left a Codex session with no context DENOMINATOR (2026-09-22). The server reports
        // `tokenUsage.modelContextWindow` on every one of these notifications (measured: 258400 on
        // `codex-cli 0.155.1`); dropping it here meant `normalize.js › windowFrom` never saw a
        // window to read and the gauge showed used tokens over nothing.
        // ⚠ ABSENT STAYS ABSENT: `null` here means "this runtime reported no window", which
        // `session-model.js › contextEvent` answers by falling back to its table. It is NOT zero,
        // and a `0` denominator would render as a full meter on an empty session.
        contextWindow: latestUsage ? latestUsage.modelContextWindow : null,
        model: selectedModel,
      });
      frames.push(Object.assign({}, msg, { params: enriched }));
      if (!terminalTurn || terminalTurn === activeTurnId) activeTurnId = null;
      latestUsage = null;
      return;
    }
    frames.push(msg);
  };

  try {
    const env = configHome.isolatedEnv(spec.env);
    // 🔒 THE DELEGATION FENCE A CODE-MODE MODEL OBEYS (`catalog.js`) — process config, so argv.
    // ⚠ A catalog Dopl cannot build THROWS here, and the session fails rather than delegating.
    const fenced = catalog.writeDelegationFreeCatalog(env.CODEX_HOME, {
      bin: codexBin(), env, model: (spec.threadStart && spec.threadStart.model) || '',
    });
    conn = client.connect({
      args: (spec.args || []).concat(catalog.catalogArgs(fenced)),
      env,
      cwd: spec.cwd,
      log: typeof spec.log === 'function' ? spec.log : diag,
      onNotification,
      onServerRequest: makeApprovalHandler(s, spec.dispatch, spec.emitQuiet),
      // An app-server exit is never a successful end-of-stream for a live session. Failing the
      // queue keeps clap/config/protocol errors visible instead of resolving a waiting consumer
      // with `done: true` before the rejected initialize request can arrive.
      onExit: (code, signal) => frames.fail(
        new Error(`Codex app-server exited (code ${code}, signal ${signal})`)
      ),
    });
  } catch (err) {
    frames.fail(err);
    return handleFor(null, frames, () => threadId, () => activeTurnId);
  }

  (async () => {
    await conn.request('initialize', client.initializeParams(appVersion()));
    const method = spec.resumeThreadId ? 'thread/resume' : 'thread/start';
    const params = spec.resumeThreadId
      ? Object.assign({ threadId: spec.resumeThreadId, cwd: spec.cwd }, spec.threadStart || {})
      : Object.assign({ cwd: spec.cwd }, spec.threadStart || {});
    const thread = await conn.request(method, params);
    const threadValue = thread && thread.thread && typeof thread.thread === 'object' ? thread.thread : thread;
    threadId = (threadValue && (threadValue.threadId || threadValue.thread_id || threadValue.id))
      || spec.resumeThreadId || null;
    selectedModel = (thread && thread.model) || (threadValue && threadValue.model) || null;
    assertPolicyTook(params, thread);
    // ⚠ SYNTHETIC, AND NAMESPACED `dopl/` SO NOBODY MISTAKES IT FOR PROTOCOL. The app-server
    // documents no `thread/started` notification — the conversation handle arrives as a RESULT —
    // and core's consume loop only ever sees frames. This is where `launched` comes from, and
    // `launched.sessionId` is the whole resume story: `session-store.js` persists nothing else
    // about a running query.
    frames.push({ method: normalizer.THREAD_STARTED, params: { threadId, model: selectedModel } });
    // The prompt pump. ⚠ THE FIRST PUSH IS A TURN, EVERY LATER ONE IS A STEER — an unconditional
    // `turn/start` would begin a second turn while the first was live, which is the shape
    // `turn/steer` exists to replace.
    for await (const m of spec.prompt) {
      const text = String((m && m.message && m.message.content) || '');
      if (!text) continue;
      const input = [{ type: 'text', text }];
      if (!activeTurnId) {
        const turn = await conn.request('turn/start', Object.assign(
          { threadId, input }, spec.turnStart || {}
        ));
        const turnValue = turn && turn.turn && typeof turn.turn === 'object' ? turn.turn : turn;
        activeTurnId = turnValue && (turnValue.turnId || turnValue.turn_id || turnValue.id)
          ? String(turnValue.turnId || turnValue.turn_id || turnValue.id) : null;
        if (!activeTurnId) throw new Error('Codex turn/start returned no turn id');
      } else {
        const steered = await conn.request('turn/steer', {
          threadId, expectedTurnId: activeTurnId, input,
        });
        if (steered && steered.turnId) activeTurnId = String(steered.turnId);
        // 🔒 A STEER JOINS THE LIVE TURN — ONE `turn/completed` ANSWERS BOTH (CXP-3B). Core's
        // directed capture over-covered it as a turn of its own; say so, or it never reports.
        sessionDirected.steerJoined(s, text);
      }
    }
  })().catch((err) => frames.fail(err));

  return handleFor(conn, frames, () => threadId, () => activeTurnId);
}

// 🔒 THE POLICY ACTUALLY TOOK — `policy.js › assertPolicyTook`, which since 2026-09-22 compares the
// `granular` object form too (the operator's `never` travels as one).
const { assertPolicyTook } = policy;

function codexBin() {
  const r = resolveBin.resolveCodexBin();
  return r && r.ok ? r.path : null;
}

// 🔒 ⚠ **`turn/interrupt` IS THE ONE VERB THAT CAN ANSWER NOTHING AT ALL** (MEASURED 2026-09-22,
// `codex-cli 0.155.1`), and this is the bound that keeps that off Dopl's side of the wire.
//
// Three aims, three different answers, all measured on a real app-server:
//   an ACTIVE turn                   → `{}`, and `turn/completed` follows with `status: interrupted`
//   a turn that ENDED NORMALLY       → JSON-RPC `-32600` "no active turn to interrupt"
//   a turn ALREADY INTERRUPTED       → **NO RESPONSE, EVER.** 20s of waiting produced neither a
//                                      result nor an error; the request simply stays outstanding.
//
// `turn/steer` rejects cleanly in every one of those states, so this asymmetry belongs to
// interrupt alone. Today's blast radius is small — `session-engine.js › runEffect` case
// `interruptQuery` is fire-and-forget (`.catch(() => {})`) — but the promise it drops never
// settles and the entry in `client.js`'s `pending` map lives until the child exits. The moment any
// caller AWAITS this (a graceful shutdown that wants the interrupt to land before closing is the
// obvious one), an un-bounded version hangs that caller forever.
//
// ⚠ IT RESOLVES, IT NEVER REJECTS. An interrupt is a best-effort stop, and its caller has nothing
// useful to do with a failure — the terminal state arrives on the frame stream either way.
// ⚠ AND THE TIMER IS `unref`'d, so a pending bound cannot hold a Node process open at exit (the
// desktop CI runs Node 22, where that is the difference between a green run and a hung one).
const INTERRUPT_TIMEOUT_MS = 5000;

function boundedInterrupt(pending) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, INTERRUPT_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    pending.then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); }
    );
  });
}

function handleFor(conn, frames, threadIdOf, turnIdOf) {
  return {
    [Symbol.asyncIterator]() { return frames[Symbol.asyncIterator](); },
    next() { return frames.next(); },
    /**
     * ⚠ WITHOUT THIS, DOPL CANNOT STOP A SESSION IT STARTED. `session-engine.js › runEffect` case
     * `interruptQuery` is the tree's only interrupt and the reducer's `interrupt` and
     * `abandon_timeout` effects have no other actuator. `turn/interrupt` is the documented verb.
     */
    interrupt() {
      if (!conn) return Promise.resolve();
      const threadId = threadIdOf();
      const turnId = turnIdOf();
      // ⚠ NO ACTIVE TURN, NO REQUEST. `activeTurnId` is cleared on `turn/completed`, which is the
      // first half of the defence measured below.
      if (!threadId || !turnId) return Promise.resolve();
      return boundedInterrupt(conn.request('turn/interrupt', { threadId, turnId }));
    },
    close() {
      frames.close();
      if (conn) conn.close();
    },
  };
}

/**
 * Resume a parked conversation — ⚠ REFUSED ON THIS RUNTIME, AND THE REFUSAL IS THE POINT.
 *
 * `session-park.js › resumeParked` zeroes the TOKEN delta baseline on the explicit ASSUMPTION
 * that a resumed conversation restarts its cumulative total. 🔒 **§5 item C8 IS NOW MEASURED
 * (2026-09-22, `codex-cli 0.155.1`): this runtime CONTINUES the total across `thread/resume` in a
 * fresh child** — one thread read total 18,838 → 42,429 → 71,194 over three turns spanning two
 * app-server processes, each step the previous total plus that turn's `last`. So the baseline
 * reset would re-count the entire thread on the first post-resume `result`, doubling `tokensSpent`
 * on the agent card.
 *
 * ⚠ SO THE ADAPTER STILL REFUSES AT ITS OWN DOOR rather than declaring a block nothing enforces.
 * `descriptor.session.usageResetsOnResume` is `false`, `capability.js › canResume` requires
 * `true`, and this asks that predicate rather than restating it — one declaration, one
 * enforcement. ⚠ WHAT LIFTS IT IS A CORE CHANGE: `resumeParked` must PRESERVE the baseline for a
 * runtime that declares `false`. That is CXP-4's remaining half, in `main/session-park.js`.
 * ⚠ A COLD LAUNCH IS UNAFFECTED, which is the whole design of the field: this refuses a RESUME.
 */
function resume(spec, _priorHandle) {
  const descriptor = require('./index').descriptor;
  if (!capability.canResume(descriptor)) {
    throw new Error(capability.resumeRefusal(descriptor) || 'this runtime cannot resume a conversation');
  }
  return start(spec);
}

function appVersion() {
  try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
}

module.exports = {
  buildLaunchSpec, start, resume,
  buildScrubbedEnv, nativePair, approvalPolicy, makeFrameQueue, makeApprovalHandler,
  assertPolicyTook, boundedInterrupt,
  DEFAULT_SANDBOX, SANDBOX_MODES, INTERRUPT_TIMEOUT_MS,
};
