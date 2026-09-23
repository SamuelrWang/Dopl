// The producer for `ctx.ontologies`: which ontologies this spawn reaches (F-681). Enrichment, so EVERY failure
// degrades to [] (a launch is never refused and no prompt line reports it); it never throws. The bearer is the
// session's AGENT token, never the operator's cookie (the server answers the agent's own rung); no token -> [].
// Not a fence: `service-audience.ts › resolveOntologyAudience` runs on every read and write (INVARIANTS §4A).

'use strict';

const REACH_PATH = '/api/ontology/reach';
// Five seconds: this await sits in the one spawn funnel, with a human at the New Agent button behind it.
const REACH_TIMEOUT_MS = 5000;
// A boundary bound: this list becomes prompt lines.
const MAX_ONTOLOGIES = 50;

/** Narrowed, never spread: a key the server adds later must not start being depended on. */
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
 * The reach for one spawn.
 * @param {string|null} workspaceId the CHANNEL's container (sent as `X-Workspace-Id`).
 * @returns {Promise<Array>} possibly empty; never throws.
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
    // A 404 is an older deployment, not an error: the same degrade.
    if (!res || !res.ok) {
      diag('ontology-reach: not fetched —', res ? `HTTP ${res.status}` : 'no response',
        '— launching with no ontology block');
      return [];
    }
    const body = await res.json();
    if (!body || typeof body !== 'object') return [];
    return narrow(body.ontologies);
  } catch (err) {
    diag('ontology-reach: network —', (err && err.message) || 'error',
      '— launching with no ontology block');
    return [];
  }
}

module.exports = { fetchOntologyReach, narrow, REACH_PATH, MAX_ONTOLOGIES };
