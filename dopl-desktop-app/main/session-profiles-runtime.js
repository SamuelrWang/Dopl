// THE RUNTIME-RESOLVED AXIS-A SURFACE — §2 SPLIT out of `session-profiles.js` (2026-09-14, the
// 500-line cap). That file still re-exports every name below and holds the gate table these
// delegate for; nothing here changed shape in the move.

// ⚠ THE REGISTRY, NOT AN ADAPTER. This is the ONLY require in core that reaches the runtime layer
// for a gate decision, and it names no vendor: `runtimeFor(id)` answers with the sixteen contract
// methods and nothing else (`main/runtime/contract.js › RUNTIME_METHODS`).
const runtimeRegistry = require('./runtime');

// ── THE RUNTIME-RESOLVED AXIS-A SURFACE ──────────────────────────────────────────────────────
//
// ⚠ DELEGATES, NOT DEFINITIONS. Each one asks `main/runtime/index.js` for the session's runtime
// and calls a `contract.js › RUNTIME_METHODS` member or reads a descriptor field. Core holds no
// copy of any tool name and no copy of any Axis-A mode, which is what
// `test/core-vocabulary.test.mjs` exists to keep true.
// ⚠ THE TRAILING `runtimeId` IS OPTIONAL AND ABSENT MEANS THE DEFAULT RUNTIME. Some callers hold
// a session (the gate; `session-io.js › grantArgs`) and some do not (the durable posture's WRITE
// validator, which runs before a runtime is chosen). Making the argument required would have
// forced the second group to invent one, which is worse than resolving the default in one place.
// ⚠ DECLARED ABOVE THE TABLE, NOT BELOW IT: `grantDecisionDetail` is built at module load and is
// handed three of them, so a `const` after the block would be a TDZ crash at require time.
const runtimeFor = (runtimeId) => runtimeRegistry.runtimeFor(runtimeId);
const descriptorFor = (runtimeId) => runtimeRegistry.descriptorFor(runtimeId);
const cap = runtimeRegistry.capability;

const buildSessionToolConfig = (profile, runtimeId) => runtimeFor(runtimeId).toolConfigFor(profile);
const toolModeAllows = (mode, toolName, runtimeId) => runtimeFor(runtimeId).axisAAllows(mode, toolName);
const normalizeToolMode = (mode, runtimeId) => cap.normalizeToolMode(descriptorFor(runtimeId), mode);
const floorWindowlessTool = (mode, runtimeId) => cap.floorWindowlessTool(descriptorFor(runtimeId), mode);
// ⚠ WHY A WINDOWLESS LAUNCH IS REFUSED ON THIS RUNTIME, or `null` (2026-09-01, D1). The twin of
// `floorWindowlessTool` above: that one answers `null` when there is no orderable floor, and this
// one is the sentence that goes with it. Read at the LAUNCH (`session-launch.js`) rather than at
// the gate, because the harm is a session that runs and denies its own reads — a refusal after the
// spawn is a refusal nobody can act on.
const windowlessFloorRefusal = (runtimeId) => cap.windowlessFloorRefusal(descriptorFor(runtimeId));
// ⚠ AXIS B'S COLLAPSE WARNING (2026-09-01, D3), or `null`. A WARNING, not a refusal: a runtime
// whose gate cannot read a channel call's op fails CLOSED (unreadable input -> `gate` -> a
// windowless deny), so the agent is broken and the boundary is not. Carried at the launch because
// that is the only moment an operator can act on it.
const axisBOpScopedWarning = (runtimeId) => cap.axisBOpScopedWarning(descriptorFor(runtimeId));
// "In no Axis-A list at all", asked as "not allowed even at the WIDEST mode this runtime offers".
// ⚠ NOT A COPY OF A LIST: the widest mode is the last entry of `descriptor.toolMode.options`, so
// a runtime whose widest mode is not spelled `bypass` still answers correctly. This is the
// question `session-gate-reason.js › toolReason` asks to separate "in no list this build knows"
// from "known, but not covered by the posture you set" — the conflation that made bypass look
// broken and bought that whole module.
const isClassifiedTool = (toolName, runtimeId) =>
  runtimeFor(runtimeId).axisAAllows(cap.widestToolMode(descriptorFor(runtimeId)), toolName);

// ⚠ THE AXIS-A MODE ENUM, READ OFF THE DEFAULT RUNTIME. The three core copies this is pinned
// against (`session-state.js`'s reducer coercion, `channel-prefs.js`'s durable WRITE validator,
// and the SPA's `permission-modes.ts` re-validated here on arrival) all coerce a posture stored
// BEFORE a runtime is chosen, so there is one answer to give them today. When a second adapter
// registers, the UI renders `descriptor.toolMode.options` per agent (§3.1) and these coercions
// take the agent's runtime — a step-5 change, not a step-3 one.
const TOOL_MODES = cap.toolModes(descriptorFor(null));

// ⚠ THE AXIS-A TAXONOMY, READ OFF THE DEFAULT RUNTIME'S DESCRIPTOR — NOT A COPY AND NOT A
// MODULE REFERENCE. Every list below is a spelling of ONE runtime's built-in tool names; core
// must not hold one and must not name the module that defines one, so they arrive as DECLARED
// DATA through the same frozen descriptor the UI reads. A GATE DECISION never touches them: it
// asks `toolModeAllows` / `isClassifiedTool`, resolved against the session's own runtime, because
// only that runtime knows how its modes compose its lists. These exist for the suites that pin a
// runtime's taxonomy and for a caller with no session in hand.
const TAXONOMY = cap.toolTaxonomy(descriptorFor(null));
const AUTO_TOOLS = TAXONOMY.auto;
const BYPASS_TOOLS = TAXONOMY.bypass;
const BYPASS_READS = TAXONOMY.bypassReads;
const ESCALATION_TOOLS = TAXONOMY.escalation;

// ⚠ THE EDIT-SCOPED NAMES, READ OFF THE DESCRIPTOR RATHER THAN LISTED. `session-grant-keys.js ›
// makeGrantKeyFor` scopes an edit grant to the RESOLVED DIRECTORY of the file it was shown, so it
// has to know which tool names carry a path — a per-runtime fact. ⚠ That module still names
// `Bash` and the web tools directly, which is a SECOND core-held built-in vocabulary this wave
// did not move; it is on the deferred list in `test/core-vocabulary.test.mjs` with the step that
// owns it, not left as an absence someone re-derives.
const EDIT_TOOLS = cap.editScopedTools(descriptorFor(null));

module.exports = {
  runtimeFor, descriptorFor, cap,
  buildSessionToolConfig, toolModeAllows, normalizeToolMode, floorWindowlessTool,
  windowlessFloorRefusal, axisBOpScopedWarning, isClassifiedTool,
  TOOL_MODES, TAXONOMY, AUTO_TOOLS, BYPASS_TOOLS, BYPASS_READS, ESCALATION_TOOLS, EDIT_TOOLS,
};
