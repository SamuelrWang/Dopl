// THE GROK ADAPTER — the descriptor (pure data) and the runtime (the behaviour). xAI's Grok Build CLI, driven
// as `grok agent --no-leader stdio` (the Agent Client Protocol v1, JSON-RPC 2.0 over stdio) on the user's own
// SuperGrok / X Premium subscription. Built on the runtime scaffold (docs/specs/runtime-scaffold.md §4 slots,
// §8 kit mapping); measured in docs/specs/grok-runtime.md.
//
// Electron-free at load: `launch-spec.js` reaches electron (`channel-dirs.js`) and `normalize.js` reaches
// `session-io.js` (a require cycle), so both are lazy; `client.js` spawns, so it is lazy too.

const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const models = require('./models');
const mcp = require('./mcp');
const credential = require('./credential');
const { packaging } = require('./packaging');
const identity = require('./identity');
const requiredShape = require('./required-shape');
const { profileEntryFrom } = require('../contract');

const platform = () => require('./client');
const launchSpec = () => require('./launch-spec');
const normalizer = () => require('./normalize');

const profileEntry = (profile) => profileEntryFrom(tools.buildSessionToolConfig(profile));

const descriptor = {
  id: 'grok',
  label: 'Grok',

  session: {
    // `session/load` after a process restart (LIVE): the conversation continues, its history replayed (dropped).
    resume: true,
    // `_x.ai/interject` joins the running turn (LIVE: applied inside it).
    steer: true,
    interrupt: true, // `session/cancel` (a notification)
    // `session/set_config_option {configId:"model"}` mid-session, read back off the echo (LIVE).
    liveModelSwitch: true,
    // Usage is reported per prompt and Dopl sums it per process, so a resumed session starts from zero
    // (LIVE, `smoke-s3`: the first prompt after `session/load` reported that prompt only).
    usageResetsOnResume: true,
  },

  axisB: axisB.descriptor,
  approval: approval.descriptor,

  toolMode: {
    // Narrowest first (`tools.js › TOOL_MODES`). `default` and `autoMode` are Grok's own session modes;
    // `approve-all` is Dopl's, run on Grok's `default` — Grok's yolo mode is never sent.
    options: [
      { value: 'default', label: 'default', description: 'Grok asks before any tool that is not read-only.', native: true },
      { value: 'autoMode', label: 'autoMode', description: 'Grok\'s classifier runs routine work and asks before escalating. Every Dopl tool call still asks.', native: true },
      { value: 'approve-all', label: 'approve-all', description: 'Dopl approves every tool Grok asks about. Dopl\'s own hard-deny and outbound gate still hold.', native: false },
    ],
    default: 'default',
    levels: {
      ask: { tools: 'default', label: 'Ask me' },
      auto: { tools: 'autoMode', label: 'Auto' },
      full: { tools: 'approve-all', label: 'Approve all' },
    },
    windowlessFloor: tools.WINDOWLESS_FLOOR,
    secondaryAxis: null,
    freeform: null,
    // A permission request carries a path only inside a tool's own input; whole-input digest.
    editScopedTools: [],
    taxonomy: {
      auto: tools.AUTO_TOOLS.slice(),
      bypass: tools.APPROVE_ALL_TOOLS.slice(),
      bypassReads: [],
      edits: tools.EDIT_TOOLS.slice(),
      escalation: tools.ESCALATION_TOOLS.slice(),
    },
  },

  containment: {
    // No native sandbox Dopl drives: every bound is a list Dopl maintains in Grok's tool ids, enforced on
    // every tool by the PreToolUse hook (`approval.js › hookVerdict`).
    mode: 'dopl-enumerated',
    profiles: {
      read_only: profileEntry('read_only'),
      dopl_only: profileEntry('dopl_only'),
      channel_agent: profileEntry('channel_agent'),
      full: profileEntry('full'),
    },
  },

  models: models.descriptor,
  requiredShape,
  mcp: mcp.descriptor,
  credential: credential.descriptor,

  prose: {
    // Grok defers MCP tools: the model finds them with `search_tool` and calls them through `use_tool` (LIVE).
    toolSearchVerb: 'search_tool',
    deferredCatalog: null,
  },

  packaging,
};

const runtime = {
  id: 'grok',

  /** Is there a runnable `grok`? Not the credential probe. */
  async available() {
    try {
      const gate = await platform().probe();
      return { ok: gate.ok, reason: gate.reason };
    } catch (err) {
      return { ok: false, reason: (err && err.message) || 'runtime unavailable' };
    }
  },

  buildLaunchSpec(request) { return launchSpec().buildLaunchSpec(request); },
  start(spec) { return launchSpec().start(spec); },
  resume(spec, priorHandle) { return launchSpec().resume(spec, priorHandle); },
  normalize(msg, ctx) { return normalizer().normalize(msg, ctx); },

  // The reply is built by `approval.js › makeApprovalDriver` (two channels, one gate ask); this is the option a
  // verdict selects from a permission request's own `options`.
  answerApproval(request, verdict) { return approval.optionFor(request && request.options, verdict); },
  stampOutbound(_input, _tag) { return null; },
  axisBTools(session) { return axisB.axisBTools(session); },

  toolConfigFor(profile) { return tools.buildSessionToolConfig(profile); },
  axisAAllows(mode, toolName) { return tools.axisAAllows(mode, toolName); },

  models() { return models.models(); },
  buildIdentity() { return identity.buildIdentity(); },
  // The build describes itself in its `initialize` answer (`shape.js`).
  async shape() {
    const found = require('./resolve-bin').resolveGrokBin();
    if (!found.ok) throw new Error(found.reason || 'no Grok build on this Mac');
    return require('./shape').describe(found.path);
  },
  modelArg(value) { return models.modelArg(value); },
  registerMcp(cfg) { return mcp.registerMcp(cfg); },
  probeMcp() { return mcp.probeMcp(); },
  credentialState() { return credential.credentialState(); },
  signIn() { return credential.signIn(); },
  cancelSignIn() { return credential.cancelSignIn(); },
  signOut() { return credential.signOut(); },
};

module.exports = { descriptor, runtime };
