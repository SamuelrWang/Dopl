// JSON-RPC 2.0 client for `muse serve` (the Muse Session Protocol, MSP) over stdio. `serve`, not `muse
// exec`: only the served host raises approvals as held requests Dopl answers (`approval/decide`).
// The transport is the kit's (`../kit/stdio-rpc.js`); the probe is the kit's (`../kit/probe-bin.js`).

const crypto = require('crypto');
const stdioRpc = require('../kit/stdio-rpc');
const probeBin = require('../kit/probe-bin');
const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');

const BIN = resolveBin.BIN_NAME;

const prober = probeBin.makeProber({
  binName: BIN,
  label: 'Muse',
  resolve: () => resolveBin.resolveMuseBin(),
  versionGate: (version) => protocol.versionGate(version),
  onReadable: (file, version) => require('./identity').noteVersion(file, version),
  updateSource: () => require('./update-source'),
});

/** Is there a usable `muse`? `{ ok, reason, version, path, source }`. `o` is for tests. */
const probe = (o) => prober.probe(o);

// ── SPAWN ────────────────────────────────────────────────────────────────────────────────────
// `--provider meta`: the user's own Meta account (never a key Dopl holds). `--contributor-mode off`: Meta
// trains on content in contributor mode, and Dopl never opts a user in (privacy-preserving default).
// NO `--trust-workspace` (no workspace skills, rules, hooks or `.mcp.json`). Settings ride `-c`, which
// refuses an unknown key (measured 1.4.7) — so a renamed key fails the launch rather than silently dropping.
const SERVE_SETTINGS = Object.freeze([
  // Accepted on 1.4.7; NOT effective on `skill/list` (F-772) — the private HOME is the fence. Kept: it is
  // Meta's own switch, and a later build that honours it narrows further.
  'context.foreign_personal_skills=false',
  // The observer agents (skill/goal/verify reminders) each spend model turns; off (measured: no
  // `reminderChild` items with this set).
  'run.reminder_roster.agents=[]',
]);

/** `muse serve` argv for a provider/model and the per-profile host fences (`tools.js › serveFlags`). */
function serveArgs({ provider, model, flags } = {}) {
  const args = ['serve', '--provider', provider || 'meta', '--contributor-mode', 'off'];
  if (model) args.push('--model', model);
  for (const s of SERVE_SETTINGS) args.push('-c', s);
  return args.concat(flags || []);
}

/**
 * Spawn `muse serve` and speak JSON-RPC to it. Returns synchronously (two-children bug).
 * `opts` — `{ bin, args, env, cwd, onNotification, onServerRequest, onExit, log }`; `args` is the whole
 * argv after the binary (`serveArgs(...)`).
 */
function connect(opts) {
  const o = opts || {};
  const resolved = o.bin ? { ok: true, path: o.bin } : resolveBin.resolveMuseBin();
  if (!resolved.ok) throw new Error(resolved.reason);
  return stdioRpc.connect({
    command: resolved.path,
    args: o.args || serveArgs(),
    cwd: o.cwd,
    env: o.env,
    label: 'muse serve',
    errorFallback: 'muse serve error',
    onNotification: o.onNotification,
    onServerRequest: o.onServerRequest,
    onExit: o.onExit,
    log: o.log,
  });
}

// ── HANDSHAKE ────────────────────────────────────────────────────────────────────────────────
// `clientInfo.name` must match ^[a-z0-9_]+$ (a hyphen is -32602, measured). `sessionMcp` lets a session
// carry Dopl's MCP server; `experimentalApi` admits `account/*` (the in-app sign-in, `credential.js`).
const CLIENT_NAME = 'dopl';
const CLIENT_TITLE = 'Dopl';

function initializeParams(version) {
  return {
    clientInfo: { name: CLIENT_NAME, title: CLIENT_TITLE, version: typeof version === 'string' && version ? version : '0.0.0' },
    // `userInputDialogs: false`: Dopl has no surface for a free-form question, so the host withholds
    // `userInput/request` (schema D-047) rather than parking a turn on one nobody can answer.
    capabilities: { experimentalApi: true, requestedCapabilities: ['sessionMcp'], userInputDialogs: false },
  };
}

/** `initialize` + `initialized` (the notification must follow the result: one sent earlier is dropped). */
async function handshake(conn, version) {
  const init = await conn.request('initialize', initializeParams(version));
  protocol.assertSchema(init);
  conn.notify('initialized');
  return init;
}

/** A UUIDv7 — every MSP command's idempotency key (`commandId`; anything else is -32602, measured). */
function uuidv7(now) {
  const b = crypto.randomBytes(16);
  const t = BigInt(typeof now === 'number' ? now : Date.now());
  for (let i = 0; i < 6; i += 1) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

module.exports = {
  probe, connect, serveArgs, initializeParams, handshake, uuidv7,
  SERVE_SETTINGS, CLIENT_NAME,
  REQUIRED_METHODS: protocol.REQUIRED_METHODS,
};
