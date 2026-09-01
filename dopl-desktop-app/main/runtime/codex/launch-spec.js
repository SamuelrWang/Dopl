// THE LAUNCH SHAPE — ⚠ THE ONE ASSEMBLY POINT FOR EVERY SPAWN ON THIS RUNTIME.
//
// Fresh launch, parked resume, recreated shell and post-sign-in relaunch ALL come through here, so
// the deny list, the pinned channel-tool approval, the ambient-config isolation and the scrubbed
// env hold identically on all of them. That discipline is the Claude lane's and it ports verbatim;
// what changes is the vocabulary.
//
// ⚠ THE THREE PINS THAT ARE NOT PREFERENCES ON THIS RUNTIME:
//   `--ignore-user-config`   the operator's `~/.codex/config.toml` can never widen a session Dopl
//                            launched. `codex-research.md` §3 documents the precedence chain (CLI
//                            flags -> inline `-c` -> profile config -> base config) and this flag
//                            as the thing that skips the user's file entirely. ⚠ It is documented
//                            under CLI CONFIG LAYERING, not on the `app-server` subcommand — §5
//                            item C9 — and if that subcommand rejects it the spawn fails LOUDLY on
//                            an unknown flag, which is the safe failure. It is passed rather than
//                            assumed for exactly that reason.
//   `tools.dopl_channel.approval_mode`  AXIS B'S PIN, set in `mcp.js` and independent of Axis A.
//                            The operator's tool posture may be as wide as `never`; the channel
//                            tool must still reach the gate, because no tool posture can send a
//                            message.
//   the RESTRICTED PROFILES PIN `sandbox_mode` + `approval_policy`.  `read_only` and `dopl_only`
//                            are CONTAINMENT: they set the native pair themselves and the
//                            operator's Axis-A pick does not move them. `full`'s supervision IS
//                            Axis A plus the sandbox row, so there the operator's choices ride.
//
// ⚠ AND ONE THING THE CLAUDE LANE PINS THAT THIS ONE CANNOT. There, `permissionMode: 'default'` is
// pinned so a wider platform mode cannot stop the gate being called at all. Here the operator's
// own `approval_policy` IS the native control decision (1) requires us to show, and it genuinely
// changes what the app-server asks about: at `never` it raises no approval requests, so actions
// Dopl's Axis A would have gated never reach the gate. THAT IS CODEX'S OWN GRANULARITY, SHOWN
// HONESTLY (`codex-research.md` §4 item 1 reaches the same conclusion), and it is bounded on the
// side that matters — Axis B's pin above is per-MCP-tool and survives every policy value.

const client = require('./client');
const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const mcp = require('./mcp');
const normalizer = require('./normalize');
const channelDirs = require('../../channel-dirs');
const store = require('../../session-store');
const sessionOutbound = require('../../session-outbound');
const sessionCredential = require('../../session-credential');
const capability = require('../capability');
const { diag } = require('../../diag');

// ── CONFIG OVERRIDES ─────────────────────────────────────────────────────────────────────────
//
// ⚠ FLATTENED TO LEAF SCALARS ON PURPOSE. `-c key=value` is the documented inline override and it
// takes a dotted path; what it accepts as a TABLE value is not documented, so every nested map
// below is emitted as one override per leaf rather than as one JSON blob. A path segment that is
// not a bare word is quoted, because header names carry `-`. §5 item C28 confirms the syntax; a
// rejection is a clap error on stdout that `client.js` surfaces verbatim.
const BARE_SEGMENT = /^[A-Za-z0-9_]+$/;

function segment(key) {
  return BARE_SEGMENT.test(key) ? key : JSON.stringify(key);
}

function flattenConfig(value, prefix, out) {
  const acc = out || [];
  if (value === null || value === undefined) return acc;
  if (Array.isArray(value) || typeof value !== 'object') {
    acc.push(`${prefix}=${JSON.stringify(value)}`);
    return acc;
  }
  for (const key of Object.keys(value)) {
    flattenConfig(value[key], `${prefix}.${segment(key)}`, acc);
  }
  return acc;
}

function overrideArgs(config) {
  const args = [];
  for (const pair of flattenConfig(config, '', []).map((p) => p.replace(/^\./, ''))) {
    args.push('-c', pair);
  }
  return args;
}

// ── THE ENVIRONMENT ──────────────────────────────────────────────────────────────────────────
//
// ⚠ A CONSERVATIVE SCRUB OVER THIS VENDOR'S OWN PREFIXES, DECLARED AS UNPROVEN. The Claude lane
// drops permission-affecting env knobs because it MEASURED which ones exist; `codex-research.md`
// documents no environment knob for this runtime at all — its escape hatches are CLI FLAGS
// (`--yolo`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`) and
// CONFIG, both of which `--ignore-user-config` and the explicit overrides above already fence.
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

function nativePair(s, cfg) {
  // A restricted profile PINS both values — containment is not the operator's to widen from the
  // mode picker, on any runtime.
  if (cfg.native) return { approval_policy: cfg.native.approval_policy, sandbox_mode: cfg.native.sandbox_mode };
  const st = (s && s.state) || {};
  const sandbox = SANDBOX_MODES.indexOf(st.sandboxMode) === -1 ? DEFAULT_SANDBOX : st.sandboxMode;
  return { approval_policy: tools.normalizeToolMode(st.toolMode), sandbox_mode: sandbox };
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

  const config = Object.assign({}, pair);
  // ⚠ NO DOPL SERVER WITHOUT A TOKEN, and the session still launches. A half-built entry that 401s
  // on every call would tell the agent it HAS a delivery path and let it watch that path fail.
  if (wired.usable) config.mcp_servers = { dopl: server };
  const model = typeof s.model === 'string' ? s.model.trim() : '';
  // `''` (or anything the roster does not know) sets no field at all — the platform's own pick,
  // which is `descriptor.models.defaultMeansAbsent`.
  if (model) config.model = model;
  const effort = (s.state && s.state.reasoningEffort) || '';
  if (effort) config.model_reasoning_effort = effort;

  return {
    session: s,
    dispatch: req.dispatch,
    emitQuiet: req.emitQuiet,
    prompt: s.pushIterator,
    // ⚠ `--ignore-user-config` FIRST, so it is the first thing a reader (and a clap error) sees.
    args: ['--ignore-user-config'].concat(overrideArgs(config)),
    env: buildScrubbedEnv(wired.env),
    // Item 7: the per-channel folder (else ~/Downloads). CONTEXT, not a fence — the sandbox is the
    // fence. Set on the child AND passed to `thread/start`, because `thread/list` filters by `cwd`
    // so a thread plainly HAS one, and which of the two the app-server honours is §5 item B2.
    cwd: channelDirs.sessionSpawnDir(s.channelId),
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
    fail(err) { failure = err instanceof Error ? err : new Error(String(err)); settle(); },
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
    const name = approval.toolNameFor({ method: msg && msg.method, params: params, toolName: params.toolName });
    // ⚠ `{}` WHERE THE REQUEST CARRIES NO ARGUMENTS (§5 item C1). The gate reads `input.op` /
    // `input.channel` to op-scope a channel call; with no arguments every channel call gates,
    // READS INCLUDED, which is the collapse `descriptor.axisB.opScoped: 'unverified'` declares.
    const input = (params.arguments && typeof params.arguments === 'object') ? params.arguments
      : ((params.input && typeof params.input === 'object') ? params.input : {});
    const verdict = await gate(name, input, { requestId: String(msg.id), toolUseID: params.itemId || params.item_id || null });
    return approval.answerApproval(
      { message: verdict && verdict.message },
      verdict && verdict.behavior === 'allow' ? 'allow' : 'deny'
    );
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
  let started = false;

  try {
    conn = client.connect({
      args: spec.args,
      env: spec.env,
      cwd: spec.cwd,
      log: diag,
      onNotification: (msg) => frames.push(msg),
      onServerRequest: makeApprovalHandler(s, spec.dispatch, spec.emitQuiet),
      onExit: () => frames.close(),
    });
  } catch (err) {
    frames.fail(err);
    return handleFor(null, frames, () => threadId);
  }

  (async () => {
    await conn.request('initialize', client.initializeParams(appVersion()));
    const method = spec.resumeThreadId ? 'thread/resume' : 'thread/start';
    const params = spec.resumeThreadId
      ? { threadId: spec.resumeThreadId, cwd: spec.cwd }
      : { cwd: spec.cwd };
    const thread = await conn.request(method, params);
    threadId = (thread && (thread.threadId || thread.thread_id || thread.id)) || spec.resumeThreadId || null;
    // ⚠ SYNTHETIC, AND NAMESPACED `dopl/` SO NOBODY MISTAKES IT FOR PROTOCOL. The app-server
    // documents no `thread/started` notification — the conversation handle arrives as a RESULT —
    // and core's consume loop only ever sees frames. This is where `launched` comes from, and
    // `launched.sessionId` is the whole resume story: `session-store.js` persists nothing else
    // about a running query.
    frames.push({ method: normalizer.THREAD_STARTED, params: { threadId, model: (thread && thread.model) || null } });
    // The prompt pump. ⚠ THE FIRST PUSH IS A TURN, EVERY LATER ONE IS A STEER — an unconditional
    // `turn/start` would begin a second turn while the first was live, which is the shape
    // `turn/steer` exists to replace.
    for await (const m of spec.prompt) {
      const text = String((m && m.message && m.message.content) || '');
      if (!text) continue;
      if (!started) {
        started = true;
        await conn.request('turn/start', { threadId, input: text });
      } else {
        await conn.request('turn/steer', { threadId, input: text });
      }
    }
  })().catch((err) => frames.fail(err));

  return handleFor(conn, frames, () => threadId);
}

function handleFor(conn, frames, threadIdOf) {
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
      return conn.request('turn/interrupt', { threadId: threadIdOf() }).catch(() => {});
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
 * `session-park.js › resumeParked` zeroes both cost/token delta baselines on the explicit
 * ASSUMPTION that a resumed conversation restarts its cumulative totals. `codex-research.md` says
 * nothing about `thread/resume`'s usage semantics (§5 item C8), and a runtime that CONTINUES the
 * total makes every delta negative, `session-io.js` clamps it to zero, cost stops accumulating and
 * `session-state.js › costCapReached` is never reached — the budget control silently stops
 * existing, with no error and no symptom until a bill arrives.
 *
 * ⚠ SO THE ADAPTER REFUSES AT ITS OWN DOOR rather than declaring a block nothing enforces.
 * `descriptor.session.usageResetsOnResume` is `'unverified'`, `capability.js › canResume` reads
 * that as false, and this asks that predicate rather than restating it — one declaration, one
 * enforcement, and answering C8 turns both green with no code change here.
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
  flattenConfig, overrideArgs, buildScrubbedEnv, nativePair, makeFrameQueue, makeApprovalHandler,
  DEFAULT_SANDBOX, SANDBOX_MODES,
};
