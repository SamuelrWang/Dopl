// `runtime:signIn` — one in-app sign-in op for every runtime. The id resolves on the registry (`''` = the
// default runtime) and that runtime's own `signIn()` runs only where its descriptor declares an in-app flow.
// Each runtime's `signIn()` re-probes its credential and releases its own held sessions; the answer is its
// `{ ok }`, with no reason (one refusal shape, as every op in `session-ipc-ops.js`).

const runtimeRegistry = require('./runtime');
const { diag } = require('./diag');

async function signIn(runtimeId) {
  const id = runtimeId || runtimeRegistry.DEFAULT_ID;
  if (runtimeRegistry.ids().indexOf(id) === -1) return { ok: false };
  if (!runtimeRegistry.copy.canSignIn(runtimeRegistry.descriptorFor(id))) return { ok: false };
  try {
    const res = await runtimeRegistry.runtimeFor(id).signIn();
    if (!res || res.ok !== true) return { ok: false };
    return { ok: true, resumed: Number.isInteger(res.resumed) ? res.resumed : 0 };
  } catch (err) {
    diag('runtime signin: threw —', (err && err.message) || err);
    return { ok: false };
  }
}

module.exports = { signIn };
