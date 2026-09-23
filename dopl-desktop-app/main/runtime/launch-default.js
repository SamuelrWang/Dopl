// THE RUNTIME'S OWN DEFAULT MODEL — what a launch that NAMED NO MODEL starts on (2026-09-23).
//
// 🔒 **THE ORDER EVERY LAUNCH RESOLVES ITS MODEL IN, AND THIS FILE IS THE LAST LINK** (Samuel:
// *"either the agent will choose it, or the agent is launched by another agent … or you can just
// have it go to the default model"*):
//
//   1. the LAUNCHER's explicit pick — the New Agent dialog, or the MCP `model` param
//   2. the agent IDENTITY's model, when it names one THIS runtime offers (`identityModelFor`)
//   3. the RUNTIME's default — THIS FILE
//
// There is no channel link and no profile link any more: the "pin model" settings are deleted,
// and with them the "the channel's model is no longer offered" refusal. Links 1 and 2 are the
// launch lanes' (`session-launch-op.js`, `launch-directive-spawn.js`); this one runs ONCE, in the
// funnel every lane shares (`session-launch.js › launch`), so no lane can forget it.
//
// ⚠ **A DEFAULT IS NEVER A REFUSAL.** A runtime declares a PREFERRED default id
// (`descriptor.models.launchDefault` — Codex: `gpt-6-sol`, Samuel: *"I think we should do Sol"*).
// It is spent ONLY when this account's LIVE catalog is `ready` and carries it; otherwise the launch
// names NO model and the platform picks its own (`descriptor.models.defaultMeansAbsent`). A
// catalog that is loading, unavailable or stale is not evidence the model exists — and naming it
// anyway would turn "Dopl could not check" into a `no-model` refusal of a launch nobody asked a
// model of.
// ⚠ A runtime that declares no `launchDefault` is untouched here. Claude's default is its adapter's
// own (`session-model.js › LAUNCH_MODEL_FALLBACK`, applied by `modelArg` on an absent pick).
//
// ⚠ IT REQUIRES NOTHING STATEFUL AT LOAD (only the pure `selection-vocabulary.js`). The catalog and
// the registry are reached lazily (or injected), so the file is driven standalone by its suites.

const { pickOf } = require('./selection-vocabulary');

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The runtime's declared preferred default id, or `''`. */
function preferredDefault(descriptor) {
  return str(descriptor && descriptor.models && descriptor.models.launchDefault);
}

/** Does this catalog PROVE the model is offered? ⚠ `ready` only — see the header. */
function catalogOffers(catalog, id) {
  if (!id || !catalog || catalog.status !== 'ready' || !Array.isArray(catalog.models)) return false;
  return catalog.models.some((m) => m && (m.id === id || (Array.isArray(m.aliases) && m.aliases.indexOf(id) !== -1)));
}

/** PURE: the id a no-pick launch should name on this runtime, or `''` for "name none". */
function launchDefaultFrom(descriptor, catalog) {
  const preferred = preferredDefault(descriptor);
  return catalogOffers(catalog, preferred) ? preferred : '';
}

const named = (model) => !!pickOf(model);

/**
 * The model this launch should carry on `adapter` (the SEALED adapter the launch acquired, never
 * an id re-resolved here): the pick it already names, else the runtime's default when its live
 * catalog offers it, else what it came with (no model — the platform's own pick).
 * ⚠ THE ROSTER IS ASKED ONLY WHEN THERE IS A QUESTION — no pick AND a declared default — so a
 * Claude launch never waits on a Codex app-server.
 * ⚠ NEVER THROWS. Any failure answers the input unchanged, which is the no-model direction.
 */
async function withRuntimeDefault(adapter, model, catalogs) {
  if (named(model)) return model;
  const descriptor = adapter && adapter.descriptor;
  if (!preferredDefault(descriptor)) return model;
  try {
    const catalog = await (catalogs || require('./model-catalog')).settle(adapter);
    return launchDefaultFrom(descriptor, catalog) || model;
  } catch (_err) {
    return model;
  }
}

// ── THE IDENTITY LINK, ON THE LAUNCH RUNTIME (2026-09-23, follow-up) ─────────────────────────
//
// 🔒 **AN IDENTITY'S MODEL MUST BELONG TO THE RUNTIME THE LAUNCH RUNS ON.** An identity is a
// DEFAULT, not a pick: one authored on Claude (`claude-opus-5`) launched on Codex is not a request
// for Codex to run Opus, so the link is SKIPPED and the runtime's default applies — never a
// `no-model` refusal. Only the LAUNCHER's explicit pick (link 1) is refused when the runtime does
// not offer it (`session-launch.js › refuseUnknownModel`). Every lane asks this ONE function, so
// the button, the MCP directive (default and non-default runtime alike) cannot drift.
// ⚠ "BELONGS" IS ASKED OF THE RUNTIME'S OWN CATALOG, AND A CATALOG THAT HOLDS NO MODELS CANNOT
// ANSWER IT — then the model travels as given, the same fail-open the funnel's refusal uses (a
// roster Dopl could not read is not evidence a model does not exist).

/** Does this catalog hold any model it could answer a membership question with? */
const catalogHolds = (catalog) => !!(catalog && Array.isArray(catalog.models) && catalog.models.length);

/** Is `id` one of this catalog's models (by id or alias), whatever its status? */
function offeredBy(catalog, id) {
  return catalogHolds(catalog)
    && catalog.models.some((m) => m && (m.id === id || (Array.isArray(m.aliases) && m.aliases.indexOf(id) !== -1)));
}

/**
 * The identity's model if runtime `runtimeId` offers it, `''` ("skip to the runtime default") when
 * that runtime's roster positively lacks it, or the model as given when the roster cannot say.
 * ⚠ NEVER THROWS; the fallback is "as given", which the funnel then resolves or fails open on.
 */
async function identityModelFor(runtimeId, model, catalogs, registry) {
  if (!named(model)) return '';
  const v = str(model);
  try {
    const adapter = (registry || require('./index')).resolve(runtimeId);
    const catalog = await (catalogs || require('./model-catalog')).settle(adapter);
    if (!catalogHolds(catalog)) return v;
    return offeredBy(catalog, v) ? v : '';
  } catch (_err) {
    return v;
  }
}

// ── THE LAUNCH RUNTIME (Samuel's ruling 5, 2026-09-23) ───────────────────────────────────────
//
// Order: the launcher's explicit pick -> the identity's runtime -> the channel's runtime -> the
// registry default. The first two are ASKS: one this Mac cannot run is refused (`no-sdk`), never
// swapped for another vendor. The last two are inherited defaults and fail open, as they always did.
// ⚠ Membership (`ids()`) before `acquire()`: `resolve` fails open to the default for an unknown id.

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
 * Which runtime a launch runs on. `{ ok: true, runtimeId, source }` with a concrete registered id,
 * or `{ ok: false, reason: 'no-sdk', runtimeId }` naming the asked id. `deps` is for the suites.
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
  preferredDefault, catalogOffers, launchDefaultFrom, withRuntimeDefault,
  offeredBy, identityModelFor, resolveLaunchRuntime,
};
