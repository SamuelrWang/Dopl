// THE CODEX ADAPTER — the descriptor (pure data) and the runtime (the behaviour).
//
// ⚠ THE SECOND RUNTIME, AND IT IS A DIRECTORY ADDITION PLUS ONE REGISTRATION LINE. That is the
// entire return on the extraction wave: not one of the 138 core modules grew a branch, and every
// conformance case in `test/runtime-contract.test.mjs` applied to this adapter the moment it
// registered, without anybody writing a second suite.
//
// ⚠ THE CORE START/TURN PATH HAS NOW COMPLETED A LIVE TURN against the ChatGPT-bundled Codex alpha,
// and the v2 request/notification shapes below are pinned by generated-schema fixtures. That is
// implementation evidence, not a supported distribution contract: a packaged-Dopl smoke and
// long-wait wake behavior remain unmeasured. Anything still ungrounded stays DECLARED UNVERIFIED
// rather than assumed. Two declarations have teeth today: `meter.cost: null` hides the cost cap,
// and `session.usageResetsOnResume: false` — MEASURED 2026-09-22 on the public `codex-cli
// 0.155.1` — refuses resume because this runtime CONTINUES its totals across one.
//
// ⚠ ELECTRON-FREE AT LOAD, BY CONTRACT. `main/session-profiles.js` is a PURE module two suites
// slice and evaluate standalone, and it asks the registry for every gate decision — so requiring
// the registry must not pull `electron` or spawn a child process. `launch-spec.js` (which reaches
// `channel-dirs.js` -> electron) and `normalize.js` (which reaches `session-io.js` ->
// `session-profiles.js`, closing a require cycle) are therefore lazy, exactly as they are in the
// Claude adapter and for exactly the same two reasons.

const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const models = require('./models');
const mcp = require('./mcp');
const credential = require('./credential');
const { packaging } = require('./packaging');

const platform = () => require('./client');
const launchSpec = () => require('./launch-spec');
const normalizer = () => require('./normalize');

// The per-profile containment entry, derived from the ONE table that defines it so the descriptor
// and the gate can never disagree about what a profile denies.
function profileEntry(profile) {
  const cfg = tools.buildSessionToolConfig(profile);
  return {
    // ⚠ THE NATIVE CONTROL THIS PROFILE PINS, or null where the operator's own row rides. A
    // restricted profile is containment and pins the pair; `full`'s supervision is Axis A plus the
    // sandbox row, so it pins nothing.
    native: cfg.native,
    denyList: cfg.disallowedTools.slice(),
    allowList: cfg.preApproved.slice(),
    builtinBound: cfg.builtinTools.length ? cfg.builtinTools.slice() : null,
  };
}

// ── THE DESCRIPTOR ───────────────────────────────────────────────────────────────────────────

const descriptor = {
  id: 'codex',
  label: 'Codex',
  vendor: 'OpenAI',
  // ⚠ THE FILENAME IS THE CONVENTION, and it is a runtime fact rather than a preference.
  entryFile: 'AGENTS.md',

  session: {
    // `thread/resume` exists (`codex-research.md` §3) — the CAPABILITY is real and is declared.
    // Whether Dopl may USE it is `usageResetsOnResume` below, which is a different question.
    resume: true,
    // ⚠ TRUE, AND IT HAS NO ANALOGUE ON THE OTHER RUNTIME. `thread/fork` is first-class here and
    // is a direct fit for the reopen-in-place problem: fork rather than reopen when a follow-up
    // would clobber a live turn.
    fork: true,
    steer: true, //      `turn/steer` — append input mid-turn
    // ⚠ TRUE, AND IT IS WHAT LETS DOPL OWN A SESSION IT STARTED. `turn/interrupt` is the
    // documented verb; without one the reducer's `interrupt` and `abandon_timeout` effects have no
    // actuator and the Stop control would be a button that does nothing.
    interrupt: true,
    // ⚠ `'unverified'` — a legal value and a DIFFERENT answer from absent. The research documents
    // a per-thread/per-turn `model` for the SDK (`@openai/codex-sdk`), and this adapter targets
    // `app-server`, where no per-turn model parameter is documented. The design's §1.2 comment
    // asserts "Codex per-turn"; the research does not carry it, so the live picker stays hidden on
    // a running agent until §5 item C19 answers. Nothing is lost — the model is set at launch.
    liveModelSwitch: 'unverified',
    // ⚠ A TURN TAKES A VALUE, NOT A STREAM. `turn/start` is a call and `turn/steer` appends to it;
    // core's push iterator is Dopl's own transport and `launch-spec.js` pumps it into those two
    // verbs. The other runtime consumes the iterable directly, which is why this is declared.
    promptModes: ['string'],
    // 🔒 ⚠ **`false` — MEASURED 2026-09-22 AGAINST `codex-cli 0.155.1`, AND IT STILL REFUSES A
    // RESUME.** §5 item C8 is ANSWERED: this runtime CONTINUES its cumulative total across
    // `thread/resume`. One thread, one turn in a cold `codex app-server` child, then the thread
    // resumed in a SECOND child for two more turns; `thread/tokenUsage/updated.total.totalTokens`
    // read 18,838 → 42,429 → 71,194 while `.last.totalTokens` read 18,838 / 23,591 / 28,765, and
    // every step is the previous total plus that turn's `last` EXACTLY. The resume did not restart
    // anything.
    //
    // ⚠ SO THE REFUSAL STANDS, WITH A DIFFERENT REASON. `session-park.js › resumeParked` zeroes
    // `lastTotalCost` / `lastTotalTokens` on the assumption that a resumed conversation restarts
    // its totals. On a continuing runtime that baseline reset re-bills the WHOLE thread on the
    // first post-resume `result` — the cost cap fires on history the operator already paid for,
    // and a longer thread hits it sooner. `capability.js › canResume` requires `=== true`, so
    // `false` keeps the door shut and `capability.js › resumeRefusal` now states the measured
    // sentence ("continues cumulative usage across a resume") instead of "unverified".
    //
    // ⚠ WHAT OPENS IT IS A CORE CHANGE, NOT THIS FIELD: `resumeParked` must PRESERVE the baseline
    // for a runtime that declares `false` rather than zero it. That is CXP-4's remaining half and
    // it lives in `main/session-park.js`. A COLD LAUNCH IS UNAFFECTED, as it always was.
    usageResetsOnResume: false,
  },

  axisB: axisB.descriptor,
  approval: approval.descriptor,

  toolMode: {
    axis: 'tools',
    // ⚠ `approval_policy`'S OWN FOUR VALUES, IN THE PLATFORM'S OWN WORDS, NARROWEST FIRST. No
    // synthesised modes and no mode borrowed from another runtime's vocabulary: a Codex operator
    // already knows these words from `config.toml`, from `-a/--ask-for-approval` and from the
    // `/permissions` picker. `on-failure` is absent because the research documents it as
    // DEPRECATED. `tools.js › TOOL_MODES` carries the argument for where `granular` sits.
    options: [
      { value: 'untrusted', label: 'untrusted', description: 'Approves only known-safe read operations. Blocks state mutations and external execution.', native: true },
      { value: 'granular', label: 'granular', description: 'Selective approval per category — the five rows below.', native: true },
      { value: 'on-request', label: 'on-request', description: 'Codex asks before escalating out of the sandbox, reaching the network, or causing side effects.', native: true },
      { value: 'never', label: 'never', description: 'No approval prompts from Codex. Dopl\'s own hard-deny and outbound gate still hold.', native: true },
    ],
    // ⚠ THE DEFAULT IS THE NARROWEST — a session starts asking, and a park resets it there.
    default: 'untrusted',
    windowlessFloor: tools.WINDOWLESS_FLOOR,
    allows: 'axisAAllows',
    // ⚠ A SECOND CONTAINMENT AXIS THE OTHER RUNTIME DOES NOT HAVE, so the UI renders a row here
    // that simply does not exist there — no placeholder on the runtime that lacks it. Enforcement
    // is OS-native (Seatbelt on macOS, bubblewrap on Linux/WSL2, Windows Sandbox).
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
    // ⚠ null: the classifier-instruction control is another runtime's, and an empty object here
    // would render an empty control instead of no control.
    freeform: null,
    // ⚠ EMPTY, DELIBERATELY, AND `tools.js › EDIT_ITEMS` CARRIES THE ARGUMENT. A grant scoped to a
    // resolved DIRECTORY needs to know which field of the approval payload holds the path, and
    // that payload is §5 item C2 — uncaptured. An unknown field makes the grant key fall back to a
    // digest of the WHOLE input, which is strictly NARROWER than a directory scope. Taking the
    // narrow answer while the shape is unmeasured is the safe direction.
    editScopedTools: [],
    // ⚠ THE AXIS-A TAXONOMY, AS DECLARED DATA — the same knowledge `axisAAllows` answers with, in
    // the form a suite can pin and a UI could render. A gate decision asks the METHOD, never a
    // membership test against these, because only the runtime knows how its modes compose them.
    taxonomy: {
      auto: tools.ON_REQUEST_TOOLS.slice(),
      bypass: tools.NEVER_TOOLS.slice(),
      // ⚠ EMPTY BECAUSE THERE IS NOTHING TO PUT IN IT. Claude's `bypassReads` names side-effect-free
      // built-ins its widest mode may add; this runtime raises no approval request for a read at
      // all, so there is no such name. `[]` says "no members"; `null` would say "no such concept".
      bypassReads: [],
      edits: tools.EDIT_ITEMS.slice(),
      escalation: tools.ESCALATION_ITEMS.slice(),
    },
  },

  containment: {
    // ⚠ `native` AND STILL A DENY LIST. A sandbox bounds the FILESYSTEM; it does not deny
    // delegation, exfil or persistence. `tools.js`'s header carries the derivation, including the
    // two harm groups this research cannot ground (§5 items C25/C26).
    mode: 'native',
    nativeControls: ['sandbox_mode'],
    profiles: {
      read_only: profileEntry('read_only'),
      dopl_only: profileEntry('dopl_only'),
      // ⚠ THE FOURTH PROFILE (2026-09-02, ruling B7), DECLARED ON THIS LANE TOO — Codex SHIPS
      // (X0 holds Cursor, not this one), so a shared-container launch here must reach the same
      // containment as on Claude, expressed in this runtime's own approval vocabulary.
      channel_agent: profileEntry('channel_agent'),
      full: profileEntry('full'),
    },
  },

  models: models.descriptor,

  meter: {
    // ⚠ per-turn: `usage` arrives on `turn/completed` and the research says so explicitly — "not a
    // live running meter". Dopl accumulates, which is the same discipline as the NEVER-trust-a-
    // cumulative-total rule the other runtime already runs under.
    mode: 'per-turn',
    // ⚠ NULL RATHER THAN A GUESSED LIST (§5 item C12). The research says the payload is TOKENS and
    // does not name its fields, so `normalize.js` reads them tolerantly across the plausible
    // spellings and finds nothing rather than painting a wrong number. A list here would read as a
    // measurement.
    fields: null,
    // `model_context_window` in config — a configured denominator, not a live one.
    windowSource: 'config',
    // ⚠ NULL, AND THE COST CAP IS THEREFORE HIDDEN — not zeroed, not rendered-and-inert. Nothing
    // in the research says Codex reports a USD cost at all; `total_cost_usd` is the other
    // runtime's field. `session-state.js › costCapReached` is fed by exactly one number, so a cap
    // over a field the platform never emits is a control that silently does not exist. §5 item
    // C11 is what would turn this on, and Samuel's open question 4 is whether "hide it and say so"
    // is the right answer at all — this design's answer is yes; deriving a cost from tokens times a
    // price table would be a guess against the null-never-zero rule.
    cost: null,
  },

  mcp: mcp.descriptor,

  // ⚠ `'unverified'` (§5 item C13), AND IT IS NOT COSMETIC: it changes what the MCP server TEACHES.
  // `packages/mcp-server` teaches arm-and-re-arm only where a long-pending call really is
  // backgrounded and delivered as a wake, and says plainly that there is no wake where it is not.
  // Until a tester holds `op="read"` with `wait_ms` for ~4 minutes against a live app-server, this runtime
  // promises nothing — and `thresholdMs` is null rather than the other runtime's number, because
  // a budget sized against an unmeasured behaviour is a number nobody measured.
  wake: { backgroundsPendingCall: 'unverified', thresholdMs: null },

  credential: credential.descriptor,

  // ⚠ NULL IN v1, AND THE `codex://` SCHEME EXISTING IS NOT A REASON TO DECLARE IT. Three things
  // have to be true for a deep-link rung and only the first is: the scheme is documented
  // (`codex://new?prompt=…&path=…`), but ① the prompt DOES NOT AUTO-SEND — it lands in a composer
  // and a human presses enter, so it is strictly a prefill; ② there is no contracted third-party
  // way to open an existing local conversation by id (`codex://threads/<id>` exists and is not
  // contracted; there is an open issue asking for exactly that); ③ THE URL CEILING IS UNMEASURED,
  // and the standing invariant is MEASURE THE BUILT OUTPUT AND ASSUME SILENT DROP OR TRUNCATION —
  // the 1.7.21 bruise, where a scheme silently dropped >4096 chars and still reported success.
  // §5 item C14 says to BISECT that ceiling, not read it. A descriptor cannot honestly carry a
  // `ceiling` nobody has bisected, and the design's §7 ships no deep-link rung for any platform in
  // v1 anyway — with app-server as the primary rung, links matter far less here than they did
  // before. So: null, and C14 is what flips it.
  deepLink: null,

  ambientFences: {
    // ⚠ A PATTERN WITH NO MEASUREMENT BEHIND IT — see `launch-spec.js › PERMISSION_ENV_RE`. The
    // research names no environment knob for this runtime; its escape hatches are CLI flags and
    // config, both fenced by the flag below. Declared so the next reader knows the scrub is belt
    // rather than braces (§5 item C21).
    envDeny: ['^(CODEX_|OPENAI_).*(PERMISSION|BYPASS|APPROVAL|DONT_ASK|SKIP|AUTO_APPROVE|DANGEROUS|YOLO)'],
    // The app-server has no `--ignore-user-config` flag. Dopl instead supplies an app-owned
    // CODEX_HOME containing no config/profile files and a deliberately scoped auth link.
    configFlags: [],
    configRoot: 'isolated-CODEX_HOME',
  },

  prose: {
    // ⚠ NULL => THE "load it with ToolSearch" SENTENCE IS OMITTED, NEVER TRANSLATED into a verb
    // that does not exist. Nothing in the research says this runtime defers MCP tools at all.
    toolSearchVerb: null,
    // ⚠ `'unverified'`, matching `wake.backgroundsPendingCall`. The guidance an agent is given
    // about awaiting is a claim about what the HOST does with a long-pending call, and this one is
    // unmeasured.
    awaitGuidance: 'unverified',
    entryFile: 'AGENTS.md',
  },

  // ⚠ THE SEAM, DELIBERATELY OPEN AND DELIBERATELY EMPTY. Cloud/remote execution is out of scope
  // (decision 6), but `remoteCapable` is TRUE here where it is false on the other runtime, and
  // that is a measured difference rather than optimism: `--remote`, `codex remote-control` and
  // `codex cloud` are all documented. Adding `'cloud'` to `locations` later is a descriptor change
  // plus a location picker, not a re-architecture. Length 1 renders no picker at all.
  execution: { locations: ['local'], remoteCapable: true },

  packaging,
};

// ── THE RUNTIME ──────────────────────────────────────────────────────────────────────────────

const runtime = {
  // ⚠ THE ID, ON THE BEHAVIOUR HALF TOO. Core stamps it onto a session at spawn so every later
  // gate decision, floor and tool lookup resolves the SAME runtime the session started on.
  id: 'codex',

  /**
   * ⚠ THE BINARY PROBE, AND ON THIS RUNTIME IT IS A REAL QUESTION. `packaging.delivery` is `path`,
   * so the executable is the OPERATOR'S and may simply not be there. This answers only "is there a
   * `codex` on PATH that runs" — not whether this Mac is signed in (that is `credentialState`),
   * and not whether the registry could load the module. Collapsing those three is how a machine
   * with a perfectly good binary came to be told channel requests could not be answered.
   */
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
  axisBTools(session) { return axisB.axisBTools(session); },

  toolConfigFor(profile) { return tools.buildSessionToolConfig(profile); },
  axisAAllows(mode, toolName) { return tools.axisAAllows(mode, toolName); },

  models() { return models.models(); },
  registerMcp(cfg) { return mcp.registerMcp(cfg); },
  probeMcp() { return mcp.probeMcp(); },
  credentialState() { return credential.credentialState(); },
  signIn() { return credential.signIn(); },
};

module.exports = { descriptor, runtime };
