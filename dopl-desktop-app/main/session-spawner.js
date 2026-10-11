// Claude Code RESOLUTION + CONTAINMENT, re-exported for every caller that needs to reach the
// operator's CLI.
//
// ⚠ IT RUNS NOTHING (the headless `claude -p` executor was deleted 2026-08-20, Samuel's ruling;
// there is no second executor). What survives is a FACADE, AND IT IS LOAD-BEARING FOR FIVE CALLERS. `claudeAvailable`,
// `getClaudeBinPath` and `cliEnv` come from `claude-resolve.js`; `sessionSpawnAvailable` from
// `claude-runtime.js`. Nothing here computes
// them — this module is the NAME those callers already import (`mcp-config.js`,
// `mcp-cli-add.js`, `claude-auth.js`, `channel-listener.js`, `trigger.js`),
// and collapsing it into five direct imports is a rename with no other effect. If that is worth
// doing, do it as its own change.
//
// ⚠ `claudeAvailable()` AND `sessionSpawnAvailable()` ARE STILL DIFFERENT QUESTIONS (§11). The
// first asks "is there an EXTERNAL `claude` on PATH" — what `claude mcp …` needs; the second
// asks "can a session RUN at all", on any registered runtime (the registry's `available()`).
// Anything gating a channel trigger or a session launch asks the SECOND. Do not collapse them.

const { claudeAvailable, getClaudeBinPath, cliEnv } = require('./claude-resolve');
const { sessionSpawnAvailable } = require('./claude-runtime');

module.exports = {
  // "can a session RUN at all" (any registered runtime) — the gate every trigger asks.
  sessionSpawnAvailable,
  // CLI resolution / env (claude-resolve.js) — what `claude mcp …` and the sign-in pty need.
  claudeAvailable,
  getClaudeBinPath,
  cliEnv,
};
