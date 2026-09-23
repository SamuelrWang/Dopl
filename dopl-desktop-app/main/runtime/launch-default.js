// The last links of a launch's model and runtime resolution. Model order: the launcher's explicit
// pick → the identity's model (only if the launch runtime offers it) → the runtime's default. The
// default is applied once, in the funnel every lane shares (`session-launch.js › launch`).
//
// A default is never a refusal: only the launcher's explicit pick is refused (`no-model`). The
// catalog and the registry are reached lazily or injected (`deps`), so the suites drive this alone.

const { pickOf } = require('./selection-vocabulary');
const modelCatalog = require('./model-catalog');

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The runtime's declared default model id (`descriptor.models.launchDefault`), or `''`. */
function preferredDefault(descriptor) {
  return str(descriptor && descriptor.models && descriptor.models.launchDefault);
}

/** PURE: the id a no-pick launch should name on this runtime, or `''` for "name none". */
function launchDefaultFrom(descriptor, catalog) {
  const preferred = preferredDefault(descriptor);
  return modelCatalog.offers(catalog, preferred) ? preferred : '';
}

// An adapter whose own resolver already turns "no pick" into a model (Claude) spends its default
// itself, so the launch never waits on a roster read for it.
function resolvesOwnDefault(adapter) {
  try {
    const r = adapter.runtime.modelArg('');
    return !!(r && r.ok && r.id);
  } catch (_err) {
    return false;
  }
}

/**
 * The model this launch carries on `adapter` (the sealed adapter the launch acquired): the pick it
 * names, else the declared default when a READY live catalog offers it, else no model (the platform
 * picks). Never throws; any failure answers the input unchanged.
 */
async function withRuntimeDefault(adapter, model, deps) {
  if (pickOf(model)) return model;
  const descriptor = adapter && adapter.descriptor;
  if (!preferredDefault(descriptor) || resolvesOwnDefault(adapter)) return model;
  try {
    const catalog = await ((deps && deps.catalogs) || modelCatalog).settle(adapter);
    return launchDefaultFrom(descriptor, catalog) || model;
  } catch (_err) {
    return model;
  }
}

/**
 * The identity's model if the launch runtime offers it, else `''` (skip to the runtime default —
 * never a refusal). An identity bound to ANOTHER runtime is skipped outright; when the launch
 * runtime's catalog cannot vouch, the model is kept only on the identity's own runtime (X-03).
 * `deps` = `{ catalogs, registry }` for the suites. Never throws.
 */
async function identityModelFor(runtimeId, model, identityRuntime, deps) {
  const v = pickOf(model);
  if (!v) return '';
  const own = str(identityRuntime);
  const d = deps || {};
  let adapter = null;
  try {
    adapter = (d.registry || require('./index')).resolve(runtimeId);
  } catch (_err) {
    adapter = null;
  }
  const launchId = (adapter && adapter.descriptor && adapter.descriptor.id) || str(runtimeId);
  if (own && own !== launchId) return '';
  try {
    const catalog = adapter ? await (d.catalogs || modelCatalog).settle(adapter) : null;
    if (modelCatalog.vouches(catalog)) return modelCatalog.findModel(catalog, v) ? v : '';
  } catch (_err) { /* cannot vouch */ }
  return own ? v : '';
}

// The launch runtime (Samuel's ruling 5): the launcher's pick → the identity's runtime → the
// channel's runtime → the registry default. The first two are asks: one this Mac cannot run is
// refused (`no-sdk`), never swapped for another vendor. Membership (`ids()`) is checked before
// `acquire()` because `resolve` fails open to the default for an unknown id.

async function usable(registry, id) {
  if (registry.ids().indexOf(id) === -1) return false;
  try {
    await registry.acquire(id);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Which runtime a launch runs on: `{ ok: true, runtimeId, source }` with a registered id, or
 * `{ ok: false, reason: 'no-sdk', runtimeId }` naming the asked id. `deps` is for the suites.
 */
async function resolveLaunchRuntime(args, deps) {
  const a = args || {};
  const d = deps || {};
  const registry = d.registry || require('./index');
  const asks = [
    ['pick', str(a.pick)],
    ['identity', str(a.identity && a.identity.runtime)],
  ];
  for (const [source, id] of asks) {
    if (!id) continue;
    if (!(await usable(registry, id))) return { ok: false, reason: 'no-sdk', runtimeId: id };
    return { ok: true, runtimeId: id, source: source };
  }
  let channel = '';
  try {
    channel = str((d.channelRuntime || require('../channel-runtime')).getChannelRuntime(a.channelId));
  } catch (_err) {
    channel = '';
  }
  if (channel && registry.ids().indexOf(channel) !== -1) return { ok: true, runtimeId: channel, source: 'channel' };
  return { ok: true, runtimeId: registry.DEFAULT_ID, source: 'default' };
}

module.exports = {
  preferredDefault, launchDefaultFrom, withRuntimeDefault, identityModelFor, resolveLaunchRuntime,
};
