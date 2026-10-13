// CLAUDE CODE DESCRIBES ITSELF — the pairing new launches run (bundled SDK + the ACTIVE CLI), turn-free
// (`roster.js › observeShape`). Backs `runtime.shape()`; checked against `required-shape.js`
// (`../sdk-shape.js`). Electron-free at load: the client, resolver and credential are reached lazily.

const roster = require('./roster');

/** The pairing's own Shape (exports, methods, result fields). */
async function describe() {
  const client = require('./client');
  const sdk = await client.getSdk();
  const options = { env: require('./credential').withCredential(client.buildScrubbedEnv()) };
  const bin = require('./resolve-bin').resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  return roster.observeShape({ sdk, options });
}

module.exports = { describe };
