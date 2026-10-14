// GROK DESCRIBES ITSELF — in its `initialize` answer (ACP v1): the protocol version, the agent capabilities
// (`loadSession`, `mcpCapabilities.http`, `sessionCapabilities`), the client-hook contract
// (`_meta["x.ai/hooks"]` — its blocking events and decisions) and the auth methods. This file turns that answer
// into the shared Shape (`../sdk-shape.js`) the launch gate and the updater check `requiredShape` against —
// per build, never per version. Spawned in a THROWAWAY home (Dopl's config files written, no credential), so a
// candidate build is described without touching the home sessions run in.
//
//   results  `initialize` → its dotted field paths (arrays transparent; a key whose value is `false` is ABSENT,
//            so a capability switched off reads as missing)
//   methods  what the answer commits the build to: ACP v1's baseline, plus `session/load` iff `loadSession`
//   values   `hooks blockingEvents`, `hooks decisions`, `initialize authMethods` — closed vocabularies
// ACP has no method catalogue: Grok's `_x.ai/*` extensions are not described here (`protocol.js` lists them).

const fs = require('fs');
const os = require('os');
const path = require('path');

const DESCRIBE_TIMEOUT_MS = 30000;
const MAX_DEPTH = 8;
const HOOKS_KEY = 'x.ai/hooks';
// ACP v1's own methods (agent-client-protocol v1), committed to by `protocolVersion: 1`.
const ACP_V1_BASELINE = Object.freeze(['initialize', 'session/new', 'session/prompt', 'session/cancel', 'session/set_config_option']);

/** Every dotted key path under `value` whose leaf is not `false`. Pure. */
function fieldPaths(value, prefix, out, depth) {
  const acc = out || new Set();
  const d = depth || 0;
  if (d > MAX_DEPTH || value == null) return acc;
  if (Array.isArray(value)) { for (const v of value) fieldPaths(v, prefix, acc, d + 1); return acc; }
  if (typeof value !== 'object') return acc;
  for (const k of Object.keys(value)) {
    if (value[k] === false) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    acc.add(p);
    fieldPaths(value[k], p, acc, d + 1);
  }
  return acc;
}

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** The Shape of one `initialize` result. Pure. */
function shapeFromInit(init) {
  const r = init && typeof init === 'object' ? init : {};
  const caps = r.agentCapabilities && typeof r.agentCapabilities === 'object' ? r.agentCapabilities : {};
  const hooks = (caps._meta && caps._meta[HOOKS_KEY]) || {};
  const methods = r.protocolVersion === 1 ? ACP_V1_BASELINE.slice() : [];
  if (caps.loadSession === true) methods.push('session/load');
  const values = {
    'hooks blockingEvents': strings(hooks.blockingEvents),
    'hooks decisions': strings(hooks.decisions),
    'initialize authMethods': (Array.isArray(r.authMethods) ? r.authMethods : []).map((m) => m && m.id).filter((x) => typeof x === 'string'),
  };
  return { methods, results: { initialize: Array.from(fieldPaths(r)) }, notifications: {}, requests: {}, values };
}

/**
 * Ask the build at `bin` to describe itself → `{ shape, init }`. REJECTS when it cannot be spawned or does not
 * answer: a failed probe is `shape-unknown`, never an empty shape. `o.connect` is for tests.
 */
async function describeBuild(bin, o) {
  if (!bin) throw new Error('no Grok binary to describe');
  const opts = o || {};
  const client = require('./client');
  const configHome = require('./config-home');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dopl-grok-shape-'));
  let conn = null;
  let timer = null;
  try {
    const roots = configHome.rootsOf(dir);
    configHome.writeConfig(roots.GROK_HOME);
    const env = Object.assign(configHome.buildScrubbedEnv(), roots, configHome.PROCESS_ENV);
    conn = (opts.connect || client.connect)({ bin, args: client.agentArgs(), env, cwd: dir });
    const answer = client.handshake(conn, '0.0.0');
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`\`grok agent\` did not answer \`initialize\` within ${DESCRIBE_TIMEOUT_MS}ms`)), opts.timeoutMs || DESCRIBE_TIMEOUT_MS);
      if (timer.unref) timer.unref();
    });
    const init = await Promise.race([answer, timeout]);
    const shape = shapeFromInit(init);
    if (!shape.methods.length) throw new Error('the build described no protocol Dopl reads');
    return { shape, init };
  } finally {
    if (timer) clearTimeout(timer);
    try { if (conn) conn.close(); } catch (_) { /* best effort */ }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** `runtime.shape()`: describe the build new launches run, answer its Shape. */
async function describe(bin) {
  return (await describeBuild(bin)).shape;
}

module.exports = { describeBuild, describe, shapeFromInit, fieldPaths, ACP_V1_BASELINE, DESCRIBE_TIMEOUT_MS };
