'use strict';

// LIVE CONTRACT HARNESS — THE CHECK REGISTRAR.
//
// This file is the ORDERED LIST and the surface `run.js` imports; the check bodies are one
// file per lane, and everything two lanes both need is in `checks-shared.js`. Same
// registrar/sibling pattern as the op-dispatched MCP tools (ENGINEERING.md §2).
//
//   checks-transport.js  POST /api/mcp — the JSON-RPC/SSE envelope, the catalogue, the
//                        refusals, strict args, and the X-Dopl-Runtime stamp.
//   checks-routes.js     the 13 /api/channels/** routes, the auth boundary, the retired
//                        roster route, and the read_sessions degrade path.
//   checks-contract.js   the server/desktop seam — the reserved-key strip, the `intent`
//                        round trip, and the author_kind loop brake.
//
// ── ORDER IS DELIBERATE ────────────────────────────────────────────────────────────
// Transport first: if the envelope is broken, every MCP assertion below it is noise, and a
// reader scanning the output should see the cause before the symptoms. Routes second, since
// the contract lane's messages are posted through them. Contract last — it is the lane that
// asserts on meaning rather than on plumbing.
//
// ── THE THREE VERDICTS ─────────────────────────────────────────────────────────────
//   PASS  the server did the thing and the desktop read it correctly.
//   FAIL  the server did the thing and the desktop read it WRONG, or the server did the
//         wrong thing. The only verdict that turns the exit code red.
//   SKIP  the target server does not implement this part of the contract yet, or the
//         CONTROL a negative claim depends on could not be armed. Never a dodge: the
//         reason names the exact missing field, and a check that cannot earn its pass
//         says so rather than reporting one.

const {
  checkInitialize,
  checkToolsList,
  checkToolCallRoundTrip,
  checkTransportRefusals,
  checkStrictArgs,
  checkRuntimeStamp,
} = require('./checks-transport');
const {
  checkRouteCoverage,
  checkAuthBoundary,
  checkRetiredRoutes,
  checkSessionsDegrade,
} = require('./checks-routes');
const {
  checkReservedKeyStrip,
  checkIntentRoundTrip,
  checkLoopBrake,
} = require('./checks-contract');
const { CAP_WHY, PASS, FAIL, SKIP, wireOf, readOf, short } = require('./checks-shared');

const CHECKS = [
  { id: 1, title: 'POST /api/mcp — a valid initialize returns parseable JSON-RPC', run: checkInitialize },
  { id: 2, title: 'tools/list names dopl_channel (and NOT the retired to_agent)', run: checkToolsList },
  { id: 3, title: 'a real op round-trips through the SSE frame parser', run: checkToolCallRoundTrip },
  { id: 4, title: 'unknown method / unknown tool / malformed body are REFUSED, not accepted', run: checkTransportRefusals },
  { id: 5, title: 'a REMOVED parameter is an error, not a silent strip (F-145)', run: checkStrictArgs },
  { id: 6, title: 'X-Dopl-Runtime survives the round trip (and the control carries none)', run: checkRuntimeStamp },
  { id: 7, title: 'every /api/channels/** route answers, and none 500s', run: checkRouteCoverage },
  { id: 8, title: 'an UNAUTHENTICATED call to the API is refused', run: checkAuthBoundary },
  { id: 9, title: 'the retired summon-era roster route is gone', run: checkRetiredRoutes },
  { id: 10, title: 'read_sessions DEGRADES on a missing table, it does not 500', run: checkSessionsDegrade },
  { id: 11, title: 'every reserved metadata key is stripped off an inbound post', run: checkReservedKeyStrip },
  { id: 12, title: 'the `intent` round trip (and the control that sends none)', run: checkIntentRoundTrip },
  { id: 13, title: 'author_kind loop brake — agent-authored triggers nobody, human control DOES', run: checkLoopBrake },
];

module.exports = { CHECKS, CAP_WHY, PASS, FAIL, SKIP, wireOf, readOf, short };
