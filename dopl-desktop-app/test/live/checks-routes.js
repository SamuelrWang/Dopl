'use strict';

// LIVE CONTRACT HARNESS — THE REST ROUTE LANE.
//
// THIRTEEN `route.ts` files live under `src/app/api/channels/**` and none of them had a
// live test. This lane's job is COVERAGE FIRST: every route is actually called, against a
// real server, with a real credential, and the run prints which ones answered what. A route
// that 500s, or that answers 200 to a caller who should be refused, is the failure this
// catches — and neither is visible to a unit test that mocks the handler's dependencies.
//
// ── WHAT "PASS" MEANS HERE, AND WHY IT IS NOT "200 OK" ─────────────────────────────
// Several of these routes SHOULD refuse this caller. The harness holds a DEVICE TOKEN,
// which is an agent credential, and the product deliberately gates some ops behind a human
// one. So the assertion is never "it returned 200" — it is "it returned something in the
// set this route is allowed to return", with 5xx excluded everywhere. A 500 is always a
// failure: it means the handler fell over rather than deciding.
//
// ── THE TWO ASSERTIONS THAT ARE NOT COVERAGE ───────────────────────────────────────
//   `checkAuthBoundary`   an UNAUTHENTICATED call to a real route must be refused. This is
//                         the one check that would catch a middleware matcher edit
//                         accidentally exposing the API — which is a Stage E change.
//   `checkRetiredRoutes`  the summon-era routes must be GONE. F-141 removed the model;
//                         a route still answering is a capability with no model behind it.

const { PASS, FAIL, SKIP, result, verdict } = require('./checks-shared');

/** Status sets a route is ALLOWED to answer. 5xx is never in one. */
const okish = (s) => s >= 200 && s < 300;
const refusal = (s) => s === 401 || s === 403;
const absent = (s) => s === 404 || s === 410;

/**
 * COVERAGE. Every channels route, called for real. The table is the contract: a route
 * added to the tree and not added here shows up as a gap in the printed count, not as a
 * silent omission.
 */
async function checkRouteCoverage(ctx) {
  const { api, channel } = ctx;
  const id = channel.id;
  const thread = ctx.thread;

  const calls = [
    ['GET  /api/channels', () => api.listChannels(), okish],
    ['GET  /api/channels/{id}', () => api.request('GET', `/api/channels/${id}`), okish],
    ['GET  /api/channels/{id}/members', () => api.members(id), okish],
    ['GET  /api/channels/{id}/messages', () => api.request('GET', `/api/channels/${id}/messages?since=0&limit=5`), okish],
    ['POST /api/channels/{id}/messages', () => api.post(id, {
      body: 'live harness: route coverage probe — automated, no action needed.',
      authorKind: 'user',
      clientMsgId: `harness-${ctx.stamp}-cover`,
    }), okish],
    ['GET  /api/channels/{id}/await', () => api.awaitRoute(id, ctx.lastSeq || 0), (s) => okish(s) || s === 408],
    ['GET  /api/channels/{id}/tasks', () => api.listThreads(id), okish],
    ['GET  /api/channels/consent', () => api.consent(id), (s) => okish(s) || refusal(s)],
    ['GET  /api/channels/presence', () => api.presence(id), (s) => okish(s) || refusal(s)],
    ['GET  /api/channels/sessions', () => api.sessions(id), okish],
    ['GET  /api/channels/trust', () => api.trust(), (s) => okish(s) || refusal(s)],
  ];
  if (thread) {
    calls.push(['GET  /api/channels/{id}/tasks/{taskId}', () => api.thread(id, thread.id), okish]);
  }

  const fails = [];
  const lines = [];
  for (const [label, run, allowed] of calls) {
    let res;
    try {
      res = await run();
    } catch (err) {
      fails.push(`${label} THREW: ${err && err.message}`);
      lines.push(`${label} -> threw`);
      continue;
    }
    lines.push(`${label} -> ${res.status}`);
    if (res.status >= 500) fails.push(`${label} answered ${res.status} (server error): ${String(res.text).slice(0, 200)}`);
    else if (!allowed(res.status)) fails.push(`${label} answered ${res.status}, which is outside its allowed set`);
  }
  if (!thread) lines.push('GET  /api/channels/{id}/tasks/{taskId} -> not exercised (no thread was opened)');

  return verdict(fails, { extraLines: lines });
}

/**
 * THE AUTH BOUNDARY. The same route, with no credential, must be refused. Guards the
 * middleware matcher — the thing Stage E edits.
 *
 * NO VACUOUS PASS: the authenticated control runs in the same check, so "refused" is only
 * reported against a route that demonstrably answers when it should.
 */
async function checkAuthBoundary(ctx) {
  const url = `${ctx.api.baseUrl}/api/channels`;
  const control = await ctx.api.listChannels();
  if (!okish(control.status)) {
    return result(SKIP, `the authenticated control call answered ${control.status}, so an anonymous refusal proves nothing`);
  }
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return result(FAIL, `the anonymous call threw: ${err && err.message}`);
  }
  const fails = [];
  if (okish(res.status)) fails.push(`GET /api/channels answered ${res.status} WITH NO CREDENTIAL — the API is exposed`);
  else if (res.status >= 500) fails.push(`the anonymous call produced a ${res.status} rather than a clean refusal`);
  else if (!refusal(res.status) && !absent(res.status) && res.status !== 302) {
    fails.push(`the anonymous call answered ${res.status}, which is neither a refusal nor a redirect`);
  }
  return verdict(fails, {
    extraLines: [`authed ${control.status} / anonymous ${res.status}`],
  });
}

/**
 * THE RETIRED ROUTES. Named agents are gone for good (settled decision, rollback §5). A
 * server still answering the roster route is serving a model that no longer exists.
 */
async function checkRetiredRoutes(ctx) {
  const id = ctx.channel.id;
  const res = await ctx.api.agentsRoute(id);
  const fails = [];
  if (okish(res.status)) {
    fails.push(
      `GET /api/channels/{id}/agents answered ${res.status} — the summon-era roster route is ` +
        `still live. Body: ${String(res.text).slice(0, 200)}`
    );
  } else if (res.status >= 500) {
    fails.push(`the retired route answered ${res.status} rather than a clean 404/410`);
  }
  return verdict(fails, { extraLines: [`GET /{id}/agents -> ${res.status}`] });
}

/**
 * `read_sessions` DEGRADES, IT DOES NOT 500. This is the defect the three-lens review
 * found: three code comments and a finding all claimed graceful degradation that the code
 * did not have. It degrades on PGRST205 now — this asserts that against the real server,
 * whichever side of the migration it is on.
 */
async function checkSessionsDegrade(ctx) {
  const res = await ctx.api.sessions(ctx.channel.id);
  const fails = [];
  if (res.status >= 500) {
    fails.push(
      `GET /api/channels/sessions answered ${res.status}. If the channel_sessions table is ` +
        `absent this MUST degrade to an empty read, not fail: ${String(res.text).slice(0, 300)}`
    );
  } else if (okish(res.status)) {
    const list = (res.json && (res.json.sessions || res.json.entries)) || null;
    if (!Array.isArray(list)) fails.push(`200 OK but no sessions array in the body: ${String(res.text).slice(0, 200)}`);
    ctx.caps.sessions_table = Array.isArray(list) && list.length > 0;
  }
  return verdict(fails, { extraLines: [`GET /api/channels/sessions -> ${res.status}`] });
}

module.exports = {
  checkRouteCoverage,
  checkAuthBoundary,
  checkRetiredRoutes,
  checkSessionsDegrade,
};
