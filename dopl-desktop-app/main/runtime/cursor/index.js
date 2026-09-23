// THE CURSOR ADAPTER — the descriptor (pure data) and the runtime (the behaviour).
//
// No permission callback: Axis A is the platform's own run mode and Axis B is `local.customTools`,
// an in-process tool boundary. Nothing here was tested against a live Cursor; what could not be
// grounded is declared `'unverified'`. It registers but does not ship: `session.interrupt` is
// unverified (§5 X0), and a runtime Dopl cannot stop does not ship.

const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const models = require('./models');
const mcp = require('./mcp');
const credential = require('./credential');
const { packaging } = require('./packaging');
const { pickOf } = require('../selection-vocabulary');
const { profileEntryFrom } = require('../contract');

// Electron-free at load: `client.js` (dynamic ESM import), `launch-spec.js` (electron) and
// `normalize.js` (the `session-io → session-profiles` cycle) are lazy, as in the other adapters.
const platform = () => require('./client');
const launchSpec = () => require('./launch-spec');
const normalizer = () => require('./normalize');

const profileEntry = (profile) => profileEntryFrom(tools.buildSessionToolConfig(profile));

const descriptor = {
  id: 'cursor',
  label: 'Cursor',

  session: {
    resume: true,
    fork: false,
    steer: 'unverified',
    // The ship gate (§5 X0): with no interrupt the Stop control is refused.
    interrupt: 'unverified',
    liveModelSwitch: true,
    // Refuses a resume until measured (§5 X4); a cold launch is unaffected.
    usageResetsOnResume: 'unverified',
  },

  axisB: axisB.descriptor,
  approval: approval.descriptor,

  toolMode: {
    options: [
      { value: 'allowlist', label: 'Allowlist', description: 'Actions on your allowlist run without approval. Everything else asks.', native: true },
      { value: 'auto-review', label: 'Auto-review', description: 'Allowlisted calls run; others are sandboxed, and unsandboxed ones go to Cursor\'s classifier.', native: true },
      { value: 'run-everything', label: 'Run Everything', description: 'Every tool call runs automatically — no sandbox, no classifier. Dopl\'s own hard-deny and outbound gate still hold.', native: true },
    ],
    default: 'allowlist',
    windowlessFloor: tools.WINDOWLESS_FLOOR,
    secondaryAxis: {
      key: 'sandbox',
      label: 'Sandbox',
      options: [
        { value: 'enabled', label: 'Enabled', description: 'Blocks writes outside the workspace, privileged operations, and network except by allowlist.' },
        { value: 'disabled', label: 'Disabled', description: 'No OS-level restriction. Dopl\'s deny list still applies.' },
      ],
      default: 'enabled',
    },
    freeform: null,
    editScopedTools: [],
    taxonomy: {
      auto: tools.AUTO_REVIEW_TOOLS.slice(),
      bypass: tools.RUN_EVERYTHING_TOOLS.slice(),
      bypassReads: [],
      edits: [],
      escalation: [],
    },
  },

  containment: {
    // A native sandbox AND a deny list; frozen at three profiles (no `channel_agent`, ruling X0).
    mode: 'native',
    profiles: {
      read_only: profileEntry('read_only'),
      dopl_only: profileEntry('dopl_only'),
      full: profileEntry('full'),
    },
  },

  models: models.descriptor,
  mcp: mcp.descriptor,
  credential: credential.descriptor,

  prose: {
    // Nothing is deferred behind a search verb, so there is no verb and no catalog to name.
    toolSearchVerb: null,
    deferredCatalog: null,
  },

  packaging,
};

const runtime = {
  // Core stamps this onto a session so every later gate decision resolves the runtime it started on.
  id: 'cursor',

  /** Can this build load the Cursor SDK? Not the binary probe and not the credential probe. */
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

  answerApproval(request, verdict) { return approval.answerApproval(request, verdict); },
  stampOutbound(input, tag) { return approval.stampOutbound(input, tag); },
  axisBTools(request) { return axisB.axisBTools(request); },

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
};

module.exports = { descriptor, runtime };
