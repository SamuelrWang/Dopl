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
// runtime's own bundled binary against whatever this Mac already has (`session-auth.js ›
// credentialState`), and a direct HTTP API client is not that lane. So triage goes through the
// SAME runtime a real session spawns on, with the SAME scrubbed env and stored credential —
// `main/runtime/claude/triage.js` builds it beside the launch spec so the two cannot diverge.
// One credential story, one place it can break, and a signed-out Mac produces no triage rather
// than a second, differently-shaped auth failure.
//
// ── THE FENCE ────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS RUN READS GUEST TEXT AND MUST NOT BE ABLE TO ACT ON IT, and the fence that stops it is
// the RUNTIME's to build — it is expressed in one platform's option vocabulary and has no meaning
// in another's. `main/runtime/claude/triage.js` holds it and carries the whole argument for each
// of its four layers (no MCP surface at all, a deny-everything gate because this platform cannot
// express "offer no tools", a one-turn bound, and ambient-config isolation).
// ⚠ AND IT IS DECLARED, NOT JUST BUILT: `descriptor.triage` names every layer, so a runtime that
// cannot express one of them says so instead of shipping this call with a layer silently missing.
// `turnBound: null` is launch-blocking — an unbounded triage turn reading untrusted text is an
// unfenced one.
//
// ── COST, STATED AS A CEILING ────────────────────────────────────────────────────────────────
// Per HUMAN message, in a channel with N>1 agents and no @-mention: at most ONE call per DORMANT
// candidate on that thread, and dormant candidates are bounded by `MAX_CONCURRENT_SESSIONS` (15
// since 2026-09-01).
// Zero calls when the message @-mentions anybody, zero in a solo-agent room, zero for
// agent-authored or lifecycle traffic, zero for a running session (ruling 4's fan-out is not a
// wake and buys no triage). Each call is Haiku with ~1–2k input tokens (a capped persona, up to
// six capped prior lines, one capped message) and a ONE-TOKEN answer.
//
// ⚠ AND IT IS TIME-BOUNDED, because it runs INSIDE the listener's per-message dispatch and that
// dispatch holds the channel's cursor. `TRIAGE_TIMEOUT_MS` aborts the call and the abort answers
// PASS — a triage that cannot answer in time must not become a channel that stops draining.

const crypto = require('crypto');
const sessionAuth = require('./session-auth');
const agentNames = require('./agent-names');
const wakeTiers = require('./session-wake-tiers');
const runtimeRegistry = require('./runtime');
const { diag } = require('./diag');

// ⚠ THE MODEL IS THE RUNTIME'S TO NAME, AND IT IS NEVER INHERITED FROM THE SESSION PICKER
// (2026-08-31): a router question is not the agent's work, and spending the operator's chosen
// model on it would make this tier's cost ceiling meaningless. Read off
// `descriptor.triage.model`, so the value and the argv coercion that spends it stay in one place
// — `main/runtime/claude/triage.js` carries the ruling's own id and why its map row is lossy.
const TRIAGE_MODEL_ID = runtimeRegistry.descriptorFor(null).triage.model;

// The whole tier-3 pass, not one call. A candidate that answers in 7.9s and one that never
// answers cost the channel the same wall clock, because they run concurrently.
const TRIAGE_TIMEOUT_MS = 8_000;

// ⚠ A HARD CEILING ON TOP OF "one per dormant candidate", so a future widening of what counts as
// dormant cannot silently multiply the per-message cost. It is the same number as
// `session-windowless.js › MAX_CONCURRENT_SESSIONS` and is deliberately NOT imported from it:
// that one bounds how many agents may RUN, this bounds how many questions one message may buy,
// and tying them would make raising the concurrency ceiling silently raise the triage bill.
//
// ⚠ RAISED 6 → 15 ON 2026-09-01, BY HAND, WITH THE CONCURRENCY CEILING — and the reason it had to
// move is the TRUNCATION. This cap does not REFUSE the overflow, it SLICES it (see `triage` below:
// the oldest N candidates are asked and the rest simply stay dormant). So leaving it at 6 under a
// cap of 15 would not have cost money, it would have cost WAKES: past the sixth dormant agent in a
// room, a candidate could never be triaged and therefore could never be woken by an unaddressed
// human message. A silent, order-dependent hole in the wake path is a worse bug than a bigger
// bill, which is why the two numbers are still equal and still not imported from one another.
const MAX_TRIAGE_PER_MESSAGE = 15;

// ─── BEGIN SESSION-TRIAGE-PURE (injectable; unit-tested via source extraction) ─
// The block references its leaf deps (wakeTiers / agentNames / diag / sessionAuth /
// runtimeRegistry / crypto) as FREE VARS, so the harness slices it, proves it holds no electron
// require, and drives it with a fake runtime.

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

/**
 * ONE candidate's claim/pass. Resolves to a BOOLEAN and never rejects: every failure mode —
 * no SDK, no credential, a timeout, a thrown query, a malformed answer, an injected answer —
 * is a PASS.
 *
 * ⚠ IT IS NOT "TRY AGAIN". A retry would double the bill for the one case (a flaky call) that
 * the solo tier and the @-mention both already route around, and would double the wall clock the
 * channel's cursor is held for.
 */
async function claimOne(rt, s, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch (_) { /* best effort */ }
  }, TRIAGE_TIMEOUT_MS);
  try {
    // ⚠ TWO VERBS AND NOTHING ELSE. `start()` runs the fenced call the adapter built; `answerText`
    // is the ONE place a raw model string is read, and it is the adapter's because the shape it
    // reads is. Everything around them — the 8s bound, the concurrency, the deterministic
    // tie-break and the budget ceiling below — is Dopl's and identical on every runtime.
    const run = rt.triageSpec({ prompt: prompt, abortController: controller });
    // ⚠ `null` IS A DECLARED ANSWER, NOT A FAILURE, AND IT USED TO BE LOGGED AS ONE (fixed
    // 2026-08-31, wave D). `contract.js › RUNTIME_METHODS` documents `triageSpec` as "the opaque
    // triage launch payload, OR `null`", and two of the three shipped adapters answer `null` on
    // purpose — a runtime with no `maxTurns` analogue and no "offer no tools" option cannot fence
    // a call that reads untrusted guest text, so it declines to make one. Without this branch the
    // `null` fell through to `run.start()`, and the `catch` below reported
    // `"triage: call failed — Cannot read properties of null (reading 'start') (reads as PASS)"`.
    // Three things were wrong with that line and only the verdict was right: NO CALL WAS MADE, so
    // "call failed" is false; a TypeError string was being read by an operator as a platform
    // fault; and it fired once per dormant candidate per guest message, forever, on a runtime
    // behaving exactly as designed — which is how a log stops being somewhere real failures show.
    // ⚠ THE VERDICT IS UNCHANGED AND MUST BE: a runtime that cannot triage does not claim, which
    // is the same outcome as losing the race. Nothing hangs and nothing is granted.
    if (!run) {
      diag('triage', String(s && s.agentId).slice(0, 8),
        'pass — this runtime declares no triage shape, so no call was made');
      return false;
    }
    const q = run.start();
    for await (const msg of q) {
      const text = run.answerText(msg);
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
  let rt = arg.runtime || null;
  if (!rt) {
    try {
      rt = runtimeRegistry.runtimeFor(arg.runtimeId);
      const gate = await rt.available();
      if (!gate.ok) throw new Error(gate.reason);
    } catch (err) {
      diag('triage: no agent runtime —', err && err.message, '(nobody wakes)');
      return '';
    }
  }
  // ⚠ THE CREDENTIAL IS ASKED ONCE, HERE, and a machine with none triages nothing. Six calls that
  // will each fail auth are six child processes spent to learn one fact this probe already knows
  // (`session-auth.js › credentialState` is itself cached for 5s).
  try {
    if (!sessionAuth.credentialState().usable) {
      diag('triage: no agent-runtime credential on this machine — nobody wakes');
      return '';
    }
  } catch (err) {
    diag('triage: credential probe failed', err && err.message);
    return '';
  }
  const nonce = crypto.randomUUID().slice(0, 8);
  const recent = wakeTiers.recentFor(arg.channelId);
  const results = await Promise.all(candidates.map((s) => claimOne(
    rt,
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
  TRIAGE_MODEL_ID, // read off `descriptor.triage.model` — the ruling's value lives with the fence
  TRIAGE_TIMEOUT_MS,
  MAX_TRIAGE_PER_MESSAGE,
  personaFor,
  claimOne,
  claim,
};
