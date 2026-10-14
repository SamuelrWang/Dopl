// THE RESTRICTIONS, READ BACK (2026-10-08, orchestrator: "a fence that fails OPEN is not acceptable").
//
// `thread/start.config` accepts ANY key and echoes none, and `config/read` does not show thread-level
// values — so a restriction sent there could be renamed upstream and silently stop applying. Process-level
// config (`-c key=<TOML>` on the app-server's argv, its `sessionFlags` layer) IS what `config/read`
// answers with, measured on codex-cli 0.155.1 for every key below. So Dopl's restrictions ride argv, and
// before any thread starts the child is asked what it is actually running with: every leaf Dopl set must
// read back EQUAL, or the launch is refused (fail CLOSED — an absent key, a failed read and a different
// value all refuse).
//
// ⚠ ARGV IS READABLE BY OTHER PROCESSES (`ps`). Only values with NO secret ride it: Dopl's MCP entry
// carries env-var NAMES for its bearer and pins (`mcp.js`), never values. The operator's OWN servers
// ("Use my tools") stay on `thread/start.config`: their headers are the operator's, may hold tokens, and
// are not a Dopl restriction. `assertNoSecret` refuses argv that would carry the session bearer.

const { SERVER_KEY } = require('./mcp');

// Every restriction Dopl sets on a Codex thread. A key added to `buildLaunchSpec`'s thread config that
// is a RESTRICTION belongs here in the same change (the test pins the two lists together).
const RESTRICTION_KEYS = Object.freeze(['features', 'notify', 'skills', 'shell_environment_policy', 'projects', 'mcp_servers']);

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A TOML inline value for `v` (strings via JSON, which TOML basic strings accept). Throws on what TOML
 *  cannot say (null, undefined, a function) — a restriction Dopl cannot write is not silently dropped. */
function toml(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return `[${v.map(toml).join(', ')}]`;
  if (isPlain(v)) return `{${Object.keys(v).map((k) => `${JSON.stringify(k)} = ${toml(v[k])}`).join(', ')}}`;
  throw new Error(`Dopl cannot write a ${v === null ? 'null' : typeof v} into Codex's config`);
}

/**
 * Split a thread config: Dopl's restrictions → `{ proc }` (argv, read back), the rest → `{ thread }`.
 * `mcp_servers` is split by entry: Dopl's own goes to argv, the operator's stay on the thread.
 */
function split(threadConfig) {
  const thread = Object.assign({}, threadConfig || {});
  const proc = {};
  for (const key of RESTRICTION_KEYS) {
    if (!(key in thread)) continue;
    if (key === 'mcp_servers') {
      const servers = Object.assign({}, thread.mcp_servers || {});
      if (servers[SERVER_KEY]) {
        proc.mcp_servers = { [SERVER_KEY]: servers[SERVER_KEY] };
        delete servers[SERVER_KEY];
      }
      if (Object.keys(servers).length) thread.mcp_servers = servers;
      else delete thread.mcp_servers;
      continue;
    }
    proc[key] = thread[key];
    delete thread[key];
  }
  return { proc, thread };
}

/** `['-c', 'key=<toml>', …]` — one top-level key per flag, in a stable order. */
function argsFor(proc) {
  const out = [];
  for (const key of Object.keys(proc || {}).sort()) out.push('-c', `${key}=${toml(proc[key])}`);
  return out;
}

/** Refuse argv that would carry `secret` (the session bearer) anywhere. */
function assertNoSecret(args, secret) {
  const s = typeof secret === 'string' ? secret.trim() : '';
  if (s && s.length >= 8 && args.some((a) => String(a).includes(s))) {
    throw new Error('Dopl refused to put a credential on the Codex command line — refusing the launch.');
  }
}

function leaves(value, prefix, out) {
  if (isPlain(value) && Object.keys(value).length) {
    for (const k of Object.keys(value)) leaves(value[k], prefix.concat(k), out);
  } else {
    out.push({ path: prefix, value });
  }
  return out;
}

function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => same(a[k], b[k]));
  }
  return a === b;
}

/** Every leaf of `proc` whose EFFECTIVE value (`config/read › config`) differs or is absent. Pure. */
function mismatches(proc, effective) {
  const eff = isPlain(effective) ? effective : null;
  const out = [];
  for (const { path, value } of leaves(proc || {}, [], [])) {
    let cur = eff;
    for (const p of path) cur = isPlain(cur) && p in cur ? cur[p] : undefined;
    if (cur === undefined) out.push(`${path.join('.')} is not in effect`);
    else if (!same(cur, value)) out.push(`${path.join('.')} reads back as ${JSON.stringify(cur)}`);
  }
  return out;
}

/** Ask the running child what it is configured with, and THROW unless every restriction took. */
async function assertRestrictionsTook(conn, proc, cwd) {
  if (!proc || !Object.keys(proc).length) return;
  let read;
  try {
    read = await conn.request('config/read', cwd ? { cwd } : {});
  } catch (err) {
    throw new Error(`Dopl could not read back Codex's settings (${(err && err.message) || 'no answer'}), so it cannot `
      + 'confirm its restrictions are on — refusing the session.');
  }
  const problems = mismatches(proc, read && read.config);
  if (problems.length) {
    const shown = problems.slice(0, 4).join('; ') + (problems.length > 4 ? `; +${problems.length - 4} more` : '');
    throw new Error(`Codex is not running with Dopl's restrictions (${shown}) — refusing the session.`);
  }
}

module.exports = { RESTRICTION_KEYS, toml, split, argsFor, assertNoSecret, mismatches, assertRestrictionsTook };
