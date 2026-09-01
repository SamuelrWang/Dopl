// THE RUNTIME ADAPTER CONTRACT — what a descriptor may declare, what a runtime must implement,
// and the three declarations that REFUSE a registration rather than hide a control.
//
// ⚠ `main/runtime/` IS THE FIRST SUBDIRECTORY THIS TREE HAS UNDER `main/` (2026-08-31). It exists
// because three adapters × ~11 modules cannot go flat beside 138 core modules, and because
// `docs/INVARIANTS.md` §1 asks for a split by REASON TO CHANGE — "which agent runtime is driving
// this session" is exactly one. Core keeps the flat convention it already has.
// ⚠ EVERY FILE UNDER HERE IS `.js`. The desktop's 500-line cap is `main/**/*.js` in
// `eslint.config.js` — extension-specific — so a `.mjs`/`.ts` file here would match NO block, be
// UNCAPPED, and fail `test/eslint-config-coverage.test.mjs`.
//
// TWO EXPORTS PER ADAPTER, and the split is the whole design:
//   `descriptor`  PURE DATA. Frozen, JSON-serialisable, no functions. Core and the UI read it to
//                 decide WHAT IS POSSIBLE. It is the only thing the UI ever sees.
//   `runtime`     THE BEHAVIOUR. Core calls it to DO the thing.
//
// ⚠ ABSENT MEANS ABSENT. Every optional capability is `null` or an omitted key — never
// `false`-with-a-stub, never `[]` standing in for "unsupported". `null` is the signal the UI
// HIDES on. This generalises `main/session-model.js › contextWindowFor`, which answers `null` for
// an unknown model rather than guessing a denominator, to controls as well as numbers.
//
// ⚠ AND THREE FIELDS WHERE `null` REFUSES INSTEAD OF HIDING (see LAUNCH_BLOCKING below). A
// containment control that is hidden is a containment control that does not exist, and a budget
// cap fed by a number the platform never emits is a cap that silently never fires. Those are not
// capabilities to degrade gracefully; they are the gate coming off.

// ── THE CORE EVENT VOCABULARY ────────────────────────────────────────────────────────────────
//
// ⚠ NOT A NEW VOCABULARY. Every name below is one `main/session-reducer.js` ALREADY handles, and
// not one of them is Anthropic's. The reducer has been platform-neutral all along; it only looked
// coupled because the thing PRODUCING the events read SDK messages directly. `normalize()` is the
// seam that makes that true in the type system as well as in fact.
//
// ⚠ `context` IS EMITTED PER ASSISTANT MESSAGE AND DISPATCHED PER TURN, and that asymmetry is
// deliberate: `normalize` is pure, so it cannot remember the last assistant message's usage across
// calls. Core holds the last one and dispatches it when a `result` arrives — which is exactly what
// `session-model.js › observe` did with `s.promptTokens`, moved to the side of the seam that has
// state. Nothing else in the list is buffered.
const CORE_EVENTS = [
  'launched', 'assistant', 'thinking', 'tool_use', 'tool_result', 'outbound_post', 'result',
  'context', 'permission_request', 'permission_decision', 'steer', 'inbound_arrived', 'interrupt',
  'end', 'idle_timeout', 'abandon_timeout', 'auth_hold', 'auth_release', 'inactive', 'cost_cap',
  'crash',
];

// ── THE RUNTIME METHOD SURFACE ───────────────────────────────────────────────────────────────
//
// Core calls these and nothing else. Arity is pinned because a silently-dropped parameter is how
// an adapter comes to ignore the session it was handed — `test/runtime-contract.test.mjs` drives
// every registered adapter against this table.
// ⚠ A method whose CAPABILITY is absent still EXISTS and answers `null`. `signIn` on a
// key-only platform is `() => null`, never a missing key: the descriptor is where absence is
// declared, and a missing method is a broken adapter, not a hidden control.
const RUNTIME_METHODS = {
  available: 0,
  buildLaunchSpec: 1,
  // ⚠ `start(spec)` TAKES THE WHOLE SPEC, PROMPT INCLUDED, and core never looks inside it. The
  // prompt is part of the launch shape on a streaming-input runtime and a separate call on a
  // string-prompt one; splitting it out here would make core hold a difference it must not know.
  start: 1,
  // ⚠ `resume(spec, priorHandle)` — the second argument is the handle being SUPERSEDED, or null.
  // A runtime that re-attaches to a live conversation needs it; one that answers a resume with a
  // fresh child process (Claude: `options.resume` and nothing else differs) ignores it. Declared
  // rather than omitted so the re-attaching case is not a signature change later.
  resume: 2,
  normalize: 2,
  answerApproval: 2,
  axisBTools: 1,
  stampOutbound: 2,
  toolConfigFor: 1,
  axisAAllows: 2,
  models: 0,
  registerMcp: 1,
  probeMcp: 0,
  credentialState: 0,
  signIn: 0,
  triageSpec: 1,
};

// ── THE FOUR THAT REFUSE ─────────────────────────────────────────────────────────────────────
//
// ⚠ READ EACH ENTRY AS "WHAT BREAKS SILENTLY IF THIS IS ABSENT AND WE SHIP ANYWAY". That is the
// bar for joining this list; "the control looks wrong" is not.
//
// ⚠ AND THEY REFUSE FOUR DIFFERENT-SIZED THINGS, WHICH IS WHY EACH IS ENFORCED WHERE THE THING
// HAPPENS RATHER THAN ALL OF THEM HERE. Only [0] takes the whole adapter off the table at
// REGISTRATION (`descriptorProblems`, which `sealAdapter` throws on); [1] refuses a LAUNCH AT THAT
// PROFILE and is also refused at registration when it is unusable; [2] refuses a RESUME
// (`capability.js › canResume`, cold launches unaffected); [3] refuses a WINDOWLESS LAUNCH
// (`capability.js › windowlessFloorRefusal`, read at `session-launch.js`). Taking a whole runtime
// off the table over any of the last three would be the wrong shape.
//
// ⚠ THIS SAID "THE THREE" OVER A LIST OF THREE UNTIL 2026-09-01. [3] is not a new rule — it was
// written in `capability.js › floorWindowlessTool`'s header from the start — it was a rule with
// no enforcement anywhere and no entry here (D1).
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
  {
    path: 'session.usageResetsOnResume',
    why: '`unverified` blocks RESUME (a cold launch is unaffected). session-park.js › '
      + 'resumeParked zeroes both delta baselines on an explicit assumption; a platform that '
      + 'CONTINUES the cumulative total instead makes every delta negative, clamped to 0 by '
      + 'session-io\'s Math.max — so cost stops accumulating, costCapReached is never reached, '
      + 'and the budget control silently stops existing with no error until a bill arrives.',
  },
  {
    path: 'toolMode.windowlessFloor',
    why: 'a WINDOWLESS session has no gate surface — session-windowless.js › claimGate answers a '
      + 'permission request with a DENY — so Axis A must be floored to a mode that allows the '
      + 'reads the prompt orders the agent to make. With no floor there is nothing to raise to, '
      + 'and the session runs at its STORED mode, which starts at the narrowest member and resets '
      + 'to it on park: every tool call denied, silently, with the agent reporting that it cannot '
      + 'read files it was told to read. ⚠ REFUSED FOR THE WINDOWLESS SHAPE ONLY — a runtime with '
      + 'no floor is perfectly launchable WITH a gate surface, so this does not unregister it.',
  },
];

function atPath(obj, path) {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

// Deep-freeze. ⚠ The descriptor is handed to core, to the IPC bridge and eventually to the SPA;
// a mutable one is a capability table any consumer can rewrite for every other consumer.
function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

// ⚠ PURE DATA, ASSERTED RATHER THAN ASSUMED. A function on the descriptor would not survive the
// JSON round-trip the IPC bridge performs, so it would reach the UI as `undefined` — i.e. as
// "capability absent", which is the one meaning that must never be produced by accident.
function findFunctions(value, path, out) {
  if (typeof value === 'function') { out.push(path || '(root)'); return out; }
  if (value == null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) findFunctions(value[key], path ? `${path}.${key}` : key, out);
  return out;
}

/**
 * Every reason this descriptor may not register, as sentences. Empty array => it may.
 *
 * ⚠ REASONS, NOT A BOOLEAN. `available()` has to be able to say WHY, and a refusal an operator
 * cannot read is a refusal they will work around.
 */
function descriptorProblems(descriptor) {
  const problems = [];
  const d = descriptor;
  if (!d || typeof d !== 'object') return ['the descriptor is not an object'];
  for (const field of ['id', 'label', 'vendor', 'entryFile']) {
    if (typeof d[field] !== 'string' || !d[field]) problems.push(`descriptor.${field} must be a non-empty string`);
  }
  const fns = findFunctions(d, '', []);
  if (fns.length) problems.push(`descriptor must be PURE DATA — functions at: ${fns.join(', ')}`);

  // ⚠ TWO OF THE FOUR RULES REFUSE REGISTRATION, AND THIS COMMENT SAID ONE (corrected 2026-09-01).
  // It read "ONLY THE FIRST RULE REFUSES REGISTRATION … the per-profile deny list below (a LAUNCH
  // at that profile)" — but the deny-list check IS below, in THIS function, which `sealAdapter`
  // throws on. So a null or empty list takes the whole adapter off the table at module load, and
  // `capability.js › canLaunchProfile` is UNREACHABLE for an adapter that registered at all (it is
  // the readable-refusal path for a hand-built descriptor, not the enforcement). The same error
  // was in `docs/INVARIANTS.md` §11.0 and is fixed there in the same change; §11.0e always had it
  // right. ⚠ THE OTHER TWO REFUSE NARROWER THINGS and are enforced where those happen:
  // `usageResetsOnResume` in `capability.js › canResume` (a RESUME — cold launches are
  // unaffected), and `toolMode.windowlessFloor` in `› windowlessFloorRefusal`, read at
  // `session-launch.js` (a WINDOWLESS LAUNCH — a runtime with no floor is launchable WITH a gate
  // surface). Taking a whole runtime off the table over a meter would be the wrong shape.
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
      // ⚠ AN EMPTY LIST IS A LIST, AND UNTIL 2026-09-01 THAT WAS THE WHOLE CHECK (D2). `denyList: []`
      // means "this profile denies NOTHING", which on a RESTRICTED profile is the same condition
      // `null` is refused for — the gate's own first check has nothing to check — but it passed
      // registration and passed `capability.js › canLaunchProfile`, because both asked only
      // `Array.isArray`. `full` is exempt and that is not a loophole: `full` IS the profile whose
      // supervision is Axis A rather than a list, so an empty floor there is a posture, not an
      // absent control. Every other profile exists BECAUSE it denies something.
      if (p.denyList.length === 0 && name !== UNRESTRICTED_PROFILE) {
        problems.push(`${d.id}: containment.profiles.${name}.denyList is EMPTY — a restricted `
          + `profile that denies nothing is a restricted profile with no enforcement. ${LAUNCH_BLOCKING[1].why}`);
      }
    }
  }
  return problems;
}

// ⚠ THE ONE PROFILE ALLOWED AN EMPTY DENY LIST. Named here rather than imported because the Dopl
// PROFILE vocabulary is CORE's and is the same on every runtime — `tool-profiles.js ›
// KNOWN_PROFILES` is the list, and this file must not require it: `tool-profiles.js` lazily
// reaches `./diag`, which requires electron, and `main/runtime/` is required by
// `session-profiles.js`, which two suites slice and evaluate standalone.
const UNRESTRICTED_PROFILE = 'full';

/**
 * Does the descriptor's containment DECLARATION agree with what the runtime actually ENFORCES?
 *
 * ⚠ THE POINT OF THE WHOLE FUNCTION (2026-09-01, D2). `grantDecision` step 1 — the gate's own
 * first check, the verdict no task grant and no widest mode can open — reads
 * `runtime.toolConfigFor(profile).disallowedTools`. It has NEVER read
 * `descriptor.containment.profiles.<p>.denyList`. So every rule above validates a MIRROR of the
 * thing it claims to protect, not the thing itself: an adapter that hand-writes a plausible
 * descriptor while its `toolConfigFor` answers `disallowedTools: []` seals cleanly,
 * `canLaunchProfile` calls the profile enforced, the UI renders containment, and the gate denies
 * nothing. Measured: hardcoding `denyList: []` across every Claude profile failed 0 of 2786 tests,
 * while emptying the ENFORCEMENT list fired 16 pins. The enforcement was well defended; the
 * declaration was not, and the two were only kept honest by every shipped adapter CHOOSING to
 * derive one from the other (`claude/index.js › profileEntry`).
 *
 * ⚠ SO THIS ASSERTS THE DERIVATION RATHER THAN TRUSTING IT, at the one moment both halves are in
 * hand. It is a SET comparison, not an ordering one: a runtime may declare its list in whatever
 * order it builds it, and pinning the order would refuse a correct adapter for a cosmetic reason.
 * ⚠ AND IT IS PART OF `sealAdapter`, NOT OF `descriptorProblems`, because it is the one rule that
 * cannot be asked of a descriptor alone.
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

/**
 * Freeze + validate one adapter, or throw with every reason at once.
 *
 * ⚠ THROWS RATHER THAN RETURNING A FLAG. Registration happens at module load in
 * `runtime/index.js`; a half-registered adapter that answers `null` to `axisBTools()` because its
 * descriptor never validated is the failure shape this whole file exists to make impossible.
 */
function sealAdapter(adapter) {
  const a = adapter || {};
  const problems = descriptorProblems(a.descriptor)
    .concat(runtimeProblems(a.runtime, a.descriptor && a.descriptor.id))
    // ⚠ D2 (2026-09-01): the declaration-vs-ENFORCEMENT cross-check. Last, because it is the only
    // rule that needs both halves and it reads better after each half has been found well-formed.
    .concat(mirrorProblems(a.descriptor, a.runtime));
  if (problems.length) {
    throw new Error(`runtime adapter refused:\n  - ${problems.join('\n  - ')}`);
  }
  return { descriptor: deepFreeze(a.descriptor), runtime: a.runtime };
}

module.exports = {
  CORE_EVENTS,
  RUNTIME_METHODS,
  LAUNCH_BLOCKING,
  UNRESTRICTED_PROFILE, // D2: the one profile an empty deny list is a posture rather than a hole
  deepFreeze,
  descriptorProblems,
  runtimeProblems,
  mirrorProblems, // D2: declaration vs. the structure grantDecision actually consumes
  sealAdapter,
};
