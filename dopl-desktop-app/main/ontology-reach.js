'use strict';

// WHICH ONTOLOGIES THIS SPAWN REACHES — the PRODUCER for `ctx.ontologies`
// (F-681, closed 2026-09-09).
//
// `prompt-framing-ontology.js › ontologyReachLines` shipped on 2026-09-09 reading
// `ctx.ontologies`, and NOTHING in `main/` wrote that field: the module, its
// sanitizers and its eight cases all exercised a shape only the tests supplied,
// so the block emitted nothing on every live turn. This is the missing half.
//
// ⚠ **IT IS ENRICHMENT, NOT AN IDENTITY, SO EVERY FAILURE DEGRADES TO `[]`** —
// the rule `launch-directive-spawn.js › fetchStartupContext` states in full and
// the one this lane inherits verbatim. A timeout, a dead socket, a 5xx, an older
// deployment's 404, a pre-sign-in launch: all of them answer "no ontology
// reaches this lane", which `ontologyReachLines` renders as BYTE-IDENTICAL to
// what the turn was before that module existed. A launch is never refused over
// it, and no prompt line says "I could not read your ontologies" — that sentence
// is unactionable by the agent, and a session that had it would report a
// machine-local blocker into a shared channel. The operator sees it in `diag`.
//
// ⚠ **THE BEARER IS THE SESSION'S AGENT TOKEN, NOT THE OPERATOR'S COOKIE, AND
// THAT IS THE WHOLE CORRECTNESS ARGUMENT.** `ontology/server/service.ts ›
// buildOntologyContext` derives `source` from the presence of an agent token,
// and the OWNER's own agent is the one row of Samuel's matrix that is not simply
// its human's (`agents_may_edit`, and `owner_agents_level` per channel). A
// cookie-authed read here would answer the OPERATOR's rung, and the framing
// would tell an agent it may EDIT a lane the server refuses — over-promising,
// which is the exact "discover your level by being refused" failure the block
// exists to prevent, inverted. ⚠ NO TOKEN ⇒ `[]`, never a cookie fallback: for a
// compensating control, saying nothing is right and saying something wrong is
// not.
//
// ⚠ **IT IS NOT A FENCE AND MUST NEVER BE DESCRIBED AS ONE** (INVARIANTS §4A).
// The fence is `ontology/server/service-audience.ts › resolveOntologyAudience`,
// which runs on every read and every write whatever this file fetched or failed
// to fetch.

const REACH_PATH = '/api/ontology/reach';
// ⚠ FIVE SECONDS, `template-resolve.js`'s budget and not `launch-directives.js`'s
// fifteen: this await sits in the ONE spawn funnel, so a human at the New Agent
// button is behind every one of them. Enrichment must never make a launch feel
// broken.
const REACH_TIMEOUT_MS = 5000;
// A boundary bound, not a product one — the server's own read ceiling is
// `ONTOLOGY_READ_LIMITS.clusters`. This one exists because a boundary that
// trusts the far side's validation is not one, and because the far side's list
// becomes PROMPT LINES.
const MAX_ONTOLOGIES = 50;

/** Narrowed, never spread — `template-resolve.js › narrow`'s rule: a key the
 *  server adds later must not arrive on a session object and start being
 *  depended on by accident. The per-field NEUTRALIZERS are the render's
 *  (`prompt-framing-ontology.js`), which is where the sanitizers live. */
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
    // ⚠ A 404 IS THE OLDER-DEPLOYMENT CASE AND IS NOT AN ERROR (INVARIANTS §13),
    // the same reading `fetchStartupContext` gives its own. It lands on the
    // identical degrade as every other failure.
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
