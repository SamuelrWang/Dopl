'use strict';

// LIVE CONTRACT HARNESS — credentials, target, and the redactor.
//
// WHY `.js` AND NOT `.mjs` IN A DIRECTORY FULL OF `.mjs`: `npm test` is
// `node --test 'test/**/*.mjs'`, and `**` matches zero or more segments — so a
// `test/live/*.mjs` file WOULD be picked up by the ordinary suite and would try to
// talk to prod from CI. The extension is the exclusion, and it is load-bearing.
// Everything here is CommonJS for the same reason `main/*.js` is; the two ESM
// helpers this lane reuses (`test/helpers/*.mjs`) are pulled in with `await import()`.
//
// THE TOKEN IS NEVER PRINTED, NEVER PASSED IN ARGV, NEVER WRITTEN ANYWHERE. It is
// read out of the desktop's own spawn config at runtime, held in one closure, and
// every line this harness prints goes through `redact()` first — which scrubs the
// literal secret as a defence against a stack trace, a 401 body echoing an
// Authorization header, or a future `console.log(opts)`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SPAWN_JSON = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'dopl-desktop',
  'mcp-spawn.json'
);

const DEFAULT_BASE_URL = 'https://www.usedopl.com';

// Samuel's Workspace. Env-overridable, and VERIFIED at preflight against
// `GET /api/workspaces/me` rather than trusted — a hardcoded id that has drifted is
// exactly the class of bug this harness exists to catch.
const DEFAULT_WORKSPACE_ID = '5291e457-6a49-4148-af71-0f87361d5f55';

// The identity the device token authenticates as (Samuel Wang). Also verified, not
// assumed: every ownership assertion below is meaningless if the caller is somebody else.
const DEFAULT_USER_ID = '2dac1943-da3b-4fd9-aee6-1716ddfc25f9';

/** The one channel this harness must never touch: the operator's real DM. */
const FORBIDDEN_CHANNEL_IDS = new Set(['dba90694-de4f-4950-83a9-f2d890c9ff3f']);

let SECRET = '';

/**
 * Scrub the credential out of anything about to be printed. Called by the reporter on
 * every line, so a leak needs BOTH a new print path and this function to fail.
 */
function redact(text) {
  const s = String(text == null ? '' : text);
  if (!SECRET) return s;
  return s.split(SECRET).join('<redacted-token>');
}

/**
 * The device token, from `DOPL_TOKEN` if set, else out of the desktop's spawn config.
 * Returns `{ token, source }` or `{ token: '', reason }` — an ABSENT credential is a
 * clean skip, not a failure, so CI and other agents are unaffected.
 */
function readToken() {
  const fromEnv = String(process.env.DOPL_TOKEN || '').trim();
  if (fromEnv) {
    SECRET = fromEnv.replace(/^Bearer\s+/i, '');
    return { token: SECRET, source: 'DOPL_TOKEN' };
  }
  let raw;
  try {
    raw = fs.readFileSync(SPAWN_JSON, 'utf8');
  } catch (err) {
    return {
      token: '',
      reason:
        `no credential: ${SPAWN_JSON} is unreadable (${err && err.code}) and DOPL_TOKEN is unset`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { token: '', reason: `no credential: ${SPAWN_JSON} is not JSON (${err && err.message})` };
  }
  const header =
    parsed &&
    parsed.mcpServers &&
    parsed.mcpServers.dopl &&
    parsed.mcpServers.dopl.headers &&
    parsed.mcpServers.dopl.headers.Authorization;
  const token = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token) {
    return {
      token: '',
      reason: `no credential: mcpServers.dopl.headers.Authorization missing from ${SPAWN_JSON}`,
    };
  }
  SECRET = token;
  return { token, source: 'mcp-spawn.json' };
}

function target() {
  return {
    baseUrl: String(process.env.DOPL_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    workspaceId: String(process.env.DOPL_WORKSPACE_ID || DEFAULT_WORKSPACE_ID).trim(),
    expectUserId: String(process.env.DOPL_EXPECT_USER_ID || DEFAULT_USER_ID).trim(),
    peerUserId: String(process.env.DOPL_PEER_USER_ID || '').trim(),
    // A run label, so two harness channels never collide and a leftover is traceable.
    stamp: String(process.env.DOPL_RUN_STAMP || '').trim() || new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14),
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  FORBIDDEN_CHANNEL_IDS,
  SPAWN_JSON,
  readToken,
  redact,
  target,
};
