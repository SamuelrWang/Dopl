// The `./runtime/launch-default` seam for the button-lane harnesses: the REAL launch-runtime order
// (`resolveLaunchRuntime`, ruling 5) over a fake registry, and a passthrough identity-model link
// unless a suite hands in its own. One copy, so the harnesses cannot drift on the order.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const LD = require(join(dirname(fileURLToPath(import.meta.url)), "..", "main", "runtime", "launch-default.js"));

export const REGISTERED = ["claude", "codex", "cursor"];

/** A fake registry: every id in `usable` passes `acquire`, the rest are "not installed". */
export function fakeRegistry(usable = REGISTERED) {
  return {
    ids: () => REGISTERED.slice(),
    DEFAULT_ID: REGISTERED[0],
    acquire: async (id) => {
      if (usable.indexOf(id) === -1) throw new Error(`${id} is not installed`);
    },
  };
}

export function launchDefaultStub(opts = {}) {
  const deps = {
    registry: fakeRegistry(opts.usable),
    channelRuntime: { getChannelRuntime: () => opts.channelRuntime || "" },
  };
  return {
    identityModelFor: opts.identityModelFor || (async (_rid, m) => m || ""),
    resolveLaunchRuntime: (args) => LD.resolveLaunchRuntime(args, deps),
  };
}
