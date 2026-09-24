// THE RUNTIME ADAPTER CONTRACT — what a descriptor may declare, what a runtime must implement, and
// the declarations that REFUSE a registration rather than hide a control.
//
// Two exports per adapter: `descriptor` (pure data, frozen, JSON-serialisable — what core and the
// UI read to decide what is possible) and `runtime` (the behaviour core calls).
// Absent means absent: an optional capability is `null` or an omitted key, never `false`-with-a-stub
// or `[]`; `null` is the signal the UI hides on.
// Every file under `main/runtime/` is `.js`: the 500-line cap is `main/**/*.js` in
// `eslint.config.js`, so a `.mjs`/`.ts` file here would be uncapped.

// ── THE RUNTIME METHOD SURFACE ───────────────────────────────────────────────────────────────
//
// Core calls these and nothing else; arity is pinned (`test/runtime-contract.test.mjs`) because a
// dropped parameter is how an adapter comes to ignore the session it was handed. A method whose
// capability is absent still EXISTS and answers `null`.
const RUNTIME_METHODS = {
  available: 0,
  buildLaunchSpec: 1,
  // `start(spec)` takes the whole spec, prompt included; core never looks inside it.
  start: 1,
  // `resume(spec, priorHandle)`: the handle being superseded, for a runtime that re-attaches.
  resume: 2,
  normalize: 2,
  answerApproval: 2,
  axisBTools: 1,
  stampOutbound: 2,
  toolConfigFor: 1,
  axisAAllows: 2,
  models: 0,
  // The roster's cache key (`model-catalog.js` re-reads when it moves), or null for none.
  rosterKey: 0,
  // A model pick → `{ ok, arg, id, reason }` on this runtime's own roster (the launch argument).
  modelArg: 1,
  registerMcp: 1,
  probeMcp: 0,
  credentialState: 0,
  signIn: 0,
  // Drop Dopl's own credential for this runtime (a Dopl sign-out); `null` where it holds none.
  signOut: 0,
};

// ── THE FOUR THAT REFUSE ─────────────────────────────────────────────────────────────────────
//
// Each refuses where the thing happens: [0] and [1] refuse REGISTRATION (`descriptorProblems`, which
// `sealAdapter` throws on); [2] refuses a RESUME (`capability.js › canResume`); [3] refuses a
// WINDOWLESS LAUNCH (`capability.js › windowlessFloorRefusal`, read at `session-launch.js`).
const LAUNCH_BLOCKING = [
  {
    path: 'axisB.enforcementPoint',
    why: 'Axis B needs an in-process tool boundary OR a held callback, and NOTHING ELSE can '
      + 'supply one. The Dopl MCP server is remote HTTP (the desktop is not in the call path of '
      + 'a dopl_channel call) and no posture field crosses the wire, so the server cannot be the '
      + 'backstop. With neither, an agent posts to a channel with no outbound consent card at '
      + 'all — the gate coming off, not a capability hidden.',
  },
  {
    path: 'containment.profiles.<profile>.denyList',
    why: 'grantDecision step 1 reads cfg.disallowedTools as the gate\'s OWN first check — the one '
      + 'verdict no task grant and no bypass can open. A restricted profile launched with no deny '
      + 'list in this runtime\'s vocabulary has NO enforcement of that profile: a native sandbox '
      + 'bounds the filesystem, it does not deny delegation, exfil or persistence built-ins. '
      + '⚠ THE ONE PLACE ABSENT DOES NOT MEAN HIDE, because the control here IS containment.',
  },
  // `'unverified'` gives core no safe direction for the resume token baseline.
  { path: 'session.usageResetsOnResume' },
  // A windowless session has no gate surface, so with no floor every tool call is a silent deny.
  { path: 'toolMode.windowlessFloor' },
];

function atPath(obj, path) {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

// The descriptor reaches core, the IPC bridge and the SPA; a mutable one is a table any consumer
// could rewrite for every other.
function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

// A function would not survive the IPC JSON round-trip and would reach the UI as "absent".
function findFunctions(value, path, out) {
  if (typeof value === 'function') { out.push(path || '(root)'); return out; }
  if (value == null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) findFunctions(value[key], path ? `${path}.${key}` : key, out);
  return out;
}

/** Every reason this descriptor may not register, as sentences. Empty array => it may. */
function descriptorProblems(descriptor) {
  const problems = [];
  const d = descriptor;
  if (!d || typeof d !== 'object') return ['the descriptor is not an object'];
  for (const field of ['id', 'label']) {
    if (typeof d[field] !== 'string' || !d[field]) problems.push(`descriptor.${field} must be a non-empty string`);
  }
  const fns = findFunctions(d, '', []);
  if (fns.length) problems.push(`descriptor must be PURE DATA — functions at: ${fns.join(', ')}`);

  const enforcement = atPath(d, LAUNCH_BLOCKING[0].path);
  if (enforcement == null) {
    problems.push(`${d.id}: ${LAUNCH_BLOCKING[0].path} is null — ${LAUNCH_BLOCKING[0].why}`);
  }

  const profiles = atPath(d, 'containment.profiles');
  if (!profiles || typeof profiles !== 'object') {
    problems.push(`${d.id}: containment.profiles is missing — every Dopl profile must declare what THIS runtime enforces`);
  } else {
    for (const name of Object.keys(profiles)) {
      const p = profiles[name] || {};
      if (!Array.isArray(p.denyList)) {
        problems.push(`${d.id}: containment.profiles.${name}.denyList is not a list — ${LAUNCH_BLOCKING[1].why}`);
        continue;
      }
      // An empty list denies nothing, which on a restricted profile is no enforcement; `full` is
      // exempt because its supervision is Axis A, not a list.
      if (p.denyList.length === 0 && name !== UNRESTRICTED_PROFILE) {
        problems.push(`${d.id}: containment.profiles.${name}.denyList is EMPTY — a restricted `
          + `profile that denies nothing is a restricted profile with no enforcement. ${LAUNCH_BLOCKING[1].why}`);
      }
    }
  }
  problems.push(...selectionProblems(d));
  return problems;
}

// Shared storage validates every runtime's launch selection through `models.pick`,
// `models.dimensions` and `models.dimensionOptions`, so a malformed one refuses registration: a
// dimension with no options is a control that writes nowhere (F-390).
function selectionProblems(d) {
  const problems = [];
  const id = (d && d.id) || '(unknown)';
  const models = (d && d.models) || null;
  if (!models || typeof models !== 'object') {
    problems.push(`${id}: descriptor.models is missing — shared storage validates every model pick `
      + 'through it, so an adapter without one has no model vocabulary and cannot be registered');
    return problems;
  }
  const pick = models.pick;
  if (!pick || typeof pick !== 'object') {
    problems.push(`${id}: descriptor.models.pick is missing — `
      + 'capability.js › launchModelPick has no pattern to validate against');
  } else if (typeof pick.pattern !== 'string' || !pick.pattern) {
    problems.push(`${id}: models.pick.pattern is missing — the stored value becomes a launch `
      + 'argument, so the alphabet is the gate that replaces membership');
  }
  const dims = models.dimensions;
  if (dims != null && !Array.isArray(dims)) {
    problems.push(`${id}: descriptor.models.dimensions must be a list or null — `
      + 'null says "no such dimension", and [] would render an empty control');
  } else if (Array.isArray(dims)) {
    const declared = models.dimensionOptions || {};
    for (const key of dims) {
      const entry = declared[key];
      if (!entry || !Array.isArray(entry.options) || !entry.options.length) {
        problems.push(`${id}: models.dimensions names "${key}" but models.dimensionOptions declares `
          + 'no options for it — that is a control that writes nowhere (F-390\'s shape). Declare '
          + 'its values, or drop the dimension: an unbackable capability must be ABSENT.');
      }
    }
  }
  return problems;
}

// The one profile allowed an empty deny list. Named here, not imported: `tool-profiles.js` reaches
// electron, and `session-profiles.js` (which requires this registry) is evaluated standalone.
const UNRESTRICTED_PROFILE = 'full';

/**
 * Does the descriptor's containment declaration equal what the runtime ENFORCES? `grantDecision`
 * step 1 reads `runtime.toolConfigFor(p).disallowedTools`, never the descriptor, so the declaration
 * is asserted against it (a set comparison) at the one moment both halves are in hand.
 */
function mirrorProblems(descriptor, runtime) {
  const problems = [];
  const id = (descriptor && descriptor.id) || '(unknown)';
  const profiles = atPath(descriptor, 'containment.profiles');
  if (!profiles || typeof profiles !== 'object') return problems; // already reported above
  if (!runtime || typeof runtime.toolConfigFor !== 'function') return problems; // ditto
  for (const name of Object.keys(profiles)) {
    const declared = (profiles[name] || {}).denyList;
    if (!Array.isArray(declared)) continue; // already reported above
    let enforced;
    try {
      enforced = (runtime.toolConfigFor(name) || {}).disallowedTools;
    } catch (err) {
      problems.push(`${id}: runtime.toolConfigFor('${name}') threw — ${(err && err.message) || err}`);
      continue;
    }
    if (!Array.isArray(enforced)) {
      problems.push(`${id}: runtime.toolConfigFor('${name}').disallowedTools is not a list — this `
        + 'is the list grantDecision step 1 actually reads, so the profile has no enforcement');
      continue;
    }
    const missing = enforced.filter((t) => declared.indexOf(t) === -1);
    const invented = declared.filter((t) => enforced.indexOf(t) === -1);
    if (missing.length || invented.length) {
      problems.push(`${id}: containment.profiles.${name}.denyList does not match what `
        + `runtime.toolConfigFor('${name}') ENFORCES — declared-but-unenforced: `
        + `[${invented.join(', ')}]; enforced-but-undeclared: [${missing.join(', ')}]. The `
        + 'descriptor is a mirror of the gate\'s first check and must be DERIVED from it.');
    }
  }
  return problems;
}

/** A profile's containment entry, derived from the runtime's own tool table (so it mirrors it). */
function profileEntryFrom(cfg) {
  return { native: cfg.native || null, denyList: cfg.disallowedTools.slice() };
}

/** Every reason this runtime object is not usable. Empty array => it is. */
function runtimeProblems(runtime, id) {
  const problems = [];
  if (!runtime || typeof runtime !== 'object') return [`${id}: the runtime is not an object`];
  for (const name of Object.keys(RUNTIME_METHODS)) {
    const fn = runtime[name];
    if (typeof fn !== 'function') { problems.push(`${id}: runtime.${name} is missing`); continue; }
    if (fn.length !== RUNTIME_METHODS[name]) {
      problems.push(`${id}: runtime.${name} takes ${fn.length} arguments, contract says ${RUNTIME_METHODS[name]}`);
    }
  }
  return problems;
}

/** Freeze + validate one adapter, or THROW with every reason at once (registration is at load). */
function sealAdapter(adapter) {
  const a = adapter || {};
  const problems = descriptorProblems(a.descriptor)
    .concat(runtimeProblems(a.runtime, a.descriptor && a.descriptor.id))
    .concat(mirrorProblems(a.descriptor, a.runtime));
  if (problems.length) {
    throw new Error(`runtime adapter refused:\n  - ${problems.join('\n  - ')}`);
  }
  return { descriptor: deepFreeze(a.descriptor), runtime: a.runtime };
}

module.exports = {
  RUNTIME_METHODS,
  LAUNCH_BLOCKING,
  UNRESTRICTED_PROFILE,
  descriptorProblems,
  runtimeProblems,
  mirrorProblems,
  profileEntryFrom,
  sealAdapter,
};
