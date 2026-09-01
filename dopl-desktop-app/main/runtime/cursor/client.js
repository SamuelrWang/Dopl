// THE `@cursor/sdk` LOADER — the CURSOR ADAPTER's platform half.
//
// ⚠ THE TARGET IS THE SDK IN LOCAL MODE, NOT THE CLI AND NOT ACP, AND THAT CHOICE IS THE WHOLE
// INTEGRATION. `cursor-research.md` measures four programmable surfaces:
//   `@cursor/sdk`        the real agent runtime as a library. `Agent.create({apiKey, model,
//                        local:{cwd, store, customTools, sandboxOptions}})`, `agent.send()`,
//                        `run.stream()`, `Agent.resume()`, per-turn `TokenUsage`,
//                        `agent.getUsage()`, inline `mcpServers`. ⚠ THE ONLY SURFACE WITH
//                        `customTools`, which is this runtime's Axis-B enforcement point.
//   `cursor-agent` CLI   headless `-p` with `stream-json`. ⚠ NO TOKEN FIELDS AT ALL in headless
//                        output, so the context meter goes dark on it. Not the target.
//   ACP                  `cursor-agent acp` — the ONE documented interactive per-tool approval
//                        channel (`session/request_permission`). It would give Axis A a real gate
//                        and it costs TEAM MCP SERVERS, and the design's step 8 ships the SDK
//                        path. Named here because it is the fallback X0/X1 would send us to.
//   Cloud Agents REST    remote execution. Out of scope (decision 6); `execution.remoteCapable`
//                        is `true` so the seam stays open.
//
// ⚠ THE SDK IS PUBLIC BETA (TS since 2026-04-29) and the research says the API shape may move.
// That is why every reader in this adapter is tolerant and why the whole surface is behind this
// one module: an API move is a change here, not a change everywhere.
//
// ⚠ THE SINGLE MODULE THAT IMPORTS THE SDK OR TOUCHES A CHILD PROCESS, so ESM interop, path math
// and binary probing live in exactly one place — the same contract `runtime/claude/loader.js` and
// `runtime/codex/client.js` hold for their own platforms.
//
// ⚠ DELIVERY IS `path` (see `packaging.js`): THIS RELEASE SHIPS NEITHER `@cursor/sdk` NOR
// `cursor-agent`. So `probe()` is a real question with a real refusal, and its reason has to be
// readable by an operator rather than by a log reader — a refusal an operator cannot read is one
// they work around.

const { execFile } = require('child_process');

const SDK_PKG = '@cursor/sdk';
const BIN = 'cursor-agent';
// ⚠ BOUNDED, because a probe that hangs takes the whole launch with it: `available()` is awaited
// on the spawn path, and a binary that never answers must read as absent rather than as a stuck
// session.
const PROBE_TIMEOUT_MS = 5000;

let _sdk = null; // cached ESM namespace

/**
 * The SDK namespace, imported once.
 *
 * ⚠ DYNAMIC IMPORT, NOT REQUIRE. The package is TypeScript/ESM and Electron main is CJS, so a
 * static require would throw `ERR_REQUIRE_ESM` even where the package IS present. Throws (caught
 * by `probe`) when it genuinely is not.
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
 * ⚠ THIS IS ONE OF THREE QUESTIONS AND ANSWERS ONLY ITS OWN. "Can the runtime module load", "is
 * there a `cursor-agent` on PATH" and "is this Mac signed in" are three questions with three
 * answers; collapsing them is how a machine with a perfectly good install came to be told channel
 * requests could not be answered. This one is the module. The binary is `probeBinary` below (a
 * diagnostic, not a gate — the SDK is the runtime). The credential is `credential.js`.
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
      // ⚠ NAMES WHAT TO DO, NOT AN ERRNO. `packaging.delivery` is `path` for v1, so "install it"
      // is a real answer and the operator is the one who can act on it.
      reason: `\`${SDK_PKG}\` is not available to this build — Dopl does not bundle the Cursor SDK. `
        + `Install it alongside Dopl and re-open. (${(err && err.message) || err})`,
    };
  }
}

/**
 * Is there a `cursor-agent` on PATH, and what does it call itself?
 *
 * ⚠ A DIAGNOSTIC AND A CREDENTIAL PREREQUISITE, NOT THE LAUNCH GATE. The SDK is the runtime; this
 * binary is what `credential.js` asks about sign-in state, and its absence is why a sign-in probe
 * has to fail OPEN rather than take the machine off the air.
 */
function probeBinary() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish({
      ok: false,
      reason: `\`${BIN}\` did not answer within ${PROBE_TIMEOUT_MS}ms.`,
      version: null,
    }), PROBE_TIMEOUT_MS);
    try {
      execFile(BIN, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
        clearTimeout(timer);
        if (err) {
          finish({ ok: false, reason: `\`${BIN}\` is not on this Mac's PATH.`, version: null });
          return;
        }
        finish({ ok: true, reason: '', version: String(stdout || '').trim() || null });
      });
    } catch (err) {
      clearTimeout(timer);
      finish({ ok: false, reason: `\`${BIN}\` could not be started: ${(err && err.message) || err}`, version: null });
    }
  });
}

// ── THE AGENT FACTORY ────────────────────────────────────────────────────────────────────────
//
// ⚠ ONE PLACE CALLS `Agent.create` / `Agent.resume`, so a shape change in a public-beta SDK is one
// edit. The namespace's own layout is read TOLERANTLY for the same reason: the research names the
// verbs (`Agent.create()`, `agent.send()`, `run.stream()`, `Agent.resume()`) and does not print
// the module's export map, so both the named-export and the default-export shapes are accepted and
// an unrecognised one fails LOUDLY with what it saw rather than silently launching nothing.
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
  loadSdk, peekSdk, probe, probeBinary,
  agentNamespace, createAgent, resumeAgent,
};
