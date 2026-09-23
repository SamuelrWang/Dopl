// The directive lane's view of one runtime's Axis-A vocabulary (Samuel ruling R3): each runtime is
// asked in its OWN words and clamped in its OWN order — never Claude's. Shared by the launch
// (`launch-directive-spawn.js`) and `set_agent_mode` (`directive-agent-ops.js`) branches.

/**
 * `runtimeId`'s Axis-A words, narrowest first — its descriptor's `toolMode.options`. `[]` when the
 * registry cannot say, which makes every asked word "not offered" (the fail-closed direction).
 */
function toolOrderFor(runtimeId) {
  try {
    const d = require('./runtime').descriptorFor(runtimeId || null);
    const options = (d && d.toolMode && Array.isArray(d.toolMode.options)) ? d.toolMode.options : [];
    return options.map((o) => (o && typeof o.value === 'string' ? o.value : '')).filter(Boolean);
  } catch (_err) {
    return [];
  }
}

module.exports = { toolOrderFor };
