// The button launch lane from source: the real `session-launch-op.js` and `identity-resolve.js` over
// a faked `/resolve` transport, channel prefs and engine.

import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";
import { launchDefaultStub } from "./_launch-runtime-stub.mjs";

const REAL_DEPS = ["./ipc-guards", "./launch-directive-vocab", "./agent-id", "./runtime/selection-vocabulary", "./session-telemetry"];
const realDeps = () => Object.fromEntries(REAL_DEPS.map((id) => [id, real(id)]));
const refuseFetch = async (path) => { throw new Error(`unexpected apiFetch ${path}`); };

/** The real `identity-resolve.js`; `apiFetch` answers `/resolve`. */
export function bootIdentityResolve(apiFetch = refuseFetch) {
  return loadWithStubs("identity-resolve.js", { ...realDeps(), "./diag": { diag: () => {} }, "./api": { apiFetch } });
}

/**
 * The real `session-launch-op.js`. `prefs` extends the channel-prefs fake, `answer` is the engine's
 * reply, `launchDefault` replaces the passthrough runtime seam. Engine specs land in `launches`.
 */
export function bootLaunchOp({ apiFetch, prefs = {}, answer = { agentId: "ag-1", sessionId: "s-1" }, launchDefault } = {}) {
  const launches = [];
  const resolve = bootIdentityResolve(apiFetch);
  const op = loadWithStubs("session-launch-op.js", {
    ...realDeps(),
    "./diag": { diag: () => {} },
    "./identity-resolve": resolve,
    "./channel-listener": { watchedChannel: () => ({ channel: { myAgentToolProfile: "full" } }) },
    // A constant profile; `channel-agent-profile.test.mjs` drives the real containment rule.
    "./targeting": { resolveToolProfile: () => "full", resolveLaunchToolProfile: () => "full" },
    "./channel-prefs": {
      launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }),
      isIdentityApproved: () => true,
      ...prefs,
    },
    "./session-engine": { launchRequesterSession: async (spec) => { launches.push(spec); return answer; } },
    "./runtime/launch-default": launchDefault || launchDefaultStub(),
  });
  return { ...op, resolve, launches };
}
