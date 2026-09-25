// "Use my tools" on Claude (`main/operator-tools.js` decides WHEN; the gate still judges every call):
// the operator's user-scope MCP servers, claude.ai connectors, Claude in Chrome, their skills and
// agents, and the CLI's own Agent/Skill. Read and passed EXPLICITLY; `settingSources` stays `[]`,
// because their user settings would also bring their permission allow-list (a pre-approval shadows
// Dopl's gate, so the per-turn safeguard could never fire), their hooks (commands no gate sees) and
// their env block (which could replace Dopl's credential).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MCP_URL } = require('../../config');
const { NATIVE_BUILTINS } = require('../../tool-profiles');
const { CLAUDEAI_MCP_ENV } = require('./loader');
const { diag } = require('../../diag');

const MCP_HOST = new URL(MCP_URL).host;
// Dopl's own entry is the session's container-locked one; a second route to Dopl would bypass the lock.
const isDoplEntry = (name, entry) => {
  if (name === 'dopl') return true;
  try { return typeof entry.url === 'string' && new URL(entry.url).host === MCP_HOST; } catch (_) { return false; }
};

/** The CLI's USER scope (`~/.claude.json › mcpServers`): a project entry is not the operator's everywhere. */
function userMcpServers(home) {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')); } catch (_) { return {}; }
  const servers = cfg && cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
  const out = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && !isDoplEntry(name, entry)) out[name] = entry;
  }
  return out;
}

// A Dopl-owned local plugin whose `skills` / `agents` link to the operator's own: the one way to load
// them without their settings (measured, claude 2.1.220: `settingSources: []` lists only the bundled
// skills; this plugin adds each `~/.claude/skills` entry as `my:<name>`).
const PLUGIN_DIR = 'operator-tools-plugin';
const PLUGIN_NAME = 'my';
function operatorPlugin(home) {
  let dir;
  try { dir = path.join(require('electron').app.getPath('userData'), PLUGIN_DIR); } catch (_) { return null; }
  try {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true, mode: 0o700 });
    const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ name: PLUGIN_NAME }), { mode: 0o600 });
    for (const part of ['skills', 'agents']) {
      const target = path.join(home, '.claude', part);
      const at = path.join(dir, part);
      if (fs.existsSync(target) && !lstat(at)) fs.symlinkSync(target, at, 'dir');
    }
    return { type: 'local', path: dir };
  } catch (err) {
    diag('claude: operator skills plugin unavailable —', err && err.message);
    return null;
  }
}
const lstat = (p) => { try { return fs.lstatSync(p); } catch (_) { return null; } };

/** Widen one spawn's options with the operator's tooling. Dopl's own entries win a name clash. */
function withOperatorTools(options, home) {
  const h = home || os.homedir();
  const out = options;
  out.mcpServers = Object.assign(userMcpServers(h), out.mcpServers);
  out.tools = (out.tools || []).concat(NATIVE_BUILTINS);
  // Connectors and Chrome need a claude.ai login's scopes; on Dopl's setup-token they stay off by themselves.
  delete out.env[CLAUDEAI_MCP_ENV];
  out.extraArgs = Object.assign({}, out.extraArgs, { chrome: null });
  const plugin = operatorPlugin(h);
  if (plugin) out.plugins = [plugin];
  return out;
}

module.exports = { withOperatorTools, userMcpServers };
