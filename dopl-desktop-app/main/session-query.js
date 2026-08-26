// session-query.js — SDK option assembly + the query lifecycle (v3.1, H1).
//
// Extracted from session-engine.js to hold that AT-CAP file (§O-7 / F-09c) under the
// 500-line cap while H1 adds the supersede-before-relaunch discipline below. Leaf deps
// (io / store / diag / channelDirs / sdk-loader / session-profiles / session-outbound /
// session-auth) are required at the top exactly like session-park.js; the two
// ENGINE-owned handles it cannot require — `dispatch` and the replay-aware `emitQuiet` —
// are injected via bind(). None of the modules required here require session-engine
// back, so there is no cycle.
//
// SECURITY: `buildSdkOptions` is the ONE assembly point for every spawn shape (fresh
// launch, parked resume, recreated shell, post-sign-in relaunch). session-park calls it
// through deps.buildSdkOptions and session-auth relaunches through the engine's own
// startQuery, so no path anywhere assembles its own options: the allowedTools shadow
// rule, the canUseTool gate, the scrubbed env, disallowedTools, settingSources:[] and
// permissionMode 'default' hold identically on all of them. `options.resume` is the only
// field that ever differs between a cold launch and a resume.

const io = require('./session-io');
const store = require('./session-store');
const { diag } = require('./diag');
const channelDirs = require('./channel-dirs');
const sessionAuth = require('./session-auth');
const sessionOutbound = require('./session-outbound');
const sessionModel = require('./session-model'); // the frozen model enum + the context meter
const sessionCredential = require('./session-credential'); // the container lock (plan §4.4 B1)
const { buildSessionToolConfig } = require('./session-profiles');
const { resolveClaudeExecutable, buildMcpServers, withSessionStamp, buildSecretPathDenyRules, buildScrubbedEnv } = require('./sdk-loader');

let deps = null; // { dispatch, emitQuiet, scheduleIdle }

function bind(d) {
  deps = d || null;
}

function buildSdkOptions(s) {
  const cfg = buildSessionToolConfig(s.profile);
  const options = {
    // Item 7: the per-channel folder (else ~/Downloads) as the SDK cwd. Context (§H-9), not a fence.
    cwd: channelDirs.sessionSpawnDir(s.channelId),
    allowedTools: cfg.preApproved, // pre-approved => SHADOWED, no button (§A.5)
    // C1: the profile's hard-deny PLUS the credential-path rules — a pre-approved read is SHADOWED
    // and never reaches canUseTool, so only this tool-bound layer can fence userData / ~/.claude*.
    disallowedTools: cfg.disallowedTools.concat(buildSecretPathDenyRules()),
    // v2.x: buildMcpServers PINS this session's workspace (X-Workspace-Id), so a call that omits
    // `workspace=` auto-targets instead of being refused; a per-call `workspace=` still wins.
    // 🔒 CONTAINER LOCK (plan §4.4 B1): `sessionBearer(s)` is the child credential
    // `session-credential.js` stamped on this session at spawn when its workspace is a SHARED
    // link container, and '' for every other session. It REPLACES the device token, so a locked
    // session — and anything it shells out to, which inherits the same credential — is refused
    // every other workspace server-side. The `X-Workspace-Id` pin below it stays a hint that
    // grants nothing; this is the part that actually refuses.
    // ⚠ Read HERE rather than minted here: this function is synchronous and is re-entered by
    // every spawn shape, park/resume included, so the credential must already be on `s`.
    mcpServers: buildMcpServers(cfg.doplToolsPolicy, s.workspaceId, sessionCredential.sessionBearer(s)),
    settingSources: [], // ALWAYS — the global allow-list can never shadow a gate
    permissionMode: 'default', // FIX M2: pin — bypass/acceptEdits/dontAsk short-circuit canUseTool
    // FIX M2: strip permission-mode env knobs, keep auth (sdk-loader). Q6: withStoredCredential adds
    // CLAUDE_CODE_OAUTH_TOKEN only when our own setup-token is this machine's ONLY credential.
    env: sessionAuth.withStoredCredential(buildScrubbedEnv()),
    // C6: the gate is unchanged; the wrapper only resolves the card an ALLOWED post painted.
    canUseTool: sessionOutbound.wrapCanUseTool(s, io.makeCanUseTool(s, deps.dispatch, diag), deps.emitQuiet), // diag: the forced-thread-tag conflict log (session-io stays electron-free)
    abortController: s.abortController,
    // LOAD-BEARING for v2.7 L3 (FIX F4): the outbound card shows the operator the bytes a post will
    // send, so the streamed tool_use input must be the WHOLE, FINAL input. No fragments (below) and NO
    // `hooks` option is ever set — a PreToolUse hook could rewrite the input the card already painted.
    includePartialMessages: false,
  };
  // F2 — THIS RUN'S SLOT KEY onto the dopl entry (X-Dopl-Session-Id), which the server turns into
  // the reserved `metadata.session_id`. `store.slotKey` is the ONE definition of a slot — (channel,
  // agent) for a team session, (channel, thread) for every other shape — so the stamp names exactly
  // the registry slot this run occupies, and two concurrent sessions of ONE agent handle stamp two
  // DIFFERENT values (which is the whole point: nothing on the wire could tell them apart). Applied
  // here rather than inside buildMcpServers because that builder is shared with the headless spawn
  // config, which has no session to name. A LABEL, not a lock: nothing here limits how many run, and
  // a missing slot stamps nothing.
  withSessionStamp(options.mcpServers, store.slotKey(s));
  if (cfg.builtinTools.length) options.tools = cfg.builtinTools; // positive bound; [] => full offers all, gated
  const bin = resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  // THE PER-SESSION MODEL. `s.model` survives park/resume and the post-sign-in relaunch for
  // free, because every one of those shapes re-enters through this one assembly point on the
  // SAME session object. `modelArg` re-coerces against the frozen enum HERE, at the last step
  // before the value becomes `--model` on a child process, so nothing upstream is trusted; a
  // 'default' (or anything unrecognized) sets no field at all, which is the CLI's own pick.
  const model = sessionModel.modelArg(s.model);
  if (model) options.model = model;
  if (s.resumeSdkId) options.resume = s.resumeSdkId;
  return options;
}

// H1 — SUPERSEDE the live query handles without touching lifecycle state. The consume
// loop below is tagged by its own `q`, so nulling `s.query` makes the previous loop inert
// (`s.query !== q` returns immediately, dropping its tail AND any late rejection); the
// abort stops the child process; closing the iterator ends the prompt stream it blocks on.
// Safe on a cold session, where every field is already null.
function abortInFlight(s) {
  try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
  try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
  s.query = null;
}

async function startQuery(s, sdk) {
  // H1 (THE TWO-CHILDREN BUG): this used to overwrite s.abortController / s.query with NO
  // teardown of what was already there. A second call therefore left the FIRST claude child
  // alive — still holding this session's pre-approved dopl_channel access, still able to
  // post into the channel — with nothing left pointing at it to stop it, and s.firstTurn
  // pushed twice. session-auth.resumeAfterSignIn is what made it reachable: a sign-in that
  // lands on a session a peer wake had already resumed, or simply a double-click on the
  // sign-in button. Superseding FIRST makes a relaunch idempotent at this layer, whatever
  // the caller does; a cold launch is unaffected (abortInFlight is a no-op there).
  abortInFlight(s);
  // 🔒 THE CONTAINER LOCK (plan §4.4 B1), minted before the options are assembled because
  // `buildSdkOptions` is SYNCHRONOUS and reads the stamp off `s`.
  // ⚠ THERE ARE EXACTLY TWO CALL SITES AND THAT IS NOT AN OVERSIGHT — this one and
  // `session-park.js › startResumedConsumer`. They are the two places a query STARTS: a woken
  // SPAWN-IDLE shell never passes through here (`startSession` returns before `startQuery`, and
  // `wakeEffects` fires `resumeQuery` -> `resumeParked`), so a single site here would leave every
  // woken shell on the unlocked device token. The call is IDEMPOTENT per session — an already
  // stamped session mints nothing — so the pair is safe and a resume of a live session is free.
  // ⚠ `session-audience-ceiling.test.mjs` pins BOTH sites by source scan: deleting either one
  // is silent otherwise, and the half it deletes is a whole spawn shape.
  await sessionCredential.ensureContainerCredential(s, diag);
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  const q = sdk.query({ prompt: s.pushIterator, options: buildSdkOptions(s) });
  s.query = q;
  s.pushIterator.push(io.userMessage(s.firstTurn));
  // C-4 — ARM THE LAUNCH WATCHDOG. The idle timer used to be armed ONLY by reducer effects
  // that require `launched`, which only the SDK's `system/init` dispatches — so a child that
  // booted and never emitted one had no timer of any kind: phase 'launching' forever,
  // `hasLiveSession` true, every retry `{skipped:'busy'}`, and its slot spent against
  // MAX_WINDOWS for the life of the process.
  //
  // HERE rather than in startSession, and that is the point of the seam: this is the ONE
  // deferred launch (H1's supersede-before-relaunch), so it covers the cold launch AND
  // session-auth's post-sign-in relaunch, which re-enters with phase reset to 'launching'
  // and would otherwise hang exactly the same way. It is the SAME `scheduleIdle` every other
  // arming site uses — `session-state.idleTimeout` reads the launching phase and answers the
  // launch bound — so there is no second timer to leak and `launched`'s own scheduleIdle
  // replaces this one the instant the session really starts.
  if (deps && deps.scheduleIdle) deps.scheduleIdle(s);
  consume(s, q); // fire-and-forget consumer loop
}

async function consume(s, q) {
  try {
    // FIX #1b: `q` tags this loop; a park->resume swaps s.query, so s.query !== q => SUPERSEDED (ignore its tail + late rejection).
    // Q6: an auth failure the CLI reports as CONTENT (its "Please run /login" line) is consumed here — the
    // dead-end bubble is REPLACED by the sign-in action, and this loop stops rather than rendering it.
    // THE CONTEXT METER reads the RAW stream, here rather than inside handleSdkMessage, because
    // what it needs is the LAST assistant message's own usage block — the prompt the model just
    // saw — and the render mapping deliberately drops everything that is not a render event.
    // It observes only; the reducer decides (session-model.observe -> dispatch `context`).
    for await (const msg of q) { if (s.query !== q) return; if (sessionAuth.holdIfAuthMessage(s, msg)) return; io.handleSdkMessage(s, msg, deps.dispatch, store); sessionModel.observe(s, msg, deps.dispatch); }
  } catch (err) {
    if (s.query !== q) return;
    if (!isAbortError(err)) {
      // Q6: an auth-shaped rejection surfaces the in-window "Sign in to Claude" instead of `crash`
      // (settle + destroy + task_failed{interrupted}). Every other error keeps that path unchanged.
      if (sessionAuth.holdIfAuthFailure(s, (err && err.message) || err)) return;
      diag('session-engine: query error', err && err.message);
      if (!s.settled) deps.dispatch(s, { type: 'crash' });
    }
  }
}

function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
}

module.exports = {
  bind,
  buildSdkOptions,
  abortInFlight,
  startQuery,
  consume,
  isAbortError,
};
