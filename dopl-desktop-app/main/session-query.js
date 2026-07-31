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
const { buildSessionToolConfig } = require('./session-profiles');
const { resolveClaudeExecutable, buildMcpServers, buildSecretPathDenyRules, buildScrubbedEnv } = require('./sdk-loader');

let deps = null; // { dispatch, emitQuiet }

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
    mcpServers: buildMcpServers(cfg.doplToolsPolicy, s.workspaceId),
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
  if (cfg.builtinTools.length) options.tools = cfg.builtinTools; // positive bound; [] => full offers all, gated
  const bin = resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
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
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  const q = sdk.query({ prompt: s.pushIterator, options: buildSdkOptions(s) });
  s.query = q;
  s.pushIterator.push(io.userMessage(s.firstTurn));
  consume(s, q); // fire-and-forget consumer loop
}

async function consume(s, q) {
  try {
    // FIX #1b: `q` tags this loop; a park->resume swaps s.query, so s.query !== q => SUPERSEDED (ignore its tail + late rejection).
    // Q6: an auth failure the CLI reports as CONTENT (its "Please run /login" line) is consumed here — the
    // dead-end bubble is REPLACED by the sign-in action, and this loop stops rather than rendering it.
    for await (const msg of q) { if (s.query !== q) return; if (sessionAuth.holdIfAuthMessage(s, msg)) return; io.handleSdkMessage(s, msg, deps.dispatch, store); }
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
