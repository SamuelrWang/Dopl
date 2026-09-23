// THE CLAUDE ADAPTER — the descriptor (pure data) and the runtime (the behaviour).
//
// Electron-free at load: `session-profiles.js` asks this registry for every gate decision and is
// evaluated standalone, so `loader.js` (electron) is lazy, and so are `launch-spec.js` /
// `normalize.js` (`normalize → session-io → session-profiles` would close a require cycle).

const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const models = require('./models');
const mcp = require('./mcp');
const credential = require('./credential');
const { packaging } = require('./packaging');
const { profileEntryFrom } = require('../contract');

const platform = () => require('./loader');
const launchSpec = () => require('./launch-spec');
const normalizer = () => require('./normalize');

// Derived from the one table that defines each profile, so the descriptor and the gate agree.
const profileEntry = (profile) => profileEntryFrom(tools.buildSessionToolConfig(profile));

const descriptor = {
  id: 'claude',
  label: 'Claude Code',

  session: {
    resume: true,
    fork: false,
    steer: true,
    // The only actuator of the reducer's `interrupt` / `abandon_timeout` effects; without it the
    // Stop control is disabled rather than a button that does nothing.
    interrupt: true,
    liveModelSwitch: true,
    // A resumed query restarts its cumulative usage, so resume zeroes the token baseline
    // (`capability.js › resumeZeroesBaseline`); `'unverified'` would refuse the resume.
    usageResetsOnResume: true,
  },

  axisB: axisB.descriptor,
  approval: approval.descriptor,

  toolMode: {
    // Narrowest first, in this platform's own words; the order is read (see `capability.js`).
    options: [
      { value: 'manual', label: 'Ask each time', description: 'Every tool call waits for you.', native: true },
      { value: 'accept_edits', label: 'Accept edits', description: 'File writes run; everything else asks.', native: true },
      { value: 'auto', label: 'Auto', description: 'Reads and edits run; shell and network ask.', native: true },
      { value: 'bypass', label: 'Bypass', description: 'Every classified work tool runs. Hard-denied tools never do.', native: true },
    ],
    default: 'manual',
    // The mode an unattended session floors to (a windowless session has no gate surface).
    windowlessFloor: 'auto',
    // null, not {}: no second containment axis, so the UI renders nothing there.
    secondaryAxis: null,
    freeform: null,
    editScopedTools: tools.EDIT_TOOLS.slice(),
    // Positive allow-lists only: an unrecognised name is in none and gates in every mode.
    taxonomy: {
      auto: tools.AUTO_TOOLS.slice(),
      bypass: tools.BYPASS_TOOLS.slice(),
      bypassReads: tools.BYPASS_READS.slice(),
      edits: tools.EDIT_TOOLS.slice(),
      escalation: tools.ESCALATION_TOOLS.slice(),
    },
  },

  containment: {
    // No native containment layer: every bound is a list Dopl maintains in this tool vocabulary.
    mode: 'dopl-enumerated',
    // Every profile with a non-null deny list, or the adapter does not register (LAUNCH_BLOCKING).
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
    // The verb an agent loads a deferred tool with; `null` omits the sentence, never translates it.
    toolSearchVerb: 'ToolSearch',
    deferredCatalog: null,
  },

  packaging,
};

const runtime = {
  // Core stamps this onto a session so every later gate decision resolves the runtime it started on.
  id: 'claude',

  /** Can the platform module load? Not the binary probe and not the credential probe. */
  async available() {
    try {
      await platform().getSdk();
      return { ok: true, reason: '' };
    } catch (err) {
      return { ok: false, reason: (err && err.message) || 'runtime unavailable' };
    }
  },

  buildLaunchSpec(request) { return launchSpec().buildLaunchSpec(request); },
  start(spec) { return launchSpec().start(spec); },
  resume(spec, priorHandle) { return launchSpec().resume(spec, priorHandle); },
  normalize(msg, ctx) { return normalizer().normalize(msg, ctx); },

  answerApproval(request, verdict) { return approval.answerApproval(request, verdict); },
  stampOutbound(result, tag) { return approval.stampOutbound(result, tag); },
  axisBTools(session) { return axisB.axisBTools(session); },

  toolConfigFor(profile) { return tools.buildSessionToolConfig(profile); },
  axisAAllows(mode, toolName) { return tools.toolModeAllows(mode, toolName); },

  models() { return models.models(); },
  rosterKey() { return models.rosterKey(); },
  modelArg(value) { return models.resolveLaunchModel(value); },
  registerMcp(cfg) { return mcp.registerMcp(cfg); },
  probeMcp() { return mcp.probeMcp(); },
  credentialState() { return credential.credentialState(); },
  signIn() { return credential.signIn(); },
};

module.exports = { descriptor, runtime };
