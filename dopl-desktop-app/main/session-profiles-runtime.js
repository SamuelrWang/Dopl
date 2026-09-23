// The runtime-resolved Axis-A surface: delegates that ask `main/runtime/index.js` for a session's runtime (the
// ONLY require in core that reaches the runtime layer for a gate decision). Core holds no copy of any tool name
// or Axis-A mode (core-vocabulary.test). A trailing `runtimeId` is optional; absent is the default runtime.

const runtimeRegistry = require('./runtime');

const runtimeFor = (runtimeId) => runtimeRegistry.runtimeFor(runtimeId);
const descriptorFor = (runtimeId) => runtimeRegistry.descriptorFor(runtimeId);
const cap = runtimeRegistry.capability;

const buildSessionToolConfig = (profile, runtimeId) => runtimeFor(runtimeId).toolConfigFor(profile);
const toolModeAllows = (mode, toolName, runtimeId) => runtimeFor(runtimeId).axisAAllows(mode, toolName);
const normalizeToolMode = (mode, runtimeId) => cap.normalizeToolMode(descriptorFor(runtimeId), mode);
const floorWindowlessTool = (mode, runtimeId) => cap.floorWindowlessTool(descriptorFor(runtimeId), mode);
// Why a windowless launch is refused on this runtime (no orderable floor), or null — asked at the LAUNCH.
const windowlessFloorRefusal = (runtimeId) => cap.windowlessFloorRefusal(descriptorFor(runtimeId));
// Axis B's collapse WARNING, not a refusal: an unreadable op fails closed at the gate.
const axisBOpScopedWarning = (runtimeId) => cap.axisBOpScopedWarning(descriptorFor(runtimeId));
// A session's Axis-A words, narrowest first (copied into state at spawn).
const toolModesFor = (runtimeId) => cap.toolModes(descriptorFor(runtimeId));
const widestToolModeFor = (runtimeId) => cap.widestToolMode(descriptorFor(runtimeId));
// "In any Axis-A list at all", asked as "allowed at the widest mode" rather than by copying a list.
const isClassifiedTool = (toolName, runtimeId) =>
  runtimeFor(runtimeId).axisAAllows(widestToolModeFor(runtimeId), toolName);
const editToolsFor = (runtimeId) => cap.editScopedTools(descriptorFor(runtimeId));

// The DEFAULT runtime's mode list and taxonomy, as declared data for suites and callers with no session;
// no gate decision reads them.
const TOOL_MODES = toolModesFor(null);

const TAXONOMY = cap.toolTaxonomy(descriptorFor(null));
const AUTO_TOOLS = TAXONOMY.auto;
const BYPASS_TOOLS = TAXONOMY.bypass;
const BYPASS_READS = TAXONOMY.bypassReads;
const ESCALATION_TOOLS = TAXONOMY.escalation;

const EDIT_TOOLS = cap.editScopedTools(descriptorFor(null));

module.exports = {
  runtimeFor, descriptorFor, cap,
  buildSessionToolConfig, toolModeAllows, normalizeToolMode, floorWindowlessTool, toolModesFor,
  windowlessFloorRefusal, axisBOpScopedWarning, isClassifiedTool,
  widestToolModeFor, editToolsFor,
  TOOL_MODES, AUTO_TOOLS, BYPASS_TOOLS, BYPASS_READS, ESCALATION_TOOLS, EDIT_TOOLS,
};
