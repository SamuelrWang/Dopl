// Ambient-config isolation for `grok agent`: HOME, GROK_HOME and GROK_AUTH_PATH all point inside an app-owned
// home, and Dopl writes Grok's two config files there on every launch. MEASURED (grok 1.0.52, `grok inspect
// --json`, `g4-inspect-*.json`): `~/.claude/settings.json` permission rules load EVEN WITH every Claude compat
// flag off — an operator `allow: mcp__dopl_session__*` there would bypass the gate — so the private HOME is
// mandatory, not belt-and-braces; a project `.mcp.json` loads regardless of flags, so `requirements.toml`
// allow-lists Dopl's own server and nothing else. Its only credential is the `auth.json` Dopl's own sign-in
// installed (`login.js`). The owner-only home, the `0600` install and the symlink removal are the kit's
// (`../kit/private-home.js`); this file keeps Grok's names, its file contents and the refusal.

const fs = require('fs');
const path = require('path');
const home = require('../kit/private-home');
const cliSpawn = require('../cli-spawn');
const { SERVER_KEY } = require('./tools');

const PRIVATE_HOME = 'grok-runtime-home-v1';
// The in-app sign-in's throwaway home; its `auth.json` is moved into PRIVATE_HOME on success.
const LOGIN_HOME = 'grok-login-home-v1';

// Grok's own process knobs on every Dopl spawn: no self-update (`GROK_DISABLE_AUTOUPDATER`, LIVE: no updater
// lines in `logs/unified.jsonl`), no telemetry, and every foreign-agent compat source off (LIVE via
// `grok inspect --json`: each flag drops its source; foreign session scans stop).
const COMPAT_SOURCES = ['AGENTS', 'RULES', 'SKILLS', 'MCPS', 'HOOKS', 'SESSIONS'];
const PROCESS_ENV = Object.freeze(Object.assign(
  { GROK_DISABLE_AUTOUPDATER: '1', GROK_TELEMETRY_ENABLED: '0', DISABLE_TELEMETRY: '1', GROK_CODEX_SESSIONS_ENABLED: 'false' },
  ...['CLAUDE', 'CURSOR'].map((v) => Object.fromEntries(COMPAT_SOURCES.map((s) => [`GROK_${v}_${s}_ENABLED`, 'false']))),
));

// Every inherited vendor credential is dropped by `cliSpawn.scrubbedEnv` (`XAI_API_KEY`,
// `GROK_CODE_XAI_API_KEY` — an operator key would replace the subscription sign-in Dopl holds), and EVERY
// `GROK_*` / `XAI_*` knob is stripped: `GROK_CONFIG` overlays, `GROK_AUTH_*` providers,
// `GROK_DEFAULT_SELECTED_PERMISSION` and the rest could each move a session. Dopl sets its own (`PROCESS_ENV`).
const VENDOR_ENV_RE = /^(GROK_|XAI_)/;

/** The operator's env minus credentials and every Grok/xAI knob, plus `extra`. */
function buildScrubbedEnv(extra) {
  return Object.assign(cliSpawn.scrubbedEnv(process.env, VENDOR_ENV_RE, /./), extra || {});
}

const grokHomeOf = (dir) => path.join(dir, '.grok');

/** HOME + GROK_HOME + GROK_AUTH_PATH (+ the XDG roots) under one home. */
function rootsOf(dir) {
  return {
    HOME: dir,
    GROK_HOME: grokHomeOf(dir),
    GROK_AUTH_PATH: path.join(grokHomeOf(dir), 'auth.json'),
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    XDG_DATA_HOME: path.join(dir, '.local', 'share'),
    XDG_CACHE_HOME: path.join(dir, '.cache'),
    XDG_STATE_HOME: path.join(dir, '.local', 'state'),
  };
}

// ── DOPL'S CONFIG FILES (rewritten whole on every launch; Grok may append to `config.toml`) ──────
// The ask rule is LOAD-BEARING for Axis B: under `autoMode` Grok's classifier runs a Dopl MCP call
// silently unless this rule forces `session/request_permission` (LIVE, `smoke-s2`). `remember_tool_approvals
// = false` removes the "always allow" option (a remembered grant would satisfy the ask rule). The marketplace
// markers are the ones Grok itself writes after its first-run plugin install, so a fresh Dopl home never
// clones xAI's plugin marketplace (SMOKE: no plugin installed in the live tier's home).
// `backend_tools = false` is CONTAINMENT: with backend tools on, `web_search` runs server-side inside the
// model call and never reaches the PreToolUse hook (LIVE 1.0.52, S5b: no hook, a `ws_…` call id, rawInput
// `{variant:"WebSearch", backend:true}`), so a restricted profile's deny could not hold. Off, it is the client
// tool: the hook sees `web_search {query}`, a deny fails only that call, and an allowed search still answers
// (LIVE, S5c).
const ASK_RULE = `MCPTool(${SERVER_KEY}__*)`;
const compat = (vendor, keys) => [`[compat.${vendor}]`].concat(keys.map((k) => `${k} = false`)).join('\n');
const CONFIG_TOML = [
  '# Written by Dopl on every launch of a Dopl session; edits here are replaced.',
  '[cli]\nauto_update = false\nuse_leader = false',
  '[features]\ntelemetry = false\nbackend_tools = false',
  '[ui]\nremember_tool_approvals = false',
  `[permission]\nask = [${JSON.stringify(ASK_RULE)}]`,
  compat('claude', ['skills', 'rules', 'agents', 'mcps', 'hooks', 'sessions']),
  compat('cursor', ['skills', 'rules', 'agents', 'mcps', 'hooks', 'sessions']),
  compat('codex', ['sessions']),
  '[marketplace]\ndefault_skills_installs_purged = true\nofficial_marketplace_auto_installed = true',
].join('\n\n') + '\n';

// `requirements.toml` clamps every config layer (project `.grok/config.toml` included): no project MCP
// server, only Dopl's own (LIVE via `grok inspect`: a project `.mcp.json` server → `disabledReason: "not in
// allowedMcpServers"`), and the bypass lock (it does NOT stop `_meta.yoloMode` — LIVE — which is why Dopl never
// sends that). ⚠ `grok agent` DELETES `$GROK_HOME/requirements.toml` during `initialize` (LIVE 1.0.52,
// 2026-10-13; `[features] managed_config = false` does not stop it) — so it is rewritten before EVERY spawn.
// It IS applied first (LIVE, S16, 2026-10-14): with folder trust switched off so the pins are the only fence,
// a project `.mcp.json` http server started WITHOUT the file and did not start WITH it (F-775 closed). Folder
// trust is the second fence: Dopl never trusts a folder.
const REQUIREMENTS_TOML = [
  '# Written by Dopl on every launch of a Dopl session; edits here are replaced.',
  'enable_all_project_mcp_servers = false',
  '[ui]\ndisable_bypass_permissions_mode = true',
  `[[allowed_mcp_servers]]\nserver_name = ${JSON.stringify(SERVER_KEY)}`,
].join('\n\n') + '\n';

/** Write one Dopl-owned file atomically, owner-only; a symlink in its place is replaced, never followed. */
function writeOwned(file, text) {
  const tmp = `${file}.dopl-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** (Re)write Dopl's `config.toml` + `requirements.toml` into a GROK_HOME. */
function writeConfig(grokHome) {
  home.ownerOnlyDir(grokHome);
  writeOwned(path.join(grokHome, 'config.toml'), CONFIG_TOML);
  writeOwned(path.join(grokHome, 'requirements.toml'), REQUIREMENTS_TOML);
}

// What would load into a session if it were here and Dopl did not write it: foreign agents' settings (the
// Claude permission rules are measured to load), MCP lists, and Grok's own user-scope plugins/skills/hooks
// and its managed config layer.
const AMBIENT_IN_HOME = Object.freeze(['.claude', '.claude.json', '.codex', '.cursor', '.agents', '.mcp.json']);
const AMBIENT_IN_GROK_HOME = Object.freeze(['plugins', 'skills', 'hooks', 'managed_config.toml']);

/** The ambient entries present in a home, by name (empty = isolated). */
function ambientConfig(dir) {
  const found = [];
  for (const n of AMBIENT_IN_HOME) if (home.hasEntry(dir, (x) => x === n)) found.push(n);
  for (const n of AMBIENT_IN_GROK_HOME) if (home.hasEntry(grokHomeOf(dir), (x) => x === n)) found.push(`.grok/${n}`);
  return found;
}

/** The app-owned home a launch runs against (created by `isolatedEnv`). */
function privateHome(userDataRoot) {
  return home.privateHome(PRIVATE_HOME, userDataRoot);
}

const authFile = (userDataRoot) => rootsOf(privateHome(userDataRoot)).GROK_AUTH_PATH;

/** Is the Dopl-owned `auth.json` present? A symlink there is removed, never followed. Never read. */
function hasAuth(userDataRoot) {
  return home.ownedFile(authFile(userDataRoot));
}

/** Remove the Dopl-owned `auth.json` (a Dopl sign-out). */
function removeAuth(userDataRoot) {
  home.removeFile(authFile(userDataRoot));
}

/** A fresh, empty login home and the env a `grok login` runs with (same fences as a session). */
function loginEnv(env, userDataRoot) {
  const dir = home.privateHome(LOGIN_HOME, userDataRoot);
  home.freshDir(dir);
  const roots = rootsOf(dir);
  writeConfig(roots.GROK_HOME);
  return { home: dir, authFile: roots.GROK_AUTH_PATH, env: Object.assign({}, env || {}, roots, PROCESS_ENV) };
}

/** Remove the login home (idempotent). */
function clearLoginHome(userDataRoot) {
  home.removeDir(home.privateHome(LOGIN_HOME, userDataRoot));
}

/** Move a login's `auth.json` into the private home as the Dopl-owned credential. */
function installAuth(file, userDataRoot) {
  home.installFile(file, authFile(userDataRoot), 'the Grok sign-in left no credential file');
}

/** `env` with HOME/GROK_HOME/GROK_AUTH_PATH moved into Dopl's private home, Dopl's config files written and
 *  Grok's process knobs set. Refuses a home that holds ambient configuration (something other than Dopl wrote it). */
function isolatedEnv(env, userDataRoot) {
  const target = privateHome(userDataRoot);
  home.ownerOnlyDir(target);
  const found = ambientConfig(target);
  if (found.length) {
    throw new Error(`Dopl's private Grok home holds ${found.join(', ')}; refusing an unisolated launch (${target})`);
  }
  const roots = rootsOf(target);
  writeConfig(roots.GROK_HOME);
  hasAuth(userDataRoot); // drops a link before any child can follow it
  return Object.assign({}, env || {}, roots, PROCESS_ENV);
}

module.exports = {
  isolatedEnv, buildScrubbedEnv, privateHome, ambientConfig, rootsOf, writeConfig,
  hasAuth, removeAuth, loginEnv, clearLoginHome, installAuth, authFile,
  PRIVATE_HOME, LOGIN_HOME, PROCESS_ENV, CONFIG_TOML, REQUIREMENTS_TOML, ASK_RULE,
  AMBIENT_IN_HOME, AMBIENT_IN_GROK_HOME, VENDOR_ENV_RE,
};
