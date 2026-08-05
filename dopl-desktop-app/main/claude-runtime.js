const { claudeAvailable } = require('./claude-resolve');
const { diag } = require('./diag');

// CAN THIS MACHINE RUN A CLAUDE SESSION AT ALL? (2026-08-04, launch-critical)
//
// Its own module, and the smallest one in main/, because the whole defect was that
// this question had no home and got answered by a function that answers a DIFFERENT
// one. Splitting it out is the fix's durable half: the next caller that needs "can
// we spawn" now has somewhere obvious to reach, instead of reaching for the CLI
// probe next to it.
//
// THE DEFECT. `trigger.handleTrigger` gated every inbound channel trigger on
// `claudeAvailable()` and returned before creating anything if it was false. But
// `claudeAvailable` answers a DIFFERENT QUESTION than the one that gate needed:
// it is `claude-resolve.resolveClaude()`, which is `probeStaticPath()` (common
// install dirs) || `probeLoginShell()` — an EXTERNAL `claude` on PATH, and
// nothing else. The binary a SESSION actually runs ships INSIDE the app bundle
// (`sdk-loader.resolveClaudeExecutable`, asar-unpacked and signed), which
// `session-auth-detect.js` already documents in as many words.
//
// So on a fresh install by somebody who never separately installed the Claude
// Code CLI — which is most people we are distributing to — every inbound channel
// request was dropped SILENTLY: no consent row, no notification, no window,
// nothing in the product to look at. It is invisible from a developer machine,
// where the CLI is present and the startup diag reads `claudeAvailable: true`.
//
// TWO QUESTIONS, TWO NAMES, and keeping them apart is the fix rather than a
// tidy-up. They have different answers on the same machine:
//   `claudeAvailable()`      — is there an EXTERNAL cli for auxiliary commands
//                              (`claude mcp …`, `claude setup-token`)? Those
//                              genuinely need a binary on PATH.
//   `sessionSpawnAvailable()`— can a session be RUN, by any route? The bundled
//                              executable first (the SDK/window path, and the
//                              normal one), the external CLI second (the headless
//                              fallback). Either is enough to answer a request.
//
// LAZY require of sdk-loader, deliberately: it pulls `electron.app` at module
// scope, and this module is loaded by harnesses that stub electron thinly. A
// throw here must degrade to "no bundled binary" and let the external probe
// answer, never take the trigger path down with it — which is the failure mode
// this whole function exists to remove.
async function sessionSpawnAvailable() {
  try {
    if (require('./sdk-loader').resolveClaudeExecutable()) return true;
  } catch (err) {
    diag('sessionSpawnAvailable: bundled probe failed', err && err.message);
  }
  return claudeAvailable();
}

// The startup notice, here rather than in channel-listener.js — it is a statement
// about the runtime, and the listener has no business deciding what is true about
// one. `notify` is injected so this module stays free of electron.
//
// IT WARNS ONLY WHEN NOTHING CAN RUN. The old copy fired on the EXTERNAL probe and
// said "Channel auto-responses stay off until it is installed" — false on every
// install that never added the CLI, since the bundled binary answers requests
// perfectly well. (Until this same release the claim was accidentally TRUE, because
// `trigger.handleTrigger` gated on that same wrong probe and dropped every request.
// Both halves are fixed together; a notice must not outlive the defect it described.)
const NO_RUNTIME_NOTICE = {
  title: 'Dopl',
  body: 'No Claude Code runtime was found on this Mac, so channel requests cannot be answered. Reinstall Dopl, or install the Claude Code CLI.',
};

async function checkRuntimeAtStart({ externalCli, notify, log }) {
  const [canSpawn, hasExternalCli] = await Promise.all([
    sessionSpawnAvailable(),
    externalCli(),
  ]);
  // BOTH facts, because they are different questions with different answers and
  // the diag is what a support session reads first.
  if (log) log('sessionSpawnAvailable at start:', canSpawn, '| external claude on PATH:', hasExternalCli);
  if (canSpawn) return false;
  if (notify) notify(NO_RUNTIME_NOTICE);
  return true;
}

module.exports = { sessionSpawnAvailable, checkRuntimeAtStart, NO_RUNTIME_NOTICE };
