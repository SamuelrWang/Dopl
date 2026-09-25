// THE CODEX ADAPTER — the descriptor (pure data) and the runtime (the behaviour).
//
// Electron-free at load, like the Claude adapter and for the same two reasons: `launch-spec.js`
// reaches electron (`channel-dirs.js`) and `normalize.js` reaches `session-io.js` → `session-profiles.js`
// (a require cycle), so both are lazy; `client.js` spawns, so it is lazy too.

const tools = require('./tools');
const axisB = require('./axis-b');
const serverRequests = require('./server-requests');
const models = require('./models');
const mcp = require('./mcp');
const credential = require('./credential');
const { packaging } = require('./packaging');
const { pickOf } = require('../selection-vocabulary');
const { profileEntryFrom } = require('../contract');

const platform = () => require('./client');
const launchSpec = () => require('./launch-spec');
const normalizer = () => require('./normalize');

// Derived from the one table that defines each profile. A restricted profile pins the native pair;
// `full`'s supervision is Axis A plus the sandbox row, so it pins nothing.
const profileEntry = (profile) => profileEntryFrom(tools.buildSessionToolConfig(profile));

const descriptor = {
  id: 'codex',
  label: 'Codex',

  session: {
    resume: true, // `thread/resume`
    fork: true, // `thread/fork`
    steer: true, // `turn/steer` appends input mid-turn
    interrupt: true, // `turn/interrupt`
    // `TurnStartParams.model` exists, but this runtime is measured to accept fields and ignore them,
    // and `turn/start` echoes no model to check against — so a live switch is not claimed.
    liveModelSwitch: 'unverified',
    // Measured (codex-cli 0.155.1): the cumulative total CONTINUES across `thread/resume`, so a
    // resume carries the token baseline forward (`capability.js › resumeZeroesBaseline`).
    usageResetsOnResume: false,
  },

  axisB: axisB.descriptor,
  approval: serverRequests.descriptor,

  toolMode: {
    // `approval_policy`'s own values, narrowest first; `granular` sits second (`tools.js › TOOL_MODES`).
    options: [
      { value: 'untrusted', label: 'untrusted', description: 'Approves only known-safe read operations. Blocks state mutations and external execution.', native: true },
      { value: 'granular', label: 'granular', description: 'Selective approval per category — the five rows below.', native: true },
      { value: 'on-request', label: 'on-request', description: 'Codex asks before escalating out of the sandbox, reaching the network, or causing side effects.', native: true },
      { value: 'never', label: 'never', description: 'No approval prompts from Codex. Dopl\'s own hard-deny and outbound gate still hold.', native: true },
    ],
    default: 'untrusted',
    // The operator's Ask / Auto / Full as the Codex app's own presets (ChatGPT.app 0.155 agent-mode
    // table: "Ask for approval" = on-request + workspace-write; "Full access" = never +
    // danger-full-access). "Approve for me" adds approvals_reviewer=auto_review, which hands Dopl's
    // own channel calls to Codex's reviewer instead of Dopl's gate (`test/codex-auto-review-live.test.mjs`),
    // so Auto runs Ask's pair until that is ruled on.
    levels: {
      ask: { tools: 'on-request', native: { sandbox_mode: 'workspace-write' }, label: 'Ask for approval' },
      auto: { tools: 'on-request', native: { sandbox_mode: 'workspace-write' }, label: 'Ask for approval' },
      full: { tools: 'never', native: { sandbox_mode: 'danger-full-access' }, label: 'Full access' },
    },
    windowlessFloor: tools.WINDOWLESS_FLOOR,
    // A second containment axis the other runtimes lack; enforcement is OS-native.
    secondaryAxis: {
      key: 'sandbox_mode',
      label: 'Sandbox',
      options: [
        { value: 'read-only', label: 'read-only', description: 'Inspect files only; edits and commands need approval.' },
        { value: 'workspace-write', label: 'workspace-write', description: 'Read and edit inside the workspace, run routine local commands there. No network by default.' },
        { value: 'danger-full-access', label: 'danger-full-access', description: 'No filesystem or network restriction.' },
      ],
      default: 'workspace-write',
    },
    freeform: null,
    // Empty: a directory-scoped grant needs the path field of an approval payload, and a fileChange
    // approval carries none — the whole-input digest is the narrower, safe fallback.
    editScopedTools: [],
    taxonomy: {
      auto: tools.ON_REQUEST_TOOLS.slice(),
      bypass: tools.NEVER_TOOLS.slice(),
      // No approval request is ever raised for a read, so there is no such name.
      bypassReads: [],
      edits: tools.EDIT_ITEMS.slice(),
      escalation: tools.ESCALATION_ITEMS.slice(),
    },
  },

  containment: {
    // A native sandbox AND a deny list: the sandbox bounds the filesystem, it does not deny
    // delegation or persistence (those are fenced by configuration, `tools.js`).
    mode: 'native',
    profiles: {
      read_only: profileEntry('read_only'),
      dopl_only: profileEntry('dopl_only'),
      channel_agent: profileEntry('channel_agent'),
      full: profileEntry('full'),
    },
  },

  models: models.descriptor,
  mcp: mcp.descriptor,
  credential: credential.descriptor,

  prose: {
    // Codex always defers MCP tools behind `tool_search` (no key opts a server out); code-mode
    // models reach them only via `ALL_TOOLS` inside `exec`, so a turn names both ways in.
    toolSearchVerb: 'tool_search',
    deferredCatalog: 'ALL_TOOLS',
  },

  packaging,
};

const runtime = {
  // Core stamps this onto a session so every later gate decision resolves the runtime it started on.
  id: 'codex',

  /** Is there a runnable `codex` at or above the supported floor? Not the credential probe. */
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

  answerApproval(_request, verdict) { return serverRequests.decisionReply(verdict); },
  // `axisB.inputRewrite` is null here: no route carries a rewritten input.
  stampOutbound(_input, _tag) { return null; },
  axisBTools(session) { return axisB.axisBTools(session); },

  toolConfigFor(profile) { return tools.buildSessionToolConfig(profile); },
  axisAAllows(mode, toolName) { return tools.axisAAllows(mode, toolName); },

  models() { return models.models(); },
  // No synchronous roster key: a READY catalog is kept for the process.
  rosterKey() { return null; },
  // Picks pass as given (the funnel already refused an unknown one on the live catalog).
  modelArg(value) {
    const v = pickOf(value);
    return { ok: true, arg: v, id: v, reason: '' };
  },
  registerMcp(cfg) { return mcp.registerMcp(cfg); },
  probeMcp() { return mcp.probeMcp(); },
  credentialState() { return credential.credentialState(); },
  signIn() { return credential.signIn(); },
  signOut() { return credential.signOut(); },
};

module.exports = { descriptor, runtime };
