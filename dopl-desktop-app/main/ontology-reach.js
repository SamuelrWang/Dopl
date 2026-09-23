'use strict';

// WHICH ONTOLOGIES THIS SPAWN REACHES — the PRODUCER for `ctx.ontologies`
// (F-681, closed 2026-09-09).
//
// ⚠ **IT IS ENRICHMENT, NOT AN IDENTITY, SO EVERY FAILURE DEGRADES TO `[]`** —
// this lane's rule for an enrichment read, and this module is now its one
// carrier (the knowledge-curation fetch that used to state it was deleted with
// that feature, 2026-09-18).
// A timeout, a dead socket, a 5xx, an older deployment's 404, a pre-sign-in
// launch all answer "no ontology reaches this lane", which `ontologyReachLines`
// renders BYTE-IDENTICALLY to the turn before that module existed. A launch is
// never refused over it, and no prompt line reports the failure — that is
// unactionable by the agent and would put a machine-local blocker into a shared
// channel. The operator sees it in `diag`.
//
// ⚠ **THE BEARER IS THE SESSION'S AGENT TOKEN, NOT THE OPERATOR'S COOKIE, AND
// THAT IS THE WHOLE CORRECTNESS ARGUMENT.** `ontology/server/service.ts ›
// buildOntologyContext` derives `source` from the presence of an agent token,
// and the OWNER's own agent is the one row of Samuel's matrix that is not simply
// its human's (`agents_may_edit`, `owner_agents_level`). A cookie-authed read
// would answer the OPERATOR's rung and tell an agent it may EDIT a lane the
// server refuses. ⚠ NO TOKEN ⇒ `[]`, never a cookie fallback: for a compensating
// control, saying nothing is right and saying something wrong is not.
//
// ⚠ **IT IS NOT A FENCE AND MUST NEVER BE DESCRIBED AS ONE** (INVARIANTS §4A).
// The fence is `ontology/server/service-audience.ts › resolveOntologyAudience`,
// which runs on every read and every write whatever this file fetched or failed
// to fetch.

const REACH_PATH = '/api/ontology/reach';
// ⚠ FIVE SECONDS, `identity-resolve.js`'s budget and not `launch-directives.js`'s
// fifteen: this await sits in the ONE spawn funnel, so a human at the New Agent
// button is behind every one of them. Enrichment must never make a launch feel
// broken.
const REACH_TIMEOUT_MS = 5000;
// A boundary bound, not a product one (the server's ceiling is
// `ONTOLOGY_READ_LIMITS.clusters`): a boundary that trusts the far side's
// validation is not one, and this list becomes PROMPT LINES.
const MAX_ONTOLOGIES = 50;

/** Narrowed, never spread (`identity-resolve.js › narrow`'s rule): a key the
 *  server adds later must not arrive on a session object and start being depended
 *  on. The per-field NEUTRALIZERS live in `prompt-framing-ontology.js`. */
function narrow(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_ONTOLOGIES).map((o) => ({
    id: o && typeof o.id === 'string' ? o.id : '',
    name: o && typeof o.name === 'string' ? o.name : '',
    level: o && typeof o.level === 'string' ? o.level : '',
    workspaceId: o && typeof o.workspaceId === 'string' ? o.workspaceId : '',
  }));
}

/**
 * The reach for ONE spawn, as `ctx.ontologies` wants it.
 *
 * @param {string|null} workspaceId the CHANNEL's container — `apiFetch` sends it
 *   as `X-Workspace-Id`, and a launch into a home channel must resolve THAT
 *   container's shares. The server needs no channel id: a home channel is the
 *   one channel in its container (`service-reach.ts › getReach`).
 * @returns {Promise<Array>} possibly empty; NEVER throws.
 */
async function fetchOntologyReach(workspaceId) {
  const { diag } = require('./diag');
  if (typeof workspaceId !== 'string' || !workspaceId) return [];
  let token = '';
  try {
    token = require('./mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    token = '';
  }
  if (!token) {
    diag('ontology-reach: no agent credential — launching with no ontology block');
    return [];
  }
  try {
    const res = await require('./api').apiFetch(REACH_PATH, {
      method: 'GET',
      workspaceId,
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: REACH_TIMEOUT_MS,
      noStore: true,
    });
    // ⚠ A 404 IS THE OLDER-DEPLOYMENT CASE, NOT AN ERROR (INVARIANTS §13) — the
    // same degrade as every other failure.
    if (!res || !res.ok) {
      diag('ontology-reach: not fetched —', res ? `HTTP ${res.status}` : 'no response',
        '— launching with no ontology block');
      return [];
    }
    const body = await res.json();
    if (!body || typeof body !== 'object') return [];
    return narrow(body.ontologies);
  } catch (err) {
    // An abort (the timeout) and a dead socket land here identically.
    diag('ontology-reach: network —', (err && err.message) || 'error',
      '— launching with no ontology block');
    return [];
  }
}

module.exports = { fetchOntologyReach, narrow, REACH_PATH, MAX_ONTOLOGIES };
