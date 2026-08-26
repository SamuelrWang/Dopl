// The `claude mcp …` half of Feature E — every place this app shells out to the
// CLI to look after its OWN user-scope `dopl` server entry.
//
// SPLIT NOTE (2026-07-31): extracted from mcp-config.js at the §2 500-line cap.
// mcp-config.js keeps the policy (when to add, when to leave alone, when a fresh
// mint forces a refresh); this file is the three child-process calls it makes.
// Nothing here is exported beyond mcp-config.
//
// THIS FILE NEVER EDITS `~/.claude.json` DIRECTLY. `claude mcp add/remove/get` is
// the only interface we use to the operator's own config — the deleted
// mcp-cli-entry.js rewrote that file in place to add a per-server `timeout`, and
// the decision (recorded in docs/ENGINEERING.md) is that a file holding the
// operator's `oauthAccount` block is not ours to rewrite. The timeout lives on
// the entries we own inside this process instead.
//
// The token is passed as a single `--header` argv element. execFile takes no
// shell, so it is never exposed on a command line, and it is never logged.

const { execFile } = require('child_process');

const spawner = require('./session-spawner');
const { diag } = require('./diag');
const { MCP_URL } = require('./config');

const CLI_TIMEOUT_MS = 25_000;

function cliOpts(bin) {
  return { timeout: CLI_TIMEOUT_MS, env: spawner.cliEnv(bin), windowsHide: true };
}

// ⚠ THE URL LINE ONLY, AND NEVER THE HEADER LINES. `claude mcp get dopl` prints the
// entry's `Authorization: Bearer …` back out, so this parser must take the ONE field
// it needs and the rest of that stdout must never reach a diag, a log or a return
// value. The regex is anchored to a `URL:` label at the start of a line for that
// reason — a looser scan over the whole blob can match inside a header value.
function parseEntryUrl(stdout) {
  const m = /^\s*URL:\s*(\S+)\s*$/m.exec(String(stdout || ''));
  return m ? m[1] : '';
}

// WHAT THE OPERATOR'S CLI CONFIG SAYS ABOUT `dopl`, in the three answers the caller
// can act on differently:
//   { state: 'absent'  }            confirmed absent → safe to add, no duplicate risk
//   { state: 'present', url }       an entry exists; `url` is '' when unparseable
//   { state: 'unknown' }            timeout / spawn error → touch NOTHING
//
// ⚠ 'unknown' AND 'present' ARE DELIBERATELY DIFFERENT ANSWERS NOW. They were one
// boolean (`mcpEntryConfirmedAbsent`) until 2026-08-25, which is what made the stale
// entry below unfixable: a probe that cannot distinguish "an entry exists and it
// points somewhere else" from "the CLI did not answer" has to leave both alone.
function probeMcpEntry(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['mcp', 'get', 'dopl'], cliOpts(bin), (err, stdout) => {
      if (!err) {
        resolve({ state: 'present', url: parseEntryUrl(stdout) });
        return;
      }
      const out = String(stdout || '') + ' ' + String((err && err.message) || '');
      if (err.code === 1 || /No MCP server named/i.test(out)) {
        resolve({ state: 'absent', url: '' });
        return;
      }
      diag('mcp-config: get ambiguous —', err.code || (err && err.message));
      resolve({ state: 'unknown', url: '' }); // unknown → don't add (avoid dupes)
    });
  });
}

function removeMcpEntry(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['mcp', 'remove', '--scope', 'user', 'dopl'], cliOpts(bin), (err) => resolve(!err));
  });
}

function addMcpEntry(bin, token) {
  return new Promise((resolve) => {
    execFile(
      bin,
      [
        'mcp', 'add', '--transport', 'http', 'dopl', MCP_URL,
        '--scope', 'user',
        '--header', `Authorization: Bearer ${token}`,
      ],
      cliOpts(bin),
      (err) => resolve(!err)
    );
  });
}

module.exports = { probeMcpEntry, parseEntryUrl, removeMcpEntry, addMcpEntry };
