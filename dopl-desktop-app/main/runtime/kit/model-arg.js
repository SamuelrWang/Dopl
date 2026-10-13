// The pass-through `runtime.modelArg` (docs/specs/runtime-scaffold.md §8): a pick → the launch argument
// `{ ok, arg, id, reason }`, as given. For a runtime whose model-pick vocabulary IS the id it launches
// with — the funnel (`launch-directive-spawn.js › resolveModel`) already refused an unknown pick on the
// live catalog. A runtime that maps picks (aliases, a default it spends itself) writes its own.

const { pickOf } = require('../selection-vocabulary');

/** A pick → `{ ok, arg, id, reason }`. Picks pass as given. */
function passThroughModelArg(value) {
  const v = pickOf(value);
  return { ok: true, arg: v, id: v, reason: '' };
}

module.exports = { passThroughModelArg };
