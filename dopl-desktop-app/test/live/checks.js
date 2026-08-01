'use strict';

// LIVE CONTRACT HARNESS — THE NINE CONTRACTS.
//
// Every one of these is a bug that SHIPPED, and every one was invisible to a green suite,
// because each layer's tests encode that layer's own assumptions. The shape they share is
// WHAT THE SERVER ACTUALLY SENDS vs WHAT THE DESKTOP ACTUALLY READS, so each check asserts
// on BOTH halves of one real message: the metadata the live API returned, and the verdict
// the shipped desktop modules reach when handed that exact object.
//
// Each is evaluated TWICE — once as the sender's machine, once as the peer's — because
// "routes to the owner only" and "routes to nobody" are different claims and a one-sided
// evaluation cannot tell them apart.
//
// ── THE THREE VERDICTS, AND WHY SKIP IS NOT A DODGE ────────────────────────────────
//   PASS  the server sent the field and the desktop read it correctly.
//   FAIL  the server sent the field and the desktop read it WRONG. This is the whole
//         point of the lane, and it is the only thing that turns the exit code red.
//   SKIP  THE TARGET SERVER DOES NOT IMPLEMENT THIS PART OF THE CONTRACT YET — or, for
//         `engagement_stamped`, IT REFUSES THE STATE TO THIS CALLER'S CREDENTIAL. The reason
//         names the exact missing field, and the run's CAPABILITY block lists every gap up
//         top. Failing here would be noise: "prod is older than this working tree" is a
//         deploy fact, not a desktop bug, and a harness that cries wolf about it stops
//         being read. The capabilities are PROBED off the live wire every run, so the day
//         the wave deploys these checks arm themselves with no edit here.
//
// ── AND THE FOURTH VERDICT, WHICH IS NOT ALLOWED: A VACUOUS PASS ───────────────────
// Half of these checks assert that NOTHING happened, and "nothing happened" is free in a
// room where nothing could have happened. So every negative claim here is paired with a
// CONTROL — the same real message with ONE field changed, run through the same real modules
// — and the check passes only on the DIFFERENCE. Checks 1 and 5 share one control post; the
// scalar-only replay in check 3 is the same idea. When a control cannot be armed at all, the
// check SKIPs and names what could not be armed. It never reports a pass it did not earn.
//
// ── WHERE THE BODIES LIVE (§2 split, 2026-08-01) ──────────────────────────────────
// This file is the REGISTRAR: the ordered list below, and the surface `run.js` imports. The
// checks themselves are one file per lane, and everything two lanes both need is in
// `checks-shared.js` (the verdict constructors, the wire/desktop line formatters, `base`).
//   checks-room.js    1-5 and 9 — the main room: chat vs request, addressing, multi-address,
//                     the operator's own message, the loop brake, and the milestone KIND.
//   checks-thread.js  6-8 — breakout rooms and what an agent can actually see.
const {
  checkChatNoMentions,
  checkMentionRoutesToOwnerOnly,
  checkMultiAddress,
  checkOwnMessageToOwnAgent,
  checkAgentAuthoredUnaddressed,
  checkMilestoneKindDelivers,
} = require('./checks-room');
const { checkThreadDelivery, checkHandshake, checkAgentVisibility } = require('./checks-thread');
const { CAP_WHY, PASS, FAIL, SKIP, wireOf, readOf, short } = require('./checks-shared');

const CHECKS = [
  { id: 1, title: 'chat + no mentions decides NOTHING — and the control that DOES feed', run: checkChatNoMentions },
  { id: 2, title: 'an @-named agent is routed to, on the owner machine only', run: checkMentionRoutesToOwnerOnly },
  { id: 3, title: 'two addressed agents BOTH routed (and what the compat scalar loses)', run: checkMultiAddress },
  { id: 4, title: "the operator's OWN message to their OWN agent routes", run: checkOwnMessageToOwnAgent },
  { id: 5, title: 'agent-authored + unaddressed triggers nobody (human control DOES)', run: checkAgentAuthoredUnaddressed },
  { id: 6, title: 'a thread-tagged agent post reaches the OTHER participant agent', run: checkThreadDelivery },
  { id: 7, title: 'handshake seeds participants; the non-opening agent can post', run: checkHandshake },
  { id: 8, title: 'what read / await actually render for an agent-addressed message', run: checkAgentVisibility },
  { id: 9, title: 'an ADDRESSED kind="task_progress" is delivered (unaddressed one is not)', run: checkMilestoneKindDelivers },
];

module.exports = { CHECKS, CAP_WHY, PASS, FAIL, SKIP, wireOf, readOf, short };
