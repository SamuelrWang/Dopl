// THE MODEL CATALOG — ONE NORMALIZED SHAPE FOR EVERY RUNTIME'S ROSTER, AND THE FOUR STATES A
// PICKER IS ALLOWED TO BE IN (2026-09-21, U6).
//
// ⚠ **IT EXISTS BECAUSE THE RENDERER HAD A HARDCODED CLAUDE TABLE AND EVERY RUNTIME READ IT.**
// `src/features/channels/lib/agent-models.ts` is four Claude ids with four labels, and the New
// Agent dialog, the channel Settings row, the profile defaults row and the agent cards all read
// it — so selecting Codex showed Fable/Opus/Sonnet/Haiku and submitted one of them. The plan's R1
// and its hardest invariant ("catalog failure must never substitute another runtime's models")
// cannot be satisfied by a second hardcoded table; they need the roster to arrive FROM the runtime
// that owns it, in one shape, with its own status.
//
// ⚠ **FOUR STATES, AND COLLAPSING ANY TWO IS THE BUG** (INVARIANTS §11 — UNKNOWN is not EMPTY):
//
//   ready        the roster was read and is current. `models` is what an operator may pick from.
//   loading      nothing has been read YET. `models` is EMPTY and that emptiness means NOTHING.
//                ⚠ A picker must render the platform default here, never "no models".
//   unavailable  a read was ATTEMPTED and FAILED, and `reason` says why in an operator's words.
//                `models` is empty, and that emptiness is a MEASUREMENT of a failure, not of a
//                roster. It is a different sentence and a different operator action from loading.
//   stale        we hold models read from a DIFFERENT binary/version than the one resolved now,
//                or a refresh failed while we still held a prior answer. `models` is the OLD list:
//                it still LABELS a historical id, and it may NOT be newly selected.
//
// ⚠ **EMPTY IS NEVER "THIS RUNTIME HAS NO MODELS".** No adapter can answer that, so no status
// spells it. A `ready` catalog with zero models is refused below and becomes `unavailable`.
//
// ⚠ **NOTHING HERE NAMES A VENDOR AND NOTHING HERE HOLDS A MODEL ID.** The whole module is keyed
// by the runtime id the registry hands it, and every entry comes off the adapter's own
// `models()`. That is what makes "no Fable may reach a Codex surface" a structural property
// rather than a rule somebody has to remember — there is no list here to leak.
//
// ⚠ **IT NEVER BLOCKS A READ ON A CHILD PROCESS.** A live roster costs a `codex app-server`
// spawn; a settings page that awaited one would take seconds to open and would hang on a wedged
// binary. So `snapshot()` answers from cache and kicks a BACKGROUND refresh, and the first answer
// on a cold process is `loading` — which is exactly what `loading` is for.

const CATALOG_VERSION = 1;

const STATUS = Object.freeze({
  READY: 'ready',
  LOADING: 'loading',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
});

// ⚠ A FAILED READ IS RETRIED, A SUCCESSFUL ONE IS NOT. The roster changes when the operator
// upgrades their CLI, which they cannot do while it is running; a FAILURE, though, is routinely
// the operator fixing an install with Dopl open, so it must not be cached for the life of the
// process.
// ⚠ **FIVE SECONDS, NOT SIXTY (CXP-5, 2026-09-22), BECAUSE THIS IS A FLOOR, NOT A CADENCE.**
// Nothing here runs on a timer: a failed roster is re-read only at the next LOOK — a picker
// mounting, or the renderer re-reading when its window regains focus after a settled failure
// (`use-runtime-catalogs.ts`). Sixty seconds meant an operator who ran `codex login` in a terminal
// and came straight back saw the old failure and had nothing left to trigger another look. The
// floor only collapses a burst of looks into one probe.
const FAILURE_TTL_MS = 5000;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * ONE MODEL, NORMALIZED. ⚠ EVERY FIELD BUT `id` IS OPTIONAL AND ABSENT IS `null`, NEVER `''`:
 * a runtime that does not name its models (Cursor's `models.list()` answers bare ids) must be
 * told apart from one that named it with an empty string.
 *
 * ⚠ `dimensions` IS PER MODEL, NOT PER RUNTIME, and that is the whole reason the entry is an
 * object rather than an id. Codex reports `supportedReasoningEfforts` on each model and they
 * DIFFER between models, so a reasoning-effort control sourced from the runtime would offer an
 * effort the selected model refuses. The plan's U6 scenario ("effort options change with the
 * selected model") is only satisfiable from here.
 */
function normalizeEntry(row) {
  if (typeof row === 'string') {
    const id = str(row);
    return id ? { id, label: null, short: null, isDefault: false, hidden: false, aliases: [], dimensions: {} } : null;
  }
  if (!row || typeof row !== 'object') return null;
  const id = str(row.id);
  if (!id) return null;
  const label = str(row.label) || str(row.displayName) || null;
  return {
    id,
    label,
    // ⚠ A GLANCE LABEL FALLS BACK TO THE FULL ONE, NEVER TO A TRUNCATION. A card chip that
    // invented "Fab…" would be this surface making up a model name.
    short: str(row.short) || label,
    isDefault: row.isDefault === true,
    // ⚠ HIDDEN MODELS STAY IN THE CATALOG AND OUT OF ORDINARY PICKERS (Decision #2). They are
    // carried rather than dropped so a session ALREADY on one can still be LABELLED.
    hidden: row.hidden === true,
    // ⚠ OTHER SPELLINGS THE ADAPTER ACCEPTS FOR THIS SAME MODEL (2026-09-22) — a legacy stored id,
    // the launch alias, an undated form. MATCHED, never offered: a picker lists `id`, and a stored
    // value that is an alias still finds its row (`findModel`), so an old pick keeps its label.
    aliases: aliasesOf(row.aliases, id),
    dimensions: normalizeDimensions(row.dimensions),
  };
}

function aliasesOf(raw, id) {
  const out = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const a = str(v);
    if (a && a !== id && out.indexOf(a) === -1) out.push(a);
  }
  return out;
}

/** `{ <dimensionKey>: { options: [{value,label,description}], default } }`, or `{}`. */
function normalizeDimensions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    const d = raw[key];
    if (!d || typeof d !== 'object') continue;
    const options = [];
    for (const opt of Array.isArray(d.options) ? d.options : []) {
      const value = typeof opt === 'string' ? str(opt) : str(opt && opt.value);
      if (!value || options.some((o) => o.value === value)) continue;
      options.push({
        value,
        label: (opt && str(opt.label)) || value,
        description: (opt && str(opt.description)) || null,
      });
    }
    if (!options.length) continue; // a dimension with no options is a control that writes nowhere
    const fallback = str(d.default);
    out[key] = {
      options,
      default: options.some((o) => o.value === fallback) ? fallback : null,
    };
  }
  return out;
}

/**
 * THE CATALOG A RENDERER RECEIVES. ⚠ ALWAYS THE SAME KEYS, ON EVERY STATUS — a shape that grows
 * fields when it succeeds is a shape every consumer has to feature-probe.
 */
function makeCatalog(runtimeId, source, status, extra) {
  return Object.assign({
    version: CATALOG_VERSION,
    runtime: str(runtimeId),
    source: str(source) || null,
    status,
    reason: '',
    key: null,
    models: [],
    defaultId: null,
    dimensions: [],
    truncated: false,
  }, extra || {});
}

/**
 * AN ADAPTER'S OWN ROSTER REPLY, TURNED INTO A CATALOG.
 *
 * ⚠ **THE ADAPTER IS NOT TRUSTED TO HAVE GOT THE SHAPE RIGHT.** It crossed no process boundary,
 * but it is the one piece of this contract each vendor directory writes for itself — so a
 * malformed row is dropped here rather than rendered, and a roster that claims `ready` with no
 * models becomes `unavailable` with a sentence instead of a picker that says nothing.
 *
 * ⚠ **EXACTLY ONE DEFAULT, AND A SECOND ONE IS NOT A TIE-BREAK.** `codex/client.js › catalogGate`
 * already treats "two defaults" as an unsupported protocol; here the catalog keeps the FIRST and
 * clears the flag on the rest, because a picker cannot render two defaults and a runtime that
 * reports two has already told us its answer is unreliable.
 */
function catalogFromRoster(runtimeId, descriptor, roster) {
  const declared = (descriptor && descriptor.models) || {};
  const source = str(declared.source) || (roster && str(roster.source)) || null;
  const dims = Array.isArray(declared.dimensions) ? declared.dimensions.slice() : [];
  if (!roster || typeof roster !== 'object') {
    return makeCatalog(runtimeId, source, STATUS.UNAVAILABLE, {
      dimensions: dims,
      reason: 'this runtime did not answer with a model roster',
    });
  }
  const reason = str(roster.reason);
  const key = str(roster.key) || null;
  const rows = Array.isArray(roster.models) ? roster.models
    : (Array.isArray(roster.ids) ? roster.ids : []);
  const models = [];
  for (const row of rows) {
    const entry = normalizeEntry(row);
    if (entry && !models.some((m) => m.id === entry.id)) models.push(entry);
  }
  let defaultId = null;
  for (const m of models) {
    if (!m.isDefault) continue;
    if (defaultId === null) defaultId = m.id;
    else m.isDefault = false;
  }
  const asked = str(roster.defaultId);
  if (!defaultId && asked && models.some((m) => m.id === asked)) {
    defaultId = asked;
    for (const m of models) m.isDefault = m.id === asked;
  }
  if (!models.length) {
    // ⚠ THE EMPTY ROSTER IS ALWAYS A FAILURE STATE, NEVER A `ready` ONE. See the header: no
    // adapter can say "this platform has no models", so no status is allowed to spell it.
    return makeCatalog(runtimeId, source, STATUS.UNAVAILABLE, {
      dimensions: dims,
      key,
      reason: reason || 'Dopl could not read this runtime\'s model list.',
    });
  }
  // ⚠ A ROSTER THAT SAYS IT IS STALE IS `stale` (2026-09-22): an adapter whose live read failed and
  // answered its build's own table instead. The models LABEL; they are not newly selectable.
  const status = roster.stale === true ? STATUS.STALE : STATUS.READY;
  return makeCatalog(runtimeId, source, status, {
    dimensions: dims,
    key,
    models,
    defaultId,
    truncated: roster.truncated === true,
    // ⚠ A `ready` CATALOG MAY STILL CARRY A REASON, AND THAT IS NOT A CONTRADICTION. A roster can
    // arrive COMPLETE and still be worth a sentence — pagination stopped at the page cap, or the
    // server declared no single default. `reason` is a note here and a FAILURE only on the two
    // statuses that have no models; a consumer reads the status, never the string.
    reason,
  });
}

// ── THE SNAPSHOT CACHE ───────────────────────────────────────────────────────────────────────
//
// ⚠ KEYED BY RUNTIME ID AND NOTHING ELSE, so one runtime's outage cannot reach another's picker.
// ⚠ ONE REFRESH IN FLIGHT PER RUNTIME: opening a settings page in two windows must not spawn two
// app-servers, and a peek during a refresh answers the PRIOR state rather than starting a second.

const snapshots = new Map();

// ⚠ SETTLED VERDICTS, PER RUNTIME, FOR THE TRANSITION HOOK BELOW. `loading` is never recorded —
// it is "no verdict yet", so a retry in flight is not a transition.
const settledStatus = new Map();
const listeners = [];

/**
 * CALL `fn(runtimeId, from, to)` WHEN A RUNTIME'S SETTLED VERDICT CHANGES (CXP-5, 2026-09-22) —
 * `unavailable` → `ready` after a repair, `ready` → `unavailable` after a loss. The first verdict a
 * process reaches is not a transition and fires nothing.
 * ⚠ IT EXISTS SO THIS MODULE CAN STAY REQUIRE-FREE: `channel-runtime-reply.js` subscribes and
 * expires the connectivity sweep, which is the one layer that knows both halves.
 * ⚠ A LISTENER THAT THROWS TAKES NOTHING WITH IT — a settings read must not fail over a hook.
 */
function onSettled(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  return () => {
    const at = listeners.indexOf(fn);
    if (at !== -1) listeners.splice(at, 1);
  };
}

function noteSettled(id, status) {
  const from = settledStatus.has(id) ? settledStatus.get(id) : null;
  settledStatus.set(id, status);
  if (from === null || from === status) return;
  for (const fn of listeners.slice()) {
    try { fn(id, from, status); } catch (_) { /* a hook never fails a read */ }
  }
}

function due(entry, now, adapter) {
  if (!entry) return true;
  if (entry.inflight) return false;
  // ⚠ A GOOD ROSTER IS CACHED FOR THE PROCESS — UNLESS ITS KEY MOVED (2026-09-22). An adapter that
  // can name its roster's key synchronously (`runtime.rosterKey`, e.g. binary + account) gets a
  // re-read the first look after a sign-in or an upgrade, with no timer and no invalidation hook.
  if (entry.catalog.status === STATUS.READY) return keyMoved(entry, adapter);
  // ⚠ `stale` AND `unavailable` SHARE THE FLOOR. `invalidate` stamps `at: 0`, so an invalidated
  // catalog is due at the very next look; a refresh that FAILED into `stale` is not re-spawned on
  // every look after it.
  return now - entry.at >= FAILURE_TTL_MS;
}

function keyMoved(entry, adapter) {
  const fn = adapter && adapter.runtime && adapter.runtime.rosterKey;
  if (typeof fn !== 'function' || !entry.catalog.key) return false;
  try { return str(fn.call(adapter.runtime)) !== entry.catalog.key; } catch (_) { return false; }
}

const loadingCatalog = (id, declared) => makeCatalog(id, (declared && str(declared.source)) || null, STATUS.LOADING, {
  dimensions: Array.isArray(declared && declared.dimensions) ? declared.dimensions.slice() : [],
});

/**
 * ⚠ THE ONLY PLACE A LIVE ROSTER IS CALLED, AND IT IS NEVER AWAITED BY A CALLER. A rejected
 * `models()` becomes an `unavailable` catalog with the thrown message; it never escapes, because
 * every caller of this module is a settings read and a settings page that will not open is a
 * worse answer than a picker that says why it is empty.
 *
 * ⚠ **A RETRY OVER A FAILURE READS `loading`, NOT THE OLD FAILURE (CXP-5).** A catalog holding no
 * models has nothing to label, so while its re-read is in flight the true statement is "nothing
 * read yet" — and `loading` is the one status the renderer keeps re-reading on. Answering the old
 * `unavailable` would settle the picker on a verdict the read in flight is about to replace.
 * A catalog that HOLDS models keeps them (and its status) while it re-reads.
 */
function refresh(adapter, now) {
  const id = adapter.descriptor.id;
  const declared = adapter.descriptor.models || {};
  const prior = snapshots.get(id) || null;
  const holds = !!(prior && prior.catalog && prior.catalog.models.length);
  const entry = {
    catalog: holds ? prior.catalog : loadingCatalog(id, declared),
    at: now,
    inflight: null,
    dirty: false,
  };
  entry.inflight = Promise.resolve()
    .then(() => adapter.runtime.models())
    .then((roster) => catalogFromRoster(id, adapter.descriptor, roster))
    .catch((err) => makeCatalog(id, declared.source, STATUS.UNAVAILABLE, {
      dimensions: Array.isArray(declared.dimensions) ? declared.dimensions.slice() : [],
      reason: (err && err.message) || 'the model roster could not be read',
    }))
    .then((next) => {
      const held = snapshots.get(id);
      const kept = held && held.catalog && held.catalog.models.length ? held.catalog : null;
      // ⚠ A FAILED REFRESH OVER A ROSTER WE ALREADY HAVE IS `stale`, NOT `unavailable`. The old
      // models still LABEL a running session's model honestly; what they may no longer do is be
      // newly SELECTED, which is what `stale` means and `unavailable` does not.
      const settled = next.status === STATUS.UNAVAILABLE && kept
        ? Object.assign({}, kept, { status: STATUS.STALE, reason: next.reason })
        : next;
      // ⚠ INVALIDATED WHILE IN FLIGHT: this read may have started before the repair it is being
      // asked about, so a FAILED answer is due again at the very next look rather than after the
      // floor. A `ready` one is simply kept.
      const dirty = !!(held && held.dirty);
      snapshots.set(id, { catalog: settled, at: dirty && settled.status !== STATUS.READY ? 0 : Date.now(), inflight: null, dirty: false });
      noteSettled(id, settled.status);
      return settled;
    });
  snapshots.set(id, entry);
  return entry.inflight;
}

/**
 * THIS RUNTIME'S CATALOG, RIGHT NOW, WITHOUT WAITING FOR ANYTHING.
 *
 * ⚠ A FROZEN ROSTER IS READ INLINE AND IS ALWAYS `ready` — it is a table lookup, so making the
 * settings page wait a render for it would be inventing a loading state nobody has to be in.
 * ⚠ A LIVE ROSTER ANSWERS FROM CACHE AND KICKS A BACKGROUND READ. The first answer on a cold
 * process is `loading`; the renderer re-reads and gets `ready` or `unavailable`.
 */
function snapshot(adapter) {
  const descriptor = adapter && adapter.descriptor;
  if (!descriptor) return null;
  const id = descriptor.id;
  const declared = descriptor.models || {};
  if (str(declared.source) === 'frozen') {
    let roster = null;
    try { roster = adapter.runtime.models(); } catch (err) {
      return makeCatalog(id, 'frozen', STATUS.UNAVAILABLE, { reason: (err && err.message) || 'the model table could not be read' });
    }
    // ⚠ A FROZEN ROSTER THAT ANSWERED A PROMISE IS A MIS-DECLARED ADAPTER, not a loading one.
    if (roster && typeof roster.then === 'function') {
      return makeCatalog(id, 'frozen', STATUS.UNAVAILABLE, {
        reason: 'this runtime declares a frozen model table but answered asynchronously',
      });
    }
    return catalogFromRoster(id, descriptor, roster);
  }
  const now = Date.now();
  const entry = snapshots.get(id) || null;
  if (due(entry, now, adapter)) refresh(adapter, now);
  const held = snapshots.get(id);
  return (held && held.catalog) || loadingCatalog(id, declared);
}

/**
 * THIS RUNTIME'S CATALOG ONCE A READ HAS SETTLED — the ONE caller that may wait is a LAUNCH that
 * names a model (`session-launch.js`), because refusing an unknown pick needs an answer, not
 * `loading`. ⚠ Everything else stays on `snapshot`, which never blocks.
 */
async function settle(adapter) {
  const descriptor = adapter && adapter.descriptor;
  if (!descriptor) return null;
  if (str((descriptor.models || {}).source) === 'frozen') return snapshot(adapter);
  const held = snapshots.get(descriptor.id) || null;
  if (held && held.inflight) return held.inflight;
  if (due(held, Date.now(), adapter)) return refresh(adapter, Date.now());
  return held.catalog;
}

/** The catalog entry a pick names — its `id`, else one of its `aliases`. `null` when none does. */
function findModel(catalog, pick) {
  const v = str(pick);
  const models = (catalog && Array.isArray(catalog.models)) ? catalog.models : [];
  if (!v) return null;
  return models.find((m) => m.id === v)
    || models.find((m) => Array.isArray(m.aliases) && m.aliases.indexOf(v) !== -1)
    || null;
}

/**
 * WHY A LAUNCH NAMING `pick` IS REFUSED ON THIS CATALOG, or `null` (2026-09-22).
 *
 * ⚠ **AN UNKNOWN MODEL IS REFUSED WITH A SENTENCE, NEVER SWAPPED FOR ANOTHER.** It used to fall
 * through to the product default — an MCP launch asking for a mistyped id started Sonnet and
 * echoed the id it was asked for.
 * ⚠ **ONLY A CATALOG THAT HOLDS MODELS CAN REFUSE.** `loading` / `unavailable` hold none, and
 * refusing there would turn "Dopl could not read the list" into "that model does not exist" —
 * the launch goes ahead and the runtime itself answers. A `stale` catalog DOES hold models (the
 * last answer, or the adapter's own table), so it refuses what it cannot vouch for.
 * ⚠ ABSENT and the legacy word `default` are "no pick" and are never refused here.
 */
function modelRefusal(catalog, pick, label) {
  const v = str(pick);
  if (!v || v === 'default' || !catalog || !Array.isArray(catalog.models) || !catalog.models.length) return null;
  if (findModel(catalog, v)) return null;
  const offered = catalog.models.filter((m) => !m.hidden).map((m) => m.label || m.id).join(', ');
  return `${label || 'This runtime'} does not offer the model "${v}" on this machine`
    + (offered ? ` — it offers: ${offered}` : '') + '.';
}

/**
 * EVERY REGISTERED RUNTIME'S CATALOG, KEYED BY ID — what a settings read puts on the wire.
 * ⚠ ONE ADAPTER'S THROW TAKES NOTHING ELSE WITH IT.
 */
function catalogs(adapters) {
  const out = {};
  for (const adapter of Array.isArray(adapters) ? adapters : []) {
    const id = adapter && adapter.descriptor && adapter.descriptor.id;
    if (!id) continue;
    try { out[id] = snapshot(adapter); } catch (err) {
      out[id] = makeCatalog(id, null, STATUS.UNAVAILABLE, {
        reason: (err && err.message) || 'the model roster could not be read',
      });
    }
  }
  return out;
}

/**
 * MARK A RUNTIME'S CATALOG FOR RE-READ — the reconnect / repair / version-change hook.
 *
 * ⚠ A CATALOG THAT HOLDS MODELS BECOMES `stale`: it keeps the models and changes the status,
 * which is the whole difference between this and `forget`. A reconnect does not make the old
 * labels wrong; it makes them unconfirmed. Until the re-read answers, a stale id still renders
 * and still cannot be picked.
 * ⚠ **A CATALOG THAT HOLDS NONE BECOMES `loading` (CXP-5, 2026-09-22).** An `unavailable` verdict
 * that has been invalidated is no longer a verdict — the failure it measured is the thing the
 * operator just changed — and `stale` with no models would be a status with nothing to label.
 * ⚠ **A READ ALREADY IN FLIGHT IS KEPT, NOT RACED.** Replacing it would spawn a second
 * `codex app-server` beside the first; instead it is marked dirty, so if IT fails its answer is
 * due again at the very next look (`refresh`).
 */
function invalidate(runtimeId, reason) {
  const id = str(runtimeId);
  const held = snapshots.get(id);
  if (!held || !held.catalog) return false;
  if (held.inflight) {
    held.dirty = true;
    return true;
  }
  const catalog = held.catalog.models.length
    ? Object.assign({}, held.catalog, {
      status: STATUS.STALE,
      reason: str(reason) || 'this runtime reconnected, so its model list has not been re-read yet',
    })
    : makeCatalog(id, held.catalog.source, STATUS.LOADING, { dimensions: held.catalog.dimensions.slice() });
  snapshots.set(id, { catalog, at: 0, inflight: null, dirty: false });
  return true;
}

/** Drop everything cached. ⚠ For tests and for an explicit operator-driven re-probe only. */
function forget(runtimeId) {
  if (runtimeId === undefined) { snapshots.clear(); settledStatus.clear(); return; }
  snapshots.delete(str(runtimeId));
  settledStatus.delete(str(runtimeId));
}

module.exports = {
  CATALOG_VERSION,
  STATUS,
  FAILURE_TTL_MS,
  catalogFromRoster,
  normalizeEntry,
  normalizeDimensions,
  makeCatalog,
  snapshot,
  settle, // 2026-09-22: the launch funnel's one awaited read
  findModel,
  modelRefusal,
  catalogs,
  invalidate,
  onSettled,
  forget,
};
