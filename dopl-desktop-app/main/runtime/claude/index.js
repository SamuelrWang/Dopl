// THE CLAUDE ADAPTER — the descriptor (pure data) and the runtime (the behaviour).
//
// ⚠ THIS IS THE CURRENT BEHAVIOUR, EXTRACTED — ALMOST (2026-08-31, port step 3; corrected
// 2026-09-01). Most of `main/runtime/claude/` was moved rather than rewritten, and the value of
// the step is entirely that the SECOND adapter is a directory addition instead of a branch added
// to 138 core modules. ⚠ BUT "the desktop suite passing unchanged is the acceptance test" WAS NOT
// ENOUGH AND THE INTENT WAS NOT MET: an independent diff against `git show HEAD:` found SEVEN
// observable differences in the Claude lane, two of which were regressions (a lost `try/catch` and
// a discarded sentinel return, both now fixed) and two of which are NEW FEATURES that rode inside
// a change described as a move. `docs/INVARIANTS.md` §11.0g is the enumerated list. **A suite that
// passes is evidence a move was safe; only a DIFF is evidence it was a move.**
//
// ⚠ ELECTRON-FREE AT LOAD, BY CONTRACT. `main/session-profiles.js` is a PURE module that two
// suites slice and evaluate standalone, and it asks the registry for every gate decision — so
// requiring the registry must not pull `electron`. `loader.js` (which does) is reached only
// through the lazy `platform()` below, and `launch-spec.js` / `normalize.js` are lazy for the
// same reason plus one more: `normalize.js` reads `session-io.js`, which reads
// `session-profiles.js`, and a top-level require here would close that loop and hand the gate a
// half-initialised module at exactly the moment it asks for a deny list.

const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const models = require('./models');
const mcp = require('./mcp');
const credential = require('./credential');
const triage = require('./triage');
const { packaging } = require('./packaging');

const platform = () => require('./loader');
const launchSpec = () => require('./launch-spec');
const normalizer = () => require('./normalize');

// ── THE DESCRIPTOR ───────────────────────────────────────────────────────────────────────────
//
// ⚠ PURE DATA. `contract.js › sealAdapter` deep-freezes it, refuses a function anywhere inside it,
// and refuses the whole adapter if the Axis-B enforcement point or any profile's deny list is
// null. The UI never sees anything else.
const descriptor = {
  id: 'claude',
  label: 'Claude Code',
  vendor: 'Anthropic',
  // ⚠ THE FILENAME IS THE CONVENTION, and it is a runtime fact rather than a preference: the
  // spawn walks up from `cwd` and loads whatever this runtime's entry file is called, which is
  // why the cwd is documented as CONTEXT and not as a fence.
  entryFile: 'CLAUDE.md',

  session: {
    resume: true,
    // ⚠ false: there is no fork verb here. A second run on the same conversation is a second
    // cold launch with the conversation id, which is not the same thing and is not offered as one.
    fork: false,
    steer: true,
    // ⚠ TRUE, AND IT IS WHAT LETS DOPL OWN A SESSION IT STARTED. `session-engine.js › runEffect`
    // case `interruptQuery` is the tree's ONLY interrupt, and the reducer's `interrupt` and
    // `abandon_timeout` effects have no other actuator. A runtime that answers anything else here
    // disables the Stop control rather than shipping a button that does nothing.
    interrupt: true,
    liveModelSwitch: true,
    promptModes: ['stream', 'string'],
    // ⚠ TRUE, AND IT IS AN ASSUMPTION THIS TREE HAS ALWAYS MADE RATHER THAN A MEASUREMENT.
    // `session-park.js › resumeParked` zeroes both delta baselines under an explicit ⚠ ASSUMPTION
    // comment. Declaring it here is what makes it CHECKABLE: `'unverified'` refuses a resume
    // (cold launch unaffected), because a runtime that CONTINUES the cumulative total makes every
    // delta negative, clamps it to zero, and stops the cost cap ever firing — silently, with no
    // symptom until a bill arrives.
    usageResetsOnResume: true,
  },

  axisB: axisB.descriptor,
  approval: approval.descriptor,

  toolMode: {
    axis: 'tools',
    // ⚠ NARROWEST FIRST, AND THE ORDER IS READ. `[0]` is where every unknown value fail-closes and
    // the LAST entry is the widest mode, which is how the windowless floor stays widen-only and
    // how "is this tool classified at all" is asked without core holding a copy of any list.
    // ⚠ THE LABELS ARE THIS PLATFORM'S OWN WORDS. No synthesised modes, and no mode borrowed from
    // another runtime's vocabulary — the operator's mental model stays "this is what my runtime
    // does", never "this is Dopl pretending".
    options: [
      { value: 'manual', label: 'Ask each time', description: 'Every tool call waits for you.', native: true },
      { value: 'accept_edits', label: 'Accept edits', description: 'File writes run; everything else asks.', native: true },
      { value: 'auto', label: 'Auto', description: 'Reads and edits run; shell and network ask.', native: true },
      { value: 'bypass', label: 'Bypass', description: 'Every classified work tool runs. Hard-denied tools never do.', native: true },
    ],
    default: 'manual',
    // ⚠ THE MODE AN UNATTENDED SESSION FLOORS TO ON THIS RUNTIME. A windowless session has no gate
    // surface, so a gated tool there is a silent DENY — including the reads the prompt ORDERS the
    // agent to make. `null` refuses the windowless launch instead of guessing a posture.
    windowlessFloor: 'auto',
    allows: 'axisAAllows',
    // ⚠ null, not an empty object: this runtime has no second containment axis, so the UI renders
    // NOTHING where a sandbox row would be — no placeholder, no disabled control.
    secondaryAxis: null,
    freeform: null,
    // The names whose grant key is scoped to a resolved directory (`session-grant-keys.js`).
    editScopedTools: tools.EDIT_TOOLS.slice(),
    // ⚠ THE AXIS-A TAXONOMY, AS DECLARED DATA. `axisAAllows` is the QUESTION core asks and is
    // enough for every gate decision; this is the same knowledge in the form a suite can pin and
    // a UI could render. It is here rather than exported off the module because the descriptor is
    // the one thing that is pure, frozen and JSON-serialisable — a list core reached for by
    // module reference would be a list core could hold, and holding one runtime's tool
    // vocabulary in core is exactly what the extraction removed.
    // ⚠ EVERY ENTRY IS A POSITIVE ALLOW-LIST. An unrecognised name is in none of them and
    // therefore gates in EVERY mode, the widest included — which is why a runtime may not
    // express a mode as "everything except…".
    taxonomy: {
      auto: tools.AUTO_TOOLS.slice(),
      bypass: tools.BYPASS_TOOLS.slice(),
      bypassReads: tools.BYPASS_READS.slice(),
      edits: tools.EDIT_TOOLS.slice(),
      escalation: tools.ESCALATION_TOOLS.slice(),
    },
  },

  containment: {
    // ⚠ `dopl-enumerated`: this runtime ships no containment layer of its own, so every bound is a
    // list Dopl maintains in its tool vocabulary. A runtime with a native sandbox declares
    // `native` AND STILL OWES A DENY LIST for the restricted profiles — a sandbox bounds the
    // filesystem, it does not deny delegation, exfil or persistence built-ins.
    mode: 'dopl-enumerated',
    nativeControls: null,
    // ⚠ EVERY PROFILE, WITH A NON-NULL `denyList`, OR THE ADAPTER DOES NOT REGISTER. This is the
    // one place absent does not mean hide, because the control here IS containment
    // (`contract.js › LAUNCH_BLOCKING`).
    profiles: {
      read_only: profileEntry('read_only'),
      dopl_only: profileEntry('dopl_only'),
      full: profileEntry('full'),
    },
  },

  models: models.descriptor,

  meter: {
    // ⚠ per-message: the meter reads the LAST ASSISTANT MESSAGE'S own usage, not the turn total,
    // because the turn total is monotonic and never corrects after a compaction.
    mode: 'per-message',
    fields: ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'],
    windowSource: 'table',
    // ⚠ A COST SIGNAL EXISTS, so the cost cap is a real control. `null` here would HIDE the cap
    // rather than render one that can never fire — `session-state.js › costCapReached` is fed by
    // exactly this number, and a zero is a budget that never trips.
    cost: { currency: 'usd', billed: false },
  },

  mcp: mcp.descriptor,

  // Does a long-pending MCP call get backgrounded and delivered as a wake? ⚠ TRUE here, and it is
  // what the server's await budget is SIZED against — `packages/mcp-server` teaches arm-and-re-arm
  // only where this is true, and says plainly that there is no wake where it is not.
  wake: { backgroundsPendingCall: true, thresholdMs: 120000 },

  credential: credential.descriptor,

  // ⚠ null: the deep-link rung was DELETED with the pre-consent session window (F-228) and is not
  // coming back as parity work. Nothing renders an "Open in…" button here.
  deepLink: null,

  ambientFences: {
    // The permission-bypass env knobs the scrub drops, and the account-connector switch it sets
    // last and unconditionally. ⚠ Declared because an adapter must enumerate ITS OWN provider's
    // knobs: ambient config that survives the scrub can flip the gate.
    envDeny: ['^(CLAUDE_CODE_|ANTHROPIC_).*(PERMISSION|BYPASS|ACCEPT_EDITS|DONT_ASK|SKIP_PERMISSIONS|AUTO_APPROVE|DANGEROUS)'],
    configFlags: ['settingSources:[]', 'ENABLE_CLAUDEAI_MCP_SERVERS=0'],
  },

  prose: {
    // The verb an agent is told to load a deferred tool with. ⚠ `null` on a runtime without one
    // means the sentence is OMITTED, never translated into a verb that does not exist.
    toolSearchVerb: 'ToolSearch',
    awaitGuidance: 'backgrounds',
    entryFile: 'CLAUDE.md',
  },

  // ⚠ A SEAM, DELIBERATELY OPEN AND DELIBERATELY EMPTY. Cloud/remote execution is out of scope;
  // adding `'cloud'` later is a descriptor change plus a location picker, not a re-architecture.
  // Length 1 renders no picker at all.
  execution: { locations: ['local'], remoteCapable: false },

  triage: triage.descriptor,
  packaging,
};

// The per-profile containment entry, derived from the one table that defines it so the descriptor
// and the gate can never disagree about what a profile denies.
function profileEntry(profile) {
  const cfg = tools.buildSessionToolConfig(profile);
  return {
    native: null, // no native containment control on this runtime
    denyList: cfg.disallowedTools.slice(),
    allowList: cfg.preApproved.slice(),
    builtinBound: cfg.builtinTools.length ? cfg.builtinTools.slice() : null,
  };
}

// ── THE RUNTIME ──────────────────────────────────────────────────────────────────────────────

const runtime = {
  // ⚠ THE ID, ON THE BEHAVIOUR HALF TOO. Core stamps it onto a session at spawn so every later
  // gate decision, floor and tool lookup resolves the SAME runtime the session started on —
  // a park, a crash resume and a post-sign-in relaunch must not be able to land on another.
  id: 'claude',

  /**
   * ⚠ THE SAME QUESTION THE OLD `getSdk()` ANSWERED, AND NO WIDER. It reports whether the platform
   * module can be loaded at all — not whether a binary is on PATH and not whether this machine is
   * signed in. Those are separate probes with separate answers, and collapsing them is how a
   * machine with a perfectly good bundled binary came to be told channel requests could not be
   * answered.
   */
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
  registerMcp(cfg) { return mcp.registerMcp(cfg); },
  probeMcp() { return mcp.probeMcp(); },
  credentialState() { return credential.credentialState(); },
  signIn() { return credential.signIn(); },
  triageSpec(request) { return triage.triageSpec(request); },
};

module.exports = { descriptor, runtime };
