// THE `@cursor/sdk` LOADER — the CURSOR ADAPTER's platform half.
//
// ⚠ THE TARGET IS THE SDK IN LOCAL MODE, NOT THE CLI AND NOT ACP (`cursor-research.md`):
//   `@cursor/sdk`       the agent runtime as a library (`Agent.create`, `agent.send`, `run.stream`,
//                       `Agent.resume`, per-turn `TokenUsage`). ⚠ THE ONLY SURFACE WITH
//                       `customTools`, which is this runtime's Axis-B enforcement point.
//   `cursor-agent` CLI  headless `stream-json` has NO TOKEN FIELDS, so the context meter goes dark.
//   ACP                 the one documented per-tool approval channel, but it costs TEAM MCP SERVERS;
//                       it is the fallback X0/X1 would send us to.
//   Cloud Agents REST   remote execution, out of scope (decision 6).
// ⚠ THE SDK IS PUBLIC BETA, so every reader in this adapter is tolerant and the whole surface sits
// behind this one module: an API move is a change here, not everywhere.
// ⚠ THE SINGLE MODULE THAT IMPORTS THE SDK — the same contract
// `runtime/claude/loader.js` and `runtime/codex/client.js` hold.
// ⚠ DELIVERY IS `path` (`packaging.js`): this release ships neither the SDK nor `cursor-agent`, so
// `probe()` refuses for real and its reason must be readable by an operator.

const SDK_PKG = '@cursor/sdk';
const BIN = 'cursor-agent';
// ⚠ BOUNDED: a binary that never answers must read as absent, not as a stuck launch.
const PROBE_TIMEOUT_MS = 5000;

let _sdk = null; // cached ESM namespace

/**
 * The SDK namespace, imported once.
 *
 * ⚠ DYNAMIC IMPORT, NOT REQUIRE: the package is ESM and Electron main is CJS, so a static require
 * throws `ERR_REQUIRE_ESM` even where the package IS present. Throws (caught by `probe`) when absent.
 */
async function loadSdk() {
  if (!_sdk) _sdk = await import(SDK_PKG);
  return _sdk;
}

/** The cached namespace or null — for a synchronous caller that must not import. */
const peekSdk = () => _sdk;

/**
 * Can this release start a Cursor session on this Mac?
 *
 * ⚠ ONE OF THREE QUESTIONS AND ANSWERS ONLY ITS OWN: "does the module load" (this), "is
 * `cursor-agent` on PATH" and "is this Mac signed in" (`credential.js`). Collapsing them is how a
 * machine with a good install was told channel requests could not be answered.
 */
async function probe() {
  try {
    const sdk = await loadSdk();
    if (!sdk || typeof sdk !== 'object') {
      return { ok: false, reason: `\`${SDK_PKG}\` loaded but exported nothing Dopl can drive.` };
    }
    return { ok: true, reason: '' };
  } catch (err) {
    return {
      ok: false,
      // ⚠ NAMES WHAT TO DO, NOT AN ERRNO: delivery is `path`, so "install it" is a real answer.
      reason: `\`${SDK_PKG}\` is not available to this build — Dopl does not bundle the Cursor SDK. `
        + `Install it alongside Dopl and re-open. (${(err && err.message) || err})`,
    };
  }
}

// ── THE AGENT FACTORY ────────────────────────────────────────────────────────────────────────
//
// ⚠ ONE PLACE CALLS `Agent.create` / `Agent.resume`. The export map is undocumented, so named and
// default export shapes are both accepted and an unrecognised one fails LOUDLY rather than
// silently launching nothing.
function agentNamespace(sdk) {
  const ns = sdk || {};
  if (ns.Agent && typeof ns.Agent.create === 'function') return ns.Agent;
  if (ns.default && ns.default.Agent && typeof ns.default.Agent.create === 'function') return ns.default.Agent;
  throw new Error(`${SDK_PKG} exposes no Agent.create — this adapter is built against the documented SDK surface`);
}

async function createAgent(options) {
  const Agent = agentNamespace(await loadSdk());
  return Agent.create(options);
}

async function resumeAgent(agentId, options) {
  const Agent = agentNamespace(await loadSdk());
  if (typeof Agent.resume !== 'function') throw new Error(`${SDK_PKG} exposes no Agent.resume`);
  return Agent.resume(agentId, options);
}

module.exports = {
  SDK_PKG, BIN, PROBE_TIMEOUT_MS,
  loadSdk, peekSdk, probe,
  createAgent, resumeAgent,
};
