// THE MUSE ADAPTER — the descriptor (pure data) and the runtime (the behaviour). Meta's Muse Code, driven
// as `muse serve` (the Muse Session Protocol, JSON-RPC 2.0 over stdio) on the user's own Muse subscription.
// Built on the runtime scaffold (docs/specs/runtime-scaffold.md §4 slots, §8 kit mapping).
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
  id: 'muse',
  label: 'Muse',

  session: {
    // `session/resume` exists and is driven (`launch-spec.js`), but REFUSED below until the token baseline is measured.
    resume: true,
    // One `turn/start` with `ifBusy:"steer"`: the host joins the live turn (`disposition:"steered"`).
    steer: true,
    interrupt: true, // `turn/interrupt`
    // `session/setModel` exists; Dopl does not drive it.
    liveModelSwitch: 'unverified',
    // `cumulative` is documented as a session total folded from the durable log, but no real-model resume has
    // been measured (the echo provider reports zeros) — so a resume is refused until it is.
    usageResetsOnResume: 'unverified',
  },

  axisB: axisB.descriptor,
  approval: approval.descriptor,

  toolMode: {
    // MSP `ApprovalMode`'s own words, narrowest first (`tools.js › TOOL_MODES`).
    options: [
      { value: 'promptUnmatched', label: 'promptUnmatched', description: 'Muse asks before any action no rule already allows.', native: true },
      { value: 'onRequest', label: 'onRequest', description: 'Workspace reads and edits run; Muse asks before escalating — shell outside the sandbox, the network, Dopl writes.', native: true },
      { value: 'allowAll', label: 'allowAll', description: 'Nothing Muse would ask about is held for you. Dopl\'s own hard-deny and outbound gate still hold.', native: true },
    ],
    default: 'promptUnmatched',
    levels: {
      ask: { tools: 'promptUnmatched', label: 'Ask me' },
      auto: { tools: 'onRequest', label: 'Ask on request' },
      full: { tools: 'allowAll', label: 'Allow all' },
    },
    windowlessFloor: tools.WINDOWLESS_FLOOR,
    // The sandbox is a HOST posture (`muse serve` flags), fixed per profile, never a per-session pick.
    secondaryAxis: null,
    freeform: null,
    // An approval names a path only for `fileAccess` subjects outside the workspace; whole-input digest.
    editScopedTools: [],
    taxonomy: {
      auto: tools.ON_REQUEST_TOOLS.slice(),
      bypass: tools.ALLOW_ALL_TOOLS.slice(),
      bypassReads: [],
      edits: tools.EDIT_SUBJECTS.slice(),
      escalation: tools.ESCALATION_SUBJECTS.slice(),
    },
  },

  containment: {
    // Host fences (`--disable-write`, `--disable-shell`, the permission profile) AND a deny list.
    mode: 'native',
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
    // Not measured with a real model whether MSP defers MCP tools behind a search; none is named.
    toolSearchVerb: null,
    deferredCatalog: null,
  },

  packaging,
};

const runtime = {
  id: 'muse',

  /** Is there a runnable `muse`? Not the credential probe. */
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

  // The decision is a COMMAND (`approval/decide`), sent by `approval.js › makeApprovalDriver`; this is the
  // choice a verdict selects from an approval's own `availableChoices`.
  answerApproval(request, verdict) { return approval.choiceFor(request && request.availableChoices, verdict); },
  stampOutbound(_input, _tag) { return null; },
  axisBTools(session) { return axisB.axisBTools(session); },

  toolConfigFor(profile) { return tools.buildSessionToolConfig(profile); },
  axisAAllows(mode, toolName) { return tools.axisAAllows(mode, toolName); },

  models() { return models.models(); },
  buildIdentity() { return identity.buildIdentity(); },
  // The build describes its own protocol (`muse schema generate-json-schema --experimental`, `shape.js`).
  async shape() {
    const found = require('./resolve-bin').resolveMuseBin();
    if (!found.ok) throw new Error(found.reason || 'no Muse build on this Mac');
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
