'use strict';

// session-triage.js — TIER 3's claim/pass pass (2026-08-28, Samuel's tiered-wake ruling).
//
// ONE QUESTION, ONE WORD, NO TOOLS. In a channel with two or more agents, a human message that
// names nobody buys each DORMANT candidate a single Haiku-class call that answers only "is this
// for me?". A claimant wakes; everybody else stays asleep and costs nothing further.
// `session-wake-tiers.js` owns the tier rule, the prompt and the output contract; this file owns
// the CALL — which model, on which credential, under which fence, with which budget.
//
// ── WHY IT REUSES THE SESSION AUTH PATH RATHER THAN AN API KEY ────────────────────────────────
// ⚠ THE DESKTOP HAS NO API KEY AND MUST NOT ACQUIRE ONE. A session authenticates through the
// BUNDLED `claude` binary against whatever this Mac already has — an auth env var, our own stored
// setup-token, or the CLI's own keychain sign-in (`session-auth.js › credentialState`) — and
// `@anthropic-ai/sdk` sitting in package.json is not that lane. So triage goes through the SAME
// `sdk.query` the engine spawns, with `env: sessionAuth.withStoredCredential(buildScrubbedEnv())`,
// which is byte-for-byte what `session-query.js › buildSdkOptions` hands a real session. One
// credential story, one place it can break, and a signed-out Mac produces no triage rather than a
// second, differently-shaped auth failure.
//
// ── THE FENCE ────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS RUN READS GUEST TEXT AND MUST NOT BE ABLE TO ACT ON IT. Four layers, and each closes a
// different door:
//   mcpServers: {}      no dopl server at all — no channel read, no post, no knowledge, and
//                       nothing to stamp a workspace against. A triage run cannot reach Dopl.
//   canUseTool: deny    EVERY tool call is refused. ⚠ THIS IS THE LOAD-BEARING ONE: the SDK has
//                       no "offer no tools" option (`options.tools = []` means NO BOUND, i.e.
//                       everything — `session-profiles.js`'s own note), so the positive bound
//                       cannot express what is wanted here and the gate has to.
//   maxTurns: 1         one assistant turn. Even a denied tool call cannot be retried.
//   permissionMode      'default' + `settingSources: []`, so no local settings file and no
//                       permission-mode knob can short-circuit that gate. `buildScrubbedEnv`
//                       already drops the env knobs and turns the claude.ai connector lane off.
// ⚠ `disallowedTools` CARRIES THE CREDENTIAL-PATH RULES ANYWAY (`buildSecretPathDenyRules`),
// belt to the gate's braces: a pre-approved read is SHADOWED past canUseTool in a real session,
// and copying the deny list costs nothing and cannot become the one difference that matters.
// ⚠ THE cwd IS THE OS TEMP DIR, NOT THE CHANNEL FOLDER. `channel-dirs.js › sessionSpawnDir` hands
// a real session the operator's chosen working directory; the router has no business knowing it
// exists, and no tool with which to look.
//
// ── COST, STATED AS A CEILING ────────────────────────────────────────────────────────────────
// Per HUMAN message, in a channel with N>1 agents and no @-mention: at most ONE call per DORMANT
// candidate on that thread, and dormant candidates are bounded by `MAX_CONCURRENT_SESSIONS` (6).
// Zero calls when the message @-mentions anybody, zero in a solo-agent room, zero for
// agent-authored or lifecycle traffic, zero for a running session (ruling 4's fan-out is not a
// wake and buys no triage). Each call is Haiku with ~1–2k input tokens (a capped persona, up to
// six capped prior lines, one capped message) and a ONE-TOKEN answer.
//
// ⚠ AND IT IS TIME-BOUNDED, because it runs INSIDE the listener's per-message dispatch and that
// dispatch holds the channel's cursor. `TRIAGE_TIMEOUT_MS` aborts the call and the abort answers
// PASS — a triage that cannot answer in time must not become a channel that stops draining.

const os = require('os');
const crypto = require('crypto');
const sessionAuth = require('./session-auth');
const sessionModel = require('./session-model');
const agentNames = require('./agent-names');
const wakeTiers = require('./session-wake-tiers');
const { getSdk, resolveClaudeExecutable, buildSecretPathDenyRules, buildScrubbedEnv } = require('./sdk-loader');
const { diag } = require('./diag');

// ⚠ THE DATED ID IS THE RULING'S OWN VALUE and it is coerced through the frozen table rather than
// spelled as argv. `session-model.js › aliasForModelId` maps it to the `haiku` ALIAS the bundled
// CLI resolves — that module's header explains why the alias is what reaches a child process, and
// why this exact id is the lossy row in that map. Naming the id here and the alias there is what
// keeps the ruling's value and the argv-safe value from drifting into two literals.
const TRIAGE_MODEL_ID = 'claude-haiku-4-5-20251001';

// The whole tier-3 pass, not one call. A candidate that answers in 7.9s and one that never
// answers cost the channel the same wall clock, because they run concurrently.
const TRIAGE_TIMEOUT_MS = 8_000;

// ⚠ A HARD CEILING ON TOP OF "one per dormant candidate", so a future widening of what counts as
// dormant cannot silently multiply the per-message cost. It is the same number as
// `session-windowless.js › MAX_CONCURRENT_SESSIONS` and is deliberately NOT imported from it:
// that one bounds how many agents may RUN, this bounds how many questions one message may buy,
// and tying them would make raising the concurrency ceiling silently raise the triage bill.
const MAX_TRIAGE_PER_MESSAGE = 6;

// ─── BEGIN SESSION-TRIAGE-PURE (injectable; unit-tested via source extraction) ─
// The block references its leaf deps (wakeTiers / agentNames / diag / the sdk-loader helpers /
// sessionAuth / sessionModel / os / crypto) as FREE VARS, so test/wake-tiers.test.mjs slices it,
// proves it holds no electron require, and drives it with a fake `query`.

/** What the router is told this agent IS. Three fields, each independently absent-tolerant:
 *  a never-renamed agent with no template still gets a well-formed prompt that simply says so. */
function personaFor(s) {
  const id = String((s && s.agentId) || '');
  const ctx = (s && s.context) || {};
  let name = '';
  let description = '';
  try {
    name = agentNames.displayNameFor(id) || '';
    description = agentNames.descriptionForAgent(id) || '';
  } catch (err) {
    // ⚠ A NAME LOOKUP MUST NEVER DECIDE A WAKE. `agent-names.js` is electron-store backed, and an
    // unreadable store is a reason to route on less information, never a reason to route nobody.
    diag('triage: persona lookup failed', err && err.message);
  }
  return {
    name: name || ('Agent #' + id),
    role: (ctx.template && ctx.template.name) || '',
    description: description,
  };
}

/** The SDK options ONE triage call runs with. See THE FENCE in this file's header — every field
 *  here is a fence, and there is nothing in it that is merely configuration. */
function triageOptions(abortController) {
  const options = {
    cwd: os.tmpdir(), // never the channel folder
    model: sessionModel.aliasForModelId(TRIAGE_MODEL_ID),
    maxTurns: 1,
    allowedTools: [], // nothing SHADOWED past the gate
    disallowedTools: buildSecretPathDenyRules(),
    mcpServers: {}, // no dopl surface at all
    settingSources: [],
    permissionMode: 'default',
    env: sessionAuth.withStoredCredential(buildScrubbedEnv()),
    abortController: abortController,
    includePartialMessages: false,
    // ⚠ THE ONLY THING THAT CAN EXPRESS "no tools" — see THE FENCE. Async because the SDK awaits
    // it; the shape is `session-io.js › makeCanUseTool`'s deny branch.
    canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'triage runs no tools' }),
  };
  const bin = resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  return options;
}

/** The text the model answered, or '' — the ONE place a raw model string is read. */
function answerText(msg) {
  if (!msg || msg.type !== 'result') return '';
  if (msg.subtype !== 'success') return ''; // an error result is a PASS, like everything else
  return typeof msg.result === 'string' ? msg.result : '';
}

/**
 * ONE candidate's claim/pass. Resolves to a BOOLEAN and never rejects: every failure mode —
 * no SDK, no credential, a timeout, a thrown query, a malformed answer, an injected answer —
 * is a PASS.
 *
 * ⚠ IT IS NOT "TRY AGAIN". A retry would double the bill for the one case (a flaky call) that
 * the solo tier and the @-mention both already route around, and would double the wall clock the
 * channel's cursor is held for.
 */
async function claimOne(sdk, s, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch (_) { /* best effort */ }
  }, TRIAGE_TIMEOUT_MS);
  try {
    const q = sdk.query({ prompt: prompt, options: triageOptions(controller) });
    for await (const msg of q) {
      const text = answerText(msg);
      if (!text) continue;
      const claimed = wakeTiers.parseTriage(text);
      diag('triage', String(s && s.agentId).slice(0, 8), claimed ? 'CLAIM' : 'pass');
      return claimed;
    }
    return false; // the stream ended without a result: nobody claimed
  } catch (err) {
    diag('triage: call failed —', (err && err.message) || err, '(reads as PASS)');
    return false;
  } finally {
    clearTimeout(timer);
    try { controller.abort(); } catch (_) { /* best effort */ }
  }
}

/**
 * THE TIER-3 PASS. Takes the DORMANT candidates in SPAWN ORDER and answers the agent id that
 * won, or '' when nobody claimed.
 *
 * ⚠ CONCURRENT CALLS, DETERMINISTIC WINNER. The calls are issued together so the channel waits
 * once rather than N times; the winner is `wakeTiers.firstClaim`, which resolves ties by SPAWN
 * ORDER and not by who answered first. Answer order is wall-clock noise and would make the same
 * room wake a different agent on a different day.
 *
 * ⚠ THE BUDGET IS APPLIED BEFORE ANY CALL IS MADE, by truncation rather than by refusal: an
 * over-budget room triages its OLDEST `MAX_TRIAGE_PER_MESSAGE` candidates and the rest stay
 * asleep. Refusing the whole pass would make a busy room stop answering guests entirely, which is
 * the failure this ruling exists to fix.
 */
async function claim(a) {
  const arg = a || {};
  const candidates = (arg.candidates || []).slice(0, MAX_TRIAGE_PER_MESSAGE);
  if (!candidates.length) return '';
  let sdk = arg.sdk || null;
  if (!sdk) {
    try {
      sdk = await getSdk();
    } catch (err) {
      diag('triage: no SDK —', err && err.message, '(nobody wakes)');
      return '';
    }
  }
  // ⚠ THE CREDENTIAL IS ASKED ONCE, HERE, and a machine with none triages nothing. Six calls that
  // will each fail auth are six child processes spent to learn one fact this probe already knows
  // (`session-auth.js › credentialState` is itself cached for 5s).
  try {
    if (!sessionAuth.credentialState().usable) {
      diag('triage: no Claude credential on this machine — nobody wakes');
      return '';
    }
  } catch (err) {
    diag('triage: credential probe failed', err && err.message);
    return '';
  }
  const nonce = crypto.randomUUID().slice(0, 8);
  const recent = wakeTiers.recentFor(arg.channelId);
  const results = await Promise.all(candidates.map((s) => claimOne(
    sdk,
    s,
    wakeTiers.triagePrompt({
      nonce: nonce,
      persona: personaFor(s),
      recent: recent,
      message: arg.message,
      author: arg.authorName,
    })
  )));
  const claimed = candidates.filter((_, i) => results[i] === true).map((s) => String((s && s.agentId) || ''));
  const winner = wakeTiers.firstClaim(candidates.map((s) => String((s && s.agentId) || '')), claimed);
  if (claimed.length > 1) {
    // ⚠ ON THE LINE ON PURPOSE. A room where every agent claims every message is a mis-set of
    // personas, and it is invisible from the outside — one agent answers, which is exactly what a
    // correct triage looks like too.
    diag('triage:', claimed.length, 'agents claimed; spawn order awarded it to', winner.slice(0, 8));
  }
  return winner;
}

// ─── END SESSION-TRIAGE-PURE ──────────────────────────────────────────────────

module.exports = {
  TRIAGE_MODEL_ID,
  TRIAGE_TIMEOUT_MS,
  MAX_TRIAGE_PER_MESSAGE,
  personaFor,
  triageOptions,
  answerText,
  claimOne,
  claim,
};
