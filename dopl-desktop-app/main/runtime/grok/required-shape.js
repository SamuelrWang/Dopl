// WHAT DOPL READS FROM GROK — and nothing else (`../sdk-shape.js`). Checked against each build's OWN
// description (`shape.js`, its `initialize` answer) at launch and before the updater adopts a build. Tiered by
// what a gap costs: SAFETY and CORE refuse, COSMETIC is a drift note. Every item is read (or relied on) by this
// adapter's code and present in the measured answer (`test/fixtures/grok/initialize-1.0.52.json`).

module.exports = Object.freeze({
  // A gap here could start a session with a Dopl restriction silently off.
  safety: {
    methods: ['initialize', 'session/new', 'session/prompt'],
    results: {
      // The client PreToolUse hook (containment for tools Grok never asks about) and the cached-token check.
      initialize: ['protocolVersion', 'authMethods.id', 'agentCapabilities._meta.x.ai/hooks.blockingEvents',
        'agentCapabilities._meta.x.ai/hooks.decisions'],
    },
    values: { 'hooks blockingEvents': ['pre_tool_use'], 'hooks decisions': ['deny'] },
  },
  // A gap here breaks the session: no Dopl tools, no stop, no model, no resume.
  core: {
    methods: ['session/cancel', 'session/set_config_option', 'session/load'],
    results: { initialize: ['agentCapabilities.loadSession', 'agentCapabilities.mcpCapabilities.http'] },
  },
  // A gap here degrades a label or the meter — never the session.
  cosmetic: {
    results: { initialize: ['_meta.agentVersion'] },
  },
});
