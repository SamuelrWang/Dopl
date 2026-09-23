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
// rather than assumed. Two declarations have teeth today: `meter.windowSource: 'reported'` — this
// runtime states its own context denominator on the wire, which BEATS `session-model.js ›
// CONTEXT_WINDOWS` — and `session.usageResetsOnResume: false`, MEASURED 2026-09-22 on the public
// `codex-cli 0.155.1`, which tells core to CARRY the usage baseline across a resume rather than
// zero it, because this runtime continues its totals through one (CXP-4; it refused the resume
// outright until the baseline became runtime-aware).
// ⚠ A THIRD ONE USED TO BE LISTED HERE — `meter.cost: null` — and the whole COST COLUMN is DELETED
// (2026-09-22, Samuel: *"we dont need cost tracking"*), on every adapter and in core.
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
    // ⚠ `'unverified'` — a legal value and a DIFFERENT answer from absent.
    //
    // ⚠ **THE PARAMETER EXISTS, AND THAT IS STILL NOT THE QUESTION** (§5 item C19, narrowed
    // 2026-09-22 from `codex app-server generate-json-schema`, `codex-cli 0.155.1` — a schema dump
    // that costs no model turn). `TurnStartParams.model` is declared and documented verbatim as
    // "Override the model for this turn and subsequent turns", so the old reason for this value —
    // "no per-turn model parameter is documented for app-server" — is retired.
    //
    // 🔒 ⚠ **IT STAYS `'unverified'` BECAUSE THIS RUNTIME IS MEASURED TO ACCEPT A FIELD AND IGNORE
    // IT.** `launch-spec.js › assertPolicyTook` records the measurement: `thread/start` took the
    // pre-v2 `approval_policy` spelling, started the thread, and answered with its OWN default —
    // no error anywhere. A declared parameter is therefore evidence the protocol has a slot, not
    // evidence the override TOOK. And there is nothing to check it against: `TurnStartResponse` is
    // `{ turn }` alone and `Turn` carries no model, so unlike `thread/start` (whose response
    // REQUIRES `approvalPolicy`, which is what makes `assertPolicyTook` possible) this verb offers
    // no echo. Confirming it means starting a real turn and reading which model answered.
    // ⚠ AND THE COST OF A WRONG `true` IS OPERATOR-FACING COPY: `runtime-copy.js ›
    // liveModelSwitchRefusal` asks `capability.js › canSwitchModelLive`, so `true` replaces "Dopl
    // will not claim it worked" with a live picker that silently may not have. Nothing is lost by
    // waiting — the model is set at launch.
    liveModelSwitch: 'unverified',
    // ⚠ A TURN TAKES A VALUE, NOT A STREAM. `turn/start` is a call and `turn/steer` appends to it;
    // core's push iterator is Dopl's own transport and `launch-spec.js` pumps it into those two
    // verbs. The other runtime consumes the iterable directly, which is why this is declared.
    promptModes: ['string'],
    // 🔒 ⚠ **`false` — MEASURED 2026-09-22 AGAINST `codex-cli 0.155.1`.** §5 item C8 is ANSWERED:
    // this runtime CONTINUES its cumulative total across `thread/resume`. One thread, one turn in
    // a cold `codex app-server` child, then the thread resumed in a SECOND child for two more
    // turns; `thread/tokenUsage/updated.total.totalTokens` read 18,838 → 42,429 → 71,194 while
    // `.last.totalTokens` read 18,838 / 23,591 / 28,765, and every step is the previous total plus
    // that turn's `last` EXACTLY. The resume did not restart anything.
    //
    // ⚠ **THE MEASUREMENT HAS NOT MOVED AND MUST NOT. WHAT MOVED IS WHAT CORE DOES WITH IT**
    // (CXP-4, 2026-09-22). `session-park.js › resumeParked` used to zero `lastTotalTokens`
    // unconditionally, on the assumption every runtime restarts its totals — so
    // against this one the first post-resume `result` re-billed the WHOLE thread, and `false` was
    // read as disqualifying to stop that. The baseline is RUNTIME-AWARE now: a runtime declaring
    // `false` has its baseline CARRIED FORWARD (`capability.js › resumeZeroesBaseline`, asked by
    // both `resumeParked` and `session-boot.js › parkedSessionFromRecord`), so only new work is
    // billed and `false` is no longer a refusal. `'unverified'` still is, because an unmeasured
    // runtime gives core no safe direction at all.
    //
    // ⚠ SO `capability.js › canResume` NOW ANSWERS TRUE HERE, AND `launch-spec.js › resume` —
    // which asks that predicate rather than restating it — opens with it. ⚠ A COLD LAUNCH WAS
    // NEVER AFFECTED, and still is not.
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
    // delegation, exfil or persistence. `tools.js`'s header carries the derivation: delegation is
    // fenced by configuration on every profile since 2026-09-22 (C25, `catalog.js`); persistence
    // (C26) is still ungrounded.
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
    // 🔒 ⚠ **A LIST SINCE 2026-09-22, BECAUSE THE SHAPE WAS READ — MEASURED against `codex-cli
    // 0.155.1`.** It was `null` (§5 item C12) for as long as that was the honest word: `null` here
    // means UNMEASURED, and a list is a claim to have read the payload, so it may only be written
    // once somebody has. Three live `thread/tokenUsage/updated` breakdowns off one thread name
    // exactly these four, on both `last` and `total`, and `normalize.js`'s header records them.
    // ⚠ **`cachedInputTokens` IS A SUBSET OF `inputTokens`, NOT A TERM BESIDE IT**, which is the
    // one thing this list must not be read as implying. `totalTokens === inputTokens +
    // outputTokens` holds exactly in every observed breakdown; adding the cached figure on top
    // over-reported a prompt of 18,833 as 25,873 and that defect was fixed the same day
    // (`normalize.js › tokensFrom`). The other runtime's `cache_read_input_tokens` IS additive —
    // the two conventions are declared per adapter precisely so neither is assumed of the other.
    // ⚠ THE TOLERANT SPELLING SWEEP IN `normalize.js` STAYS. A list is what this build MEASURED,
    // not a promise that no later CLI renames a field, and a spelling nobody has seen must still
    // meter rather than read as zero.
    fields: ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens'],
    // 🔒 ⚠ **`'reported'` SINCE 2026-09-22 — THIS RUNTIME STATES ITS OWN DENOMINATOR ON THE WIRE.**
    // It read `'config'` (`model_context_window` in `config.toml` — a configured denominator, not a
    // live one) and that was stale the moment the fold landed: every `thread/tokenUsage/updated`
    // carries `tokenUsage.modelContextWindow` as a SIBLING of `last`/`total` (MEASURED at 258400 on
    // `codex-cli 0.155.1`), `launch-spec.js` forwards it onto the `turn/completed` frame,
    // `normalize.js › windowFrom` reads it, and `session-model.js › contextEvent` PREFERS it over
    // the frozen `CONTEXT_WINDOWS` table. A descriptor naming a source core does not consult is
    // the "declared but not applied" failure this file exists to prevent.
    // ⚠ AND IT IS WHY NO `gpt-…` ROW WAS ADDED TO THAT TABLE: a runtime that reports its own window
    // each turn cannot go stale, where a transcribed table goes stale the week a vendor ships.
    windowSource: 'reported',
    // 🔒 ⚠ **THERE IS NO `cost` MEMBER ON THIS DESCRIPTOR, AND THAT IS A DELETION RATHER THAN AN
    // OMISSION (2026-09-22, Samuel: *"there shouldnt be cost? Claude theres no cost tracking. we
    // dont need cost tracking"*).** Every adapter declared one — Claude `{usd, billed:false}`,
    // Codex `null`, Cursor `{usd, billed:true}` — and a `showsCostCap` predicate (deleted with
    // it) read it to decide whether to render a control that did not exist on any surface. The whole column is
    // gone: `state.costUsd`, the durable record's field, both cost delta baselines and
    // `events.result`'s cost argument with it. ⚠ DO NOT ADD IT BACK ON ONE ADAPTER — a field one
    // runtime declares and the contract does not define is a question the next adapter author has
    // to answer for no reason, which is exactly what deleting it bought.
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
    // 🔒 MEASURED 2026-09-22, codex-cli 0.155.1 (CXP-3A; `test/codex-mcp-discovery.test.mjs`).
    // It was `null` on the assumption that Codex does not defer MCP tools. IT DOES, ALWAYS: the
    // first Responses request of a thread carries NO `mcp__dopl` tool, only a client-executed
    // `{ type: 'tool_search' }` whose description lists `dopl` as a source. Calling it (query
    // e.g. "dopl_channel") returns a `tool_search_output` holding namespace `mcp__dopl` with
    // `dopl_channel` (`defer_loading: true`), after which the model can call it and the call
    // reaches `mcpServer/elicitation/request` as before. `codex features list` shows
    // `tool_search_always_defer_mcp_tools` as REMOVED/true, the `[features]` toggles do nothing,
    // and no `mcp_servers.<name>` key opts a server out — deferral follows the model catalog's
    // `supports_search_tool`, which Dopl does not own. So the agent is TOLD to search.
    // ⚠ THAT IS THE NON-CODE-MODE SURFACE (gpt-5.5). Every other listed model in the 2026-09-22
    // catalog (`gpt-6-*`, `gpt-5.6-*`) is `tool_mode: code_mode_only`: the request carries NO
    // `tool_search`, only an `exec` tool running JS, and a deferred MCP tool is "omitted from this
    // description … listed in `ALL_TOOLS`" — measured: `ALL_TOOLS` held `mcp__dopl__dopl_channel`,
    // and `await tools.mcp__dopl__dopl_channel({ op })` inside `exec` reached the same
    // `mcpToolCall` item and `mcpServer/elicitation/request`. Hence `deferredCatalog`, and a turn
    // that names BOTH ways in (`prompt-framing.js › grantLines`).
    toolSearchVerb: 'tool_search',
    deferredCatalog: 'ALL_TOOLS',
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
