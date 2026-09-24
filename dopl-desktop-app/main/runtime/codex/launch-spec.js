// The one assembly point for every Codex spawn (fresh, parked resume, recreated shell, post-sign-in),
// so the deny list, channel-tool pin, isolated CODEX_HOME, native fences and env scrub hold on all.

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
const sessionCredential = require('../../session-credential');
const sessionDirected = require('../../session-directed');
const capability = require('../capability');
const cliSpawn = require('../cli-spawn');
const { diag } = require('../../diag');

// ── ENVIRONMENT ──────────────────────────────────────────────────────────────────────────────
// Remove-only scrub of CODEX_/OPENAI_ permission-shaped keys (no Codex permission env knob is known;
// its escape hatches are CLI flags and config, fenced elsewhere). PATH, HOME and credentials pass.
const PERMISSION_ENV_RE = /PERMISSION|BYPASS|APPROVAL|DONT_ASK|SKIP|AUTO_APPROVE|DANGEROUS|YOLO/i;

function buildScrubbedEnv(extra) {
  return Object.assign(cliSpawn.scrubbedEnv(process.env, /^(CODEX_|OPENAI_)/, PERMISSION_ENV_RE), extra || {});
}

// ── NATIVE PAIR ──────────────────────────────────────────────────────────────────────────────
// `workspace-write` is Codex's own default sandbox (its "auto" pairing with `on-request`).
const DEFAULT_SANDBOX = 'workspace-write';
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

function approvalPolicy(mode) {
  return policy.nativeApprovalPolicy(tools.normalizeToolMode(mode));
}

function nativePair(s, cfg) {
  // A restricted profile pins both values: containment is not the operator's to widen.
  if (cfg.native) return { approval_policy: cfg.native.approval_policy, sandbox_mode: cfg.native.sandbox_mode };
  const st = (s && s.state) || {};
  // Validated by `selection-vocabulary.js › normalizeNative`; re-checked as the last step before argv.
  const native = (st.native && typeof st.native === 'object') ? st.native : {};
  const asked = native.sandbox_mode;
  // Absent is the platform default; an unrecognised value fail-closes to the narrowest (X-05).
  const sandbox = asked == null || asked === '' ? DEFAULT_SANDBOX
    : (SANDBOX_MODES.indexOf(asked) === -1 ? SANDBOX_MODES[0] : asked);
  return { approval_policy: approvalPolicy(st.toolMode), sandbox_mode: sandbox };
}

// ── SPEC ─────────────────────────────────────────────────────────────────────────────────────

/** `{ session, dispatch }` → the opaque payload core hands back to `start` / `resume` unread. */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  const cfg = tools.buildSessionToolConfig(s.profile);
  const pair = nativePair(s, cfg);
  const server = mcp.buildDoplServerEntry(cfg.doplToolsPolicy, s.profile, s.doplToolSet);
  const wired = mcp.buildMcpEnv(s.workspaceId, sessionCredential.sessionBearer(s), store.slotKey(s));

  const threadStart = { sandbox: pair.sandbox_mode };
  const cwd = channelDirs.sessionSpawnDir(s.channelId);
  threadStart.config = {
    // Every launch, token or not: `codex_apps` mounts from operator auth (`tools.js › ACCOUNT_FENCE`).
    features: Object.assign({}, cfg.features),
    // Without it a workspace-write thread auto-trusts its cwd (`config-home.js › projectTrustFence`).
    projects: configHome.projectTrustFence(cwd),
    skills: skillsFence.skillsFence({ cwd, codexHome: configHome.privateHome(), log: diag }),
    // A thread-level `[]` silences a home-layer `notify` (`tools.js › NOTIFY_FENCE`).
    notify: tools.NOTIFY_FENCE.slice(),
    // No Dopl bearer in any shell command's env (`mcp.js › shellEnvironmentPolicy`, CX-03).
    shell_environment_policy: mcp.shellEnvironmentPolicy(),
  };
  // No token, no Dopl server (the session still launches): an entry that 401s looks like a live path.
  if (wired.usable) threadStart.config.mcp_servers = { [mcp.SERVER_KEY]: server };
  // An OBJECT policy rides `config.approval_policy` (the typed field needs the experimental API).
  policy.placePolicy(threadStart, pair.approval_policy);
  const model = typeof s.model === 'string' ? s.model.trim() : '';
  // No model, no field: the platform picks.
  if (model) threadStart.model = model;
  // Validated upstream (`models.js › REASONING_EFFORTS`); an unrecognised one was dropped: platform picks.
  const effort = (s.state && s.state.native && s.state.native.reasoningEffort) || '';
  const turnStart = effort ? { effort } : {};

  return {
    session: s,
    dispatch: req.dispatch,
    prompt: s.pushIterator,
    // app-server rejects approval_policy/sandbox_mode as process config; they are thread fields.
    args: [],
    threadStart,
    turnStart,
    env: buildScrubbedEnv(wired.env),
    // The per-channel folder: context, not a fence (the sandbox is). Set on the child and on `thread/start`.
    cwd,
    resumeThreadId: s.resumeSdkId || null,
  };
}

// ── HANDLE ───────────────────────────────────────────────────────────────────────────────────
// Returned synchronously: an await between "the child exists" and "the session points at it" is the
// two-children bug (a second child keeps the session's channel access with nothing to stop it).

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
    // Ignored after `close()` (a deliberate shutdown is not a crash) and after a first failure (the cause).
    fail(err) {
      if (closed || failure) return;
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

// Server requests → the held gate (core `{ behavior }` verdicts, F-382); `server-requests.js › answer`
// translates to Codex's wire words. `updatedInput` is dropped: Codex's reply has no slot for it.
function makeApprovalHandler(s, dispatch) {
  const gate = axisB.makeCanUseTool(s, dispatch, diag);
  return async function onServerRequest(msg) {
    const params = msg && msg.params ? msg.params : {};
    return serverRequests.answer(msg, async (name, input) => {
      const verdict = await gate(name, input, {
        requestId: String(msg.id),
        toolUseID: params.itemId || null,
      });
      return verdict && verdict.behavior === 'allow' ? 'allow' : 'deny';
    }, diag);
  };
}

// Start a run. Synchronous by contract (two-children bug). Boot: fenced catalog (async, CX-09),
// `initialize` + `initialized`, `thread/start|resume`; first push `turn/start`, later ones `turn/steer`.
function start(spec) {
  const s = spec.session;
  const frames = makeFrameQueue();
  // The child is spawned after the catalog step; `close()` before then means it never is.
  const link = { conn: null, closed: false };
  let threadId = spec.resumeThreadId || null;
  let activeTurnId = null;
  let selectedModel = null;
  let latestUsage = null;
  // `total` is cumulative per thread and continues across `thread/resume`; an interrupted turn gets
  // no usage update, so the last total is carried (CX-02).
  let lastTotal = null;
  const failedTurns = new Set();

  // A failed turn becomes the synthetic error frame (auth → hold, else a visible line; CX-04).
  const pushTurnError = (turnId, error) => {
    const id = turnId ? String(turnId) : '';
    if (id && failedTurns.has(id)) return;
    if (id) failedTurns.add(id);
    const e = (error && typeof error === 'object') ? error : {};
    frames.push({
      type: normalizer.ERROR_MESSAGE_TYPE,
      text: String(e.message || ''),
      codexErrorInfo: e.codexErrorInfo == null ? null : e.codexErrorInfo,
      turnFailed: true,
    });
  };

  // Usage arrives on `thread/tokenUsage/updated`; it is attached to the `turn/completed` frame.
  const onNotification = (msg) => {
    const method = msg && msg.method;
    const params = (msg && msg.params && typeof msg.params === 'object') ? msg.params : {};
    if (method === 'thread/tokenUsage/updated') {
      latestUsage = (params.tokenUsage && typeof params.tokenUsage === 'object')
        ? params.tokenUsage : null;
      if (latestUsage && latestUsage.total) lastTotal = latestUsage.total;
      return;
    }
    if (method === 'error') {
      // `willRetry: true` is the server retrying the same request; only a final error ends the turn.
      if (params.willRetry !== true) pushTurnError(params.turnId, params.error);
      return;
    }
    if (method === 'turn/completed') {
      const turn = (params.turn && typeof params.turn === 'object') ? params.turn : {};
      const terminalTurn = turn.id ? String(turn.id) : null;
      if (turn.status === 'failed') pushTurnError(terminalTurn, turn.error);
      const enriched = Object.assign({}, params, {
        usage: latestUsage && latestUsage.total ? latestUsage.total : lastTotal,
        promptUsage: latestUsage && latestUsage.last ? latestUsage.last : null,
        // A sibling of `last`/`total`; absent stays `null` (never a 0 denominator).
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

  let env;
  try {
    env = configHome.isolatedEnv(spec.env);
  } catch (err) {
    frames.fail(err);
    return handleFor(link, frames, () => threadId, () => activeTurnId);
  }

  (async () => {
    // Delegation fence (`catalog.js`): `model_catalog_json` works only as process config (`-c` argv);
    // the same key in `thread/start.config` is ignored. No catalog fails the launch.
    const fenced = await catalog.writeDelegationFreeCatalog(env.CODEX_HOME, {
      bin: codexBin(), env, model: (spec.threadStart && spec.threadStart.model) || '',
    });
    if (link.closed) return;
    const conn = client.connect({
      args: (spec.args || []).concat(catalog.catalogArgs(fenced)),
      env,
      cwd: spec.cwd,
      log: typeof spec.log === 'function' ? spec.log : diag,
      onNotification,
      onServerRequest: makeApprovalHandler(s, spec.dispatch),
      // An exit is never a clean end-of-stream for a live session; the spawn error is the cause.
      onExit: (code, signal, spawnError) => frames.fail(
        spawnError || new Error(`Codex app-server exited (code ${code}, signal ${signal})`)
      ),
    });
    link.conn = conn;
    await conn.request('initialize', client.initializeParams(appVersion()));
    conn.notify('initialized');
    const method = spec.resumeThreadId ? 'thread/resume' : 'thread/start';
    const params = spec.resumeThreadId
      ? Object.assign({ threadId: spec.resumeThreadId, cwd: spec.cwd }, spec.threadStart || {})
      : Object.assign({ cwd: spec.cwd }, spec.threadStart || {});
    const thread = await conn.request(method, params);
    const handle = (thread && thread.thread && typeof thread.thread === 'object') ? thread.thread : {};
    const startedId = handle.id ? String(handle.id) : '';
    // A fresh thread with no id has no conversation to run a turn in (CX-14).
    if (!startedId && !spec.resumeThreadId) throw new Error(`Codex ${method} returned no thread id`);
    threadId = startedId || spec.resumeThreadId;
    selectedModel = (thread && thread.model) || handle.model || null;
    assertPolicyTook(params, thread);
    // Dopl's own synthetic frame: carries the thread handle + selected model into core (`launched`).
    frames.push({ method: normalizer.THREAD_STARTED, params: { threadId, model: selectedModel } });
    // A second `turn/start` would open a concurrent turn, so a push during one steers it.
    for await (const m of spec.prompt) {
      const text = String((m && m.message && m.message.content) || '');
      if (!text) continue;
      const input = [{ type: 'text', text }];
      if (!activeTurnId) {
        const turn = await conn.request('turn/start', Object.assign(
          { threadId, input }, spec.turnStart || {}
        ));
        activeTurnId = turn && turn.turn && turn.turn.id ? String(turn.turn.id) : null;
        if (!activeTurnId) throw new Error('Codex turn/start returned no turn id');
      } else {
        const steered = await conn.request('turn/steer', {
          threadId, expectedTurnId: activeTurnId, input,
        });
        if (steered && steered.turnId) activeTurnId = String(steered.turnId);
        // A steer joins the live turn (one `turn/completed` answers both); tell directed capture.
        sessionDirected.steerJoined(s, text);
      }
    }
  })().catch((err) => frames.fail(err));

  return handleFor(link, frames, () => threadId, () => activeTurnId);
}

const { assertPolicyTook } = policy;

function codexBin() {
  const r = resolveBin.resolveCodexBin();
  return r && r.ok ? r.path : null;
}

// `turn/interrupt` on an already-interrupted turn never answers (codex-cli 0.155.1), so it is bounded.
// It resolves, never rejects (the terminal state arrives on the frame stream either way), and the timer
// is `unref`'d so a pending bound cannot hold Node open at exit (Node 22 CI).
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

function handleFor(link, frames, threadIdOf, turnIdOf) {
  return {
    [Symbol.asyncIterator]() { return frames[Symbol.asyncIterator](); },
    next() { return frames.next(); },
    /** Dopl's only way to stop a running turn (`session-engine.js › runEffect` `interruptQuery`). */
    interrupt() {
      const conn = link.conn;
      if (!conn) return Promise.resolve();
      const threadId = threadIdOf();
      const turnId = turnIdOf();
      // No active turn (cleared on `turn/completed`), no request: an interrupted turn never answers one.
      if (!threadId || !turnId) return Promise.resolve();
      return boundedInterrupt(conn.request('turn/interrupt', { threadId, turnId }));
    },
    close() {
      link.closed = true;
      frames.close();
      if (link.conn) link.conn.close();
    },
  };
}

/** Resume a parked thread. Codex's total continues across `thread/resume`, so core keeps the baseline. */
function resume(spec, _priorHandle) {
  const descriptor = require('./index').descriptor;
  if (!capability.canResume(descriptor)) {
    throw new Error(capability.resumeRefusal(descriptor) || 'this runtime cannot resume a conversation');
  }
  return start(spec);
}

const appVersion = () => require('../../app-version').appVersion();

module.exports = {
  buildLaunchSpec, start, resume,
  buildScrubbedEnv, nativePair, approvalPolicy, makeFrameQueue,
  assertPolicyTook, boundedInterrupt,
};
