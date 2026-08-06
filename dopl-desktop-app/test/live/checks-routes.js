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
    // PRESENCE IS POST-ONLY — it is a heartbeat, not a read. A GET here answers 405, which
    // the first draft of this table recorded as a route failure. The 405 is the route being
    // right; asserting it is what pins the verb.
    ['POST /api/channels/presence', () => api.presence(id), (s) => okish(s) || refusal(s)],
    ['GET  /api/channels/presence (405 expected)', () => api.request('GET', '/api/channels/presence'), (s) => s === 405],
    // 404 IS AN ALLOWED ANSWER HERE, and only here: the route ships in this working tree but
    // is not deployed until master is pushed. Check 10 is the one that reads what that 404
    // means; this row only asserts it is not a 5xx.
    ['GET  /api/channels/sessions', () => api.sessions(id), (s) => okish(s) || absent(s)],
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
 * THE AGENT ROUTE'S SURVIVING HALF, AND ITS DEAD ONES.
 *
 * "Named agents are gone" does NOT mean this route is gone, and the first draft of this
 * check got that backwards — it read a correct 200 as residue. `GET .../agents` survives
 * DELIBERATELY, for one consumer: the transcript resolving a stored `metadata.author_agent_id`
 * back to the handle it rendered under. THE MESSAGES OUTLIVE THE FEATURE. It is the same
 * call as `agent-names.ts` staying in the web tree — the role changed rather than expired,
 * so deleting it removes a guard, not residue. Its own docblock says to delete it when
 * historical attribution stops mattering, not before.
 *
 * What DID die is the lifecycle: `POST` (summon) here, and rename / status / disengage at
 * `agents/[agentId]`. Those are what this check asserts are gone — a write verb still
 * answering would mean the summon lifecycle is reachable with no model behind it.
 */
async function checkRetiredRoutes(ctx) {
  const id = ctx.channel.id;
  const fails = [];
  const lines = [];

  const read = await ctx.api.agentsRoute(id);
  lines.push(`GET  /{id}/agents -> ${read.status} (kept: historical attribution)`);
  if (!okish(read.status)) {
    fails.push(
      `GET /api/channels/{id}/agents answered ${read.status}. It is KEPT on purpose — the ` +
        'transcript resolves stored author_agent_id values through it, and old messages still ' +
        'render. Losing it silently breaks attribution on every historical row.'
    );
  }

  // The summon verb. 404/405/410 all mean "gone"; a 2xx means it still summons.
  const summon = await ctx.api.request('POST', `/api/channels/${id}/agents`, { name: 'hxprobe' });
  lines.push(`POST /{id}/agents -> ${summon.status} (must be gone)`);
  if (okish(summon.status)) {
    fails.push(`POST /api/channels/{id}/agents answered ${summon.status} — summon is still reachable`);
  } else if (summon.status >= 500) {
    fails.push(`the retired summon verb answered ${summon.status} rather than a clean refusal`);
  }

  return verdict(fails, { extraLines: lines });
}

/**
 * `read_sessions` DEGRADES, IT DOES NOT 500. This is the defect the three-lens review
 * found: three code comments and a finding all claimed graceful degradation that the code
 * did not have. It degrades on PGRST205 now — this asserts that against the real server,
 * whichever side of the migration it is on.
 */
async function checkSessionsDegrade(ctx) {
  const res = await ctx.api.sessions(ctx.channel.id);

  // A 404 IS THE ROUTE NOT BEING DEPLOYED, which is a different fact from the route
  // degrading well — and the first draft of this check PASSED on it, silently, by falling
  // through both branches. That is the vacuous pass this harness is not allowed to report:
  // check 7 was failing on the same 404 in the same run. SKIP names it instead.
  if (absent(res.status)) {
    return result(
      SKIP,
      `GET /api/channels/sessions answered ${res.status} — the route is not deployed on this ` +
        'target, so the degrade path cannot be exercised. It ships in this working tree; push ' +
        'master and re-run.'
    );
  }
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
  } else {
    fails.push(`GET /api/channels/sessions answered ${res.status}, which is neither a success, a 404, nor a 5xx`);
  }
  return verdict(fails, { extraLines: [`GET /api/channels/sessions -> ${res.status}`] });
}

module.exports = {
  checkRouteCoverage,
  checkAuthBoundary,
  checkRetiredRoutes,
  checkSessionsDegrade,
};
