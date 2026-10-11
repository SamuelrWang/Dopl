// Shared diagnostic file log.
//
// Console output is invisible for a GUI-launched app, and several decision
// points (targeting verdicts, FYI sent/muted, sign-in flow states, mcp-config
// ensure results) are deliberately silent. Append one-line diagnostics to
// userData/listener.log so those decisions are observable in the field.
// Past ~1MB the log ROTATES to listener.log.1 (one prior file kept, overwritten on
// the next wrap) so a wrap never erases the history just before it (KB
// dopl-development "Silent Agent Drops 2026-10-11"). A failed rename falls back to
// truncation so the log stays bounded.
//
// SECURITY: never pass tokens or secrets to diag() — the log is plaintext.
// Callers redact before logging (mcp-config / claude-auth log outcomes, never
// the token value).

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function diag(...parts) {
  try {
    const f = path.join(app.getPath('userData'), 'listener.log');
    try {
      const st = fs.statSync(f);
      if (st.size > 1_000_000) {
        try {
          fs.renameSync(f, f + '.1');
        } catch (_) {
          fs.truncateSync(f, 0);
        }
      }
    } catch (_) {
      /* first write */
    }
    fs.appendFileSync(f, `${new Date().toISOString()} ${parts.join(' ')}\n`);
  } catch (_) {
    /* never let logging break a caller */
  }
}

module.exports = { diag };
