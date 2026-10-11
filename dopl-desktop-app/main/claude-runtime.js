const { diag } = require('./diag');

// CAN THIS MACHINE RUN A SESSION AT ALL? Its own module so the question has an obvious home.
//
// ⚠ TWO QUESTIONS, TWO NAMES — keep them apart (2026-08-04 launch-critical defect: the trigger gated
// on the external-CLI probe and silently dropped every request on a fresh install, where only the
// app-bundled binary exists; pinned by `test/trigger-spawn-availability.test.mjs`):
//   `claudeAvailable()`       — is there an EXTERNAL cli on PATH for auxiliary commands
//                               (`claude mcp …`, `claude setup-token`)?
//   `sessionSpawnAvailable()` — can a session run on ANY registered runtime?
//
// Asks the runtime registry (`runtime/index.js › connectedIds`, leashed and cached), so a
// Codex-only Mac answers requests too (P3-01). A probe failure answers false: the trigger
// defers, it never drops.
async function sessionSpawnAvailable() {
  try {
    const ids = await require('./runtime').connectedIds();
    return Array.isArray(ids) && ids.length > 0;
  } catch (err) {
    diag('sessionSpawnAvailable: runtime probe failed', err && err.message);
    return false;
  }
}

// The startup notice: a statement about the runtime, so it lives here, not in channel-listener.js.
// `notify` is injected so this module stays free of electron. It warns ONLY when nothing can run:
// the external CLI's absence is no reason, since the bundled binary answers requests.
const NO_RUNTIME_NOTICE = {
  title: 'Dopl',
  body: `${require('./runtime').copy.noRuntimeCopy(null)}, so channel requests cannot be answered.`,
};

async function checkRuntimeAtStart({ externalCli, notify, log }) {
  const [canSpawn, hasExternalCli] = await Promise.all([
    sessionSpawnAvailable(),
    externalCli(),
  ]);
  // Both facts: different questions, and the diag is what a support session reads first.
  if (log) log('sessionSpawnAvailable at start:', canSpawn, '| external claude on PATH:', hasExternalCli);
  if (canSpawn) return false;
  if (notify) notify(NO_RUNTIME_NOTICE);
  return true;
}

module.exports = { sessionSpawnAvailable, checkRuntimeAtStart };
