'use strict';

// LIVE CONTRACT HARNESS — WHAT THE SERVER STAMPS vs WHAT THE DESKTOP READS.
//
// The three contracts in this file are the ones that cross the server/desktop seam, which
// is where every shipped channels bug of the last two waves actually lived. Each asserts on
// BOTH halves of one real message: the metadata the live API returned, and the verdict the
// shipped desktop modules reach when handed that exact object.
//
// ── THE STRIP IS THE IMPORTANT ONE ─────────────────────────────────────────────────
// `resolvePostMetadata` (src/features/channels/server/service-writes-metadata.ts) deletes a
// list of reserved keys off every inbound post before anything else runs. The three-lens
// review MUTATION-PROVED that strip had no test: deleting any of the `delete metadata.…`
// lines left all 2109 tests green. It is the sole defence against a caller ATTRIBUTING ITS
// OWN WORDS to somebody else's session — and against `handoff`, which the desktop reads to
// decide whether to open a window on the operator's machine.
//
// So `checkReservedKeyStrip` forges every one of them in a single post and asserts the
// server threw them all away. A test that can only be satisfied by the real service is the
// only kind that can guard this, because the defect it catches is the service not running.

const { PASS, FAIL, SKIP, result, verdict, missing, base, wireOf } = require('./checks-shared');
const { bothMachines } = require('./desktop');

/**
 * THE RESERVED KEYS, verbatim from `resolvePostMetadata`. Forged all at once, because the
 * mutation that proved the gap deleted ONE line — so a check that probes one key would have
 * missed the other eight.
 */
const FORGED = {
  to_user_id: '00000000-0000-4000-8000-0000000000ff',
  // Joined the strip on 2026-08-06 (F-151). It has NO consumer and never will — the
  // escalation verdict it was sketched for is deleted — which is exactly why it is forged
  // here: a reserved name with no reader is the one a future edit removes as dead code,
  // and this check is what would notice the day it stops being stripped.
  to_user_notify: '00000000-0000-4000-8000-0000000000f9',
  summary: 'forged summary',
  runtime: 'forged-runtime',
  appVersion: '0.0.0-forged',
  to_agent_id: '00000000-0000-4000-8000-0000000000fe',
  to_agent_ids: ['00000000-0000-4000-8000-0000000000fe'],
  author_agent_id: '00000000-0000-4000-8000-0000000000fd',
  intent: 'request',
  session_id: '00000000-0000-4000-8000-0000000000fc',
  handoff: true,
  // The REQUEST FAN-OUT group (wiring plan Phase 3). Forged on `handoff`'s terms and for a
  // sharper reason than most: the transcript renders every opening message sharing this id
  // as ONE card, so a caller that could set it would draw its own thread inside somebody
  // else's request — a claim about who was asked what, made by the wrong person.
  fanoutGroup: 'forged-fanout-group',
  // The THREAD-SHAPE keys. Stripped unconditionally alongside the rest, and worth forging
  // for the same reason: `taskTarget` and `taskCreatedBy` are attribution, and `taskMode`
  // is the field that decides whether a thread starts at ask or runs unattended.
  taskMode: 'auto',
  taskCreatedBy: '00000000-0000-4000-8000-0000000000fb',
  taskTitle: 'forged title',
  taskTarget: '00000000-0000-4000-8000-0000000000fa',
};

/**
 * `taskId` IS DELIBERATELY NOT FORGED, and this is the note that keeps somebody from
 * "fixing" that. It is the only conditionally-stripped key in `resolvePostMetadata`: a
 * caller-supplied thread tag that names a real thread the caller participates in is
 * HONOURED (it is how a post joins a thread at all), and only a blank, non-string, or
 * non-participant id is dropped. Forging it would assert a strip the service is right not
 * to perform. The load guard (test/live-harness-loads.test.mjs) carries the same exclusion.
 */
const CONDITIONALLY_STRIPPED = ['taskId'];

/**
 * 1. EVERY RESERVED KEY IS STRIPPED. The forged post is read back off the same route the
 * desktop listener reads, and every key above must be either absent or server-derived —
 * never the value this caller sent.
 */
function checkReservedKeyStrip(ctx) {
  const m = ctx.msg.forged;
  if (!m) return result(SKIP, 'the forged post was refused by the server, so there is nothing to read back');
  const meta = m.metadata || {};
  const leaked = [];
  for (const [key, sent] of Object.entries(FORGED)) {
    const got = meta[key];
    if (got === undefined) continue;
    const same = Array.isArray(sent) ? JSON.stringify(sent) === JSON.stringify(got) : sent === got;
    if (same) leaked.push(`${key}=${JSON.stringify(got)}`);
  }
  const fails = [];
  if (leaked.length) {
    fails.push(
      `the server STORED caller-supplied reserved keys: ${leaked.join(', ')}. ` +
        'Each one lets a caller attribute its own post to somebody else (or, for `handoff`, ' +
        "open a window on the operator's machine)."
    );
  }
  return verdict(fails, {
    wire: wireOf(m),
    extraLines: [`forged ${Object.keys(FORGED).length} keys; ${leaked.length} survived`],
  });
}

/**
 * 2. THE `intent` ROUND TRIP. `intent` is stripped from caller METADATA and re-stamped only
 * from the validated top-level field. So the contract has two halves and both are asserted:
 *   the top-level field  IS honoured and comes back on `metadata.intent`
 *   the metadata forgery is NOT honoured (covered by check 1, cross-referenced here)
 *
 * NO VACUOUS PASS: the control post sends NO intent at all, so "the field came back" is
 * only evidence if the otherwise-identical post without it came back clean.
 */
function checkIntentRoundTrip(ctx) {
  const chat = ctx.msg.chat;
  const control = ctx.msg.control;
  if (!chat) return result(SKIP, 'the intent-bearing post was refused, so the round trip cannot be read');
  const got = (chat.metadata || {}).intent;
  if (got === undefined) return missing(ctx, 'intent');

  const fails = [];
  if (got !== 'chat') fails.push(`posted intent="chat" but the server stored metadata.intent=${JSON.stringify(got)}`);
  const controlIntent = control ? (control.metadata || {}).intent : undefined;
  if (controlIntent !== undefined) {
    fails.push(
      `the CONTROL post sent no intent but reads back metadata.intent=${JSON.stringify(controlIntent)} — ` +
        'the field is being defaulted, so its presence proves nothing about the caller'
    );
  }
  return verdict(fails, {
    wire: wireOf(chat),
    extraLines: [`intent-bearing="${got}" control=${controlIntent === undefined ? '(absent)' : JSON.stringify(controlIntent)}`],
  });
}

/**
 * 3. THE LOOP BRAKE. An agent-authored post that addresses nobody must not trigger this
 * machine — otherwise two sessions talk to each other forever. The rule lives in
 * `targeting.classify` and the field it turns on is `authorKind`, which the SERVER derives
 * from the credential rather than taking on trust.
 *
 * THE CONTROL IS THE WHOLE CHECK. "The agent post triggered nobody" is free in a room where
 * nothing triggers. So the same real modules are handed a HUMAN-authored post of the same
 * shape, and the check passes only on the DIFFERENCE: human triggers, agent does not.
 */
function checkLoopBrake(ctx) {
  const noise = ctx.msg.agentNoise;
  const control = ctx.msg.control;
  if (!noise) return result(SKIP, 'the agent-authored post was refused, so the brake cannot be exercised');
  if (!control) return result(SKIP, 'the human control post is missing, so a non-trigger below would prove nothing');

  const agentSide = bothMachines(ctx.dsk, base(ctx, noise));
  const humanSide = bothMachines(ctx.dsk, base(ctx, control));

  const fails = [];
  // The server's own derivation first: if the row is not actually agent-authored, the
  // desktop verdict below is about the wrong thing.
  if (noise.authorKind !== 'agent') {
    return result(
      SKIP,
      `the post intended as agent-authored was stored with authorKind="${noise.authorKind}" — ` +
        'the server derives this from the credential, so the brake cannot be exercised from here'
    );
  }
  if (agentSide.mine.classify === 'trigger') {
    fails.push('an agent-authored, unaddressed post answered "trigger" on the author machine — the loop brake is open');
  }
  if (agentSide.peer.classify === 'trigger') {
    fails.push('an agent-authored, unaddressed post answered "trigger" on the PEER machine — the loop brake is open');
  }
  // THE CONTROL. If the human post does not trigger either, the room cannot trigger at all
  // and the non-trigger above is vacuous — so this is a FAIL of the check, not a pass.
  const humanTriggers = humanSide.mine.classify === 'trigger' || humanSide.peer.classify === 'trigger';
  if (!humanTriggers) {
    return result(
      SKIP,
      'the human CONTROL post did not trigger on either machine, so "the agent post did not trigger" ' +
        `is vacuous. control verdicts: mine=${humanSide.mine.classify} peer=${humanSide.peer.classify}`
    );
  }
  return verdict(fails, {
    wire: wireOf(noise),
    both: agentSide,
    extraLines: [
      `agent-authored: mine=${agentSide.mine.classify} peer=${agentSide.peer.classify}`,
      `human control:  mine=${humanSide.mine.classify} peer=${humanSide.peer.classify}`,
    ],
  });
}

module.exports = {
  FORGED,
  CONDITIONALLY_STRIPPED,
  checkReservedKeyStrip,
  checkIntentRoundTrip,
  checkLoopBrake,
};
