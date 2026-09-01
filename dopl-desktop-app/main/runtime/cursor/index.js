// THE CURSOR ADAPTER — the descriptor (pure data) and the runtime (the behaviour).
//
// ⚠ THE THIRD RUNTIME, AND IT IS A DIRECTORY ADDITION PLUS ONE REGISTRATION LINE. Not one of the
// 138 core modules gained a branch, and every conformance case in `test/runtime-contract.test.mjs`
// applied to this adapter the moment it registered, without anybody writing a second suite.
//
// ⚠ AND IT IS THE ADAPTER THE ARCHITECTURE WAS WRITTEN FOR. The other two are held-callback
// runtimes and could have shared one shape; this one has NO permission callback at all
// (`approval.js`), so Axis A is the platform's own run mode and Axis B is `local.customTools` —
// an IN-PROCESS tool boundary, the only non-callback answer `axisB.enforcementPoint` admits. Every
// field the design added for that case (`enforcementPoint`, `containment.mode`, `inputRewrite`,
// `mcp.sessionTransport`) is a field this adapter answers differently from both others, which is
// what `test/adapter-parity.test.mjs` now measures rather than predicts.
//
// ⚠ NOTHING HERE WAS TESTED AGAINST A LIVE CURSOR. Per the design's locked decision (4) there were
// no installs; every value below is read off `cursor-research.md`. WHAT COULD NOT BE GROUNDED IS
// DECLARED UNVERIFIED RATHER THAN ASSUMED, and each one names the §5 smoke item that settles it.
//
// ⚠ THREE OF THOSE DECLARATIONS HAVE TEETH TODAY, AND THE FIRST IS A SHIP GATE:
//   `session.interrupt: 'unverified'`         DOPL CANNOT STOP A SESSION IT STARTED. §5 item X0.
//                                             `capability.js › canInterrupt` reads it as false so
//                                             the Stop control is refused, and the design's step 8
//                                             says a runtime Dopl cannot stop does not ship. THIS
//                                             IS THE OPEN THAT BLOCKS RELEASE, not a hidden button.
//   `session.usageResetsOnResume: 'unverified'`  refuses a RESUME (cold launch unaffected), and it
//                                             matters more here than anywhere because this is the
//                                             one runtime that reports a REAL BILLED COST.
//   `triage: null`                            this runtime does not run wake tier 3.

const tools = require('./tools');
const axisB = require('./axis-b');
const approval = require('./approval');
const models = require('./models');
const mcp = require('./mcp');
const credential = require('./credential');
const triage = require('./triage');
const { packaging } = require('./packaging');

// ⚠ ELECTRON-FREE AT LOAD, BY CONTRACT. `main/session-profiles.js` is a PURE module two suites
// slice and evaluate standalone, and it asks the registry for every gate decision — so requiring
// the registry must not pull `electron` or import an ESM package. `client.js` (dynamic import),
// `launch-spec.js` (which reaches `channel-dirs.js` -> electron) and `normalize.js` (which reaches
// `session-io.js` -> `session-profiles.js`, closing a require cycle) are therefore lazy, exactly
// as they are in both other adapters and for exactly the same two reasons.
const platform = () => require('./client');
const launchSpec = () => require('./launch-spec');
const normalizer = () => require('./normalize');

// The per-profile containment entry, derived from the ONE table that defines it so the descriptor
// and the gate can never disagree about what a profile denies.
function profileEntry(profile) {
  const cfg = tools.buildSessionToolConfig(profile);
  return {
    // ⚠ THE NATIVE CONTROLS THIS PROFILE PINS, or null where the operator's own rows ride. A
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
  id: 'cursor',
  label: 'Cursor',
  vendor: 'Anysphere',
  // ⚠ THE FILENAME IS THE CONVENTION, and it is a runtime fact rather than a preference. Whether
  // this runtime walks UP from `cwd` to find it, the way the Claude lane does, is §5 item B2.
  entryFile: '.cursorrules',

  session: {
    // `Agent.resume(agentId)` exists — the CAPABILITY is real and is declared. Whether Dopl may
    // USE it is `usageResetsOnResume` below, which is a different question.
    resume: true,
    // ⚠ false: there is no fork verb here. A second run on one agent is a second `send`, which is
    // not the same thing and is not offered as one.
    fork: false,
    // ⚠ `'unverified'` — §5 item X0, and the SAME item as `interrupt`. `cursor-research.md`
    // documents `agent.send()` and `run.stream()` and NO steer API. `launch-spec.js` therefore
    // turns each pushed message into a NEW run rather than an append, which is a different
    // behaviour from a mid-turn steer and is declared rather than passed off as one.
    steer: 'unverified',
    // ⚠ `'unverified'`, AND IT IS THE SHIP GATE. §5 item X0. `session-engine.js › runEffect` case
    // `interruptQuery` is the tree's only `.interrupt()` and the reducer's `interrupt` and
    // `abandon_timeout` effects have no other actuator, so WITHOUT ONE DOPL CANNOT STOP A SESSION
    // IT STARTED. `capability.js › canInterrupt` reads anything but `true` as false, so the Stop
    // control is not offered and `capability.js › interruptRefusal` says why — and the design's
    // step 8 is explicit that this runtime does not ship until X0 comes back positive. The partial
    // mitigation the in-process design buys (`axis-b.js › closeSession` makes every Dopl tool
    // refuse after the end) is a mitigation and NOT a resolution: the run keeps going.
    interrupt: 'unverified',
    // ⚠ TRUE: `model: {id, params}` is documented BOTH on `Agent.create()` and as a per-`send()`
    // override, so the next turn can run on another model without restarting the agent — which is
    // what the live picker needs. The other native runtime declares `'unverified'` here because
    // its per-turn model is documented for a DIFFERENT surface than the one its adapter targets.
    liveModelSwitch: true,
    // ⚠ A TURN TAKES A VALUE, NOT A STREAM. `agent.send(msg)` is a call; core's push iterator is
    // Dopl's own transport and `launch-spec.js` pumps it into that verb.
    promptModes: ['string'],
    // ⚠ `'unverified'`, AND IT REFUSES A RESUME (§5 item X4). `session-park.js › resumeParked`
    // zeroes both delta baselines on an explicit assumption; a runtime that CONTINUES the
    // cumulative total makes every delta negative, clamps it to zero, and stops the cost cap ever
    // firing — silently, until a bill arrives. ⚠ THE STAKE IS HIGHEST HERE: this is the one
    // runtime with a real billed cost, so the cap this would disable is a cap over money actually
    // charged. A COLD LAUNCH IS UNAFFECTED. `launch-spec.js › resume` asks `capability.js ›
    // canResume` rather than restating this, so answering X4 turns both green with no code change.
    usageResetsOnResume: 'unverified',
  },

  axisB: axisB.descriptor,
  approval: approval.descriptor,

  toolMode: {
    axis: 'tools',
    // ⚠ THE RUN MODES' OWN NAMES, NARROWEST FIRST. No synthesised modes and no mode borrowed from
    // another runtime's vocabulary — there is deliberately no "Ask each time" row here, because
    // this platform cannot do it and Dopl does not fake it (design §0.1c). `tools.js › TOOL_MODES`
    // carries the argument for why `Allowlist` is narrower than `Auto-review`, which is not the
    // order the docs print them in.
    options: [
      { value: 'allowlist', label: 'Allowlist', description: 'Actions on your allowlist run without approval. Everything else asks.', native: true },
      { value: 'auto-review', label: 'Auto-review', description: 'Allowlisted calls run; others are sandboxed, and unsandboxed ones go to Cursor\'s classifier.', native: true },
      { value: 'run-everything', label: 'Run Everything', description: 'Every tool call runs automatically — no sandbox, no classifier. Dopl\'s own hard-deny and outbound gate still hold.', native: true },
    ],
    // ⚠ THE DEFAULT IS THE NARROWEST — a session starts asking, and a park resets it there.
    default: 'allowlist',
    windowlessFloor: tools.WINDOWLESS_FLOOR,
    allows: 'axisAAllows',
    // ⚠ A SECOND CONTAINMENT AXIS, AND ON THIS RUNTIME IT IS AN OS-LEVEL ONE (bubblewrap/seatbelt)
    // rather than a policy word. It is a genuinely separate axis from the run mode — the research
    // is explicit — so the UI renders a row here that does not exist on Claude.
    secondaryAxis: {
      key: 'sandbox',
      label: 'Sandbox',
      options: [
        { value: 'enabled', label: 'Enabled', description: 'Blocks writes outside the workspace, privileged operations, and network except by allowlist.' },
        { value: 'disabled', label: 'Disabled', description: 'No OS-level restriction. Dopl\'s deny list still applies.' },
      ],
      default: 'enabled',
    },
    // ⚠ NULL IN v1, AND THE DESIGN ASKS FOR THIS CONTROL — so the refusal is argued rather than
    // assumed. §3.1 wants two textareas for the classifier's `allow_instructions` /
    // `block_instructions` and requires `freeform.transport` to be SHOWN, because the documented
    // home is `permissions.json` — a file the operator and Cursor itself also own. §5 item X9 asks
    // where those keys are really written and whether Cursor re-reads the file mid-session, and
    // NEITHER is settled. This adapter's standing rule, inherited from `mcp.js › registerMcp`, is
    // that it writes nothing into a file the operator also owns until the route is verified: a
    // side effect that outlives the session is one they would have to find and undo by hand. So
    // the control is HIDDEN rather than rendered-and-inert — two textareas whose contents reach
    // nothing would be the control that lies, which is the one thing decision (1) forbids
    // outright. X9 is what flips it. ⚠ THIS SAID THE DIVERGENCE WAS "recorded in
    // docs/REFACTOR-FINDINGS.md" AND IT WAS NOT — nothing there mentioned it until 2026-08-31,
    // when F-394 was written to make the sentence true. A comment claiming a thing is FILED reads
    // as "someone weighed this and it has an owner", which is strictly more load-bearing than
    // "check this", so the false direction was the costly one. It is F-394 now, and the design
    // carries a dated §1.4 amendment for this cell beside the three step 8 already amended.
    freeform: null,
    // ⚠ EMPTY, AND FOR A STRUCTURAL REASON RATHER THAN AN UNMEASURED ONE. `session-grant-keys.js`
    // scopes an edit grant to the RESOLVED DIRECTORY of a path field — but a file write on this
    // runtime is a CURSOR built-in, which never reaches Dopl's gate at all (see `approval.js`), so
    // there is no edit call here to key a grant for. `[]` says "no members"; on the other native
    // runtime the same value means "we cannot read the path field yet", which is a different
    // reason for the same answer and is why both are written down.
    editScopedTools: [],
    // ⚠ THE AXIS-A TAXONOMY, AS DECLARED DATA — the same knowledge `axisAAllows` answers with, in
    // the form a suite can pin and a UI could render. A gate decision asks the METHOD, never a
    // membership test against these, because only the runtime knows how its modes compose them.
    taxonomy: {
      auto: tools.AUTO_REVIEW_TOOLS.slice(),
      bypass: tools.RUN_EVERYTHING_TOOLS.slice(),
      // ⚠ THREE EMPTY LISTS, AND THE REASON IS THE SAME ONE EACH TIME: what reaches Dopl's gate on
      // this runtime is only DOPL'S OWN SURFACE. Cursor's edits, shells and web fetches are real
      // and are supervised by Cursor, so there is no name in any of them Dopl is ever asked about.
      // `[]` says "no members"; `null` would say "no such concept", which would be false.
      bypassReads: [],
      edits: [],
      escalation: [],
    },
  },

  containment: {
    // ⚠ `native` AND STILL A DENY LIST. A sandbox bounds the FILESYSTEM and the network; it does
    // not deny delegation or persistence. `tools.js`'s header carries the derivation, including
    // the two harm groups this research cannot ground (§5 items X11/X12).
    mode: 'native',
    nativeControls: ['sandboxOptions', 'permissions'],
    profiles: {
      read_only: profileEntry('read_only'),
      dopl_only: profileEntry('dopl_only'),
      full: profileEntry('full'),
    },
  },

  models: models.descriptor,

  meter: {
    // ⚠ per-turn: `run.usage` is live and `result.usage` cumulative, and the honest context reading
    // rides the turn's end. Dopl accumulates, which is the same discipline the never-trust-a-
    // cumulative-total rule already runs under everywhere.
    mode: 'per-turn',
    // ⚠ A LIST HERE, WHERE THE OTHER NATIVE RUNTIME HAS `null`, AND THE DIFFERENCE IS A
    // MEASUREMENT. `cursor-research.md` NAMES the `TokenUsage` fields; the other research names
    // only that the payload is tokens. A list is a claim to have read the shape, so it is written
    // only where the shape was really read.
    fields: ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'reasoningTokens'],
    // ⚠ NULL, AND THE DESIGN'S §1.4 TABLE SAYS `'hook'` — a correction, not an oversight. The
    // honest source of a context DENOMINATOR here is the `preCompact` hook's `context_window_size`,
    // and §7 ships NO hooks on this runtime: `.cursor/hooks.json` is a shared file, hooks fail open
    // unless every event sets `failClosed`, and decision (1) removed the hook-shim design from
    // scope. A `windowSource` naming a hook this adapter does not install would be declaring a
    // measurement nobody takes — the "declared but not applied" failure. So there is no
    // denominator: `session-model.js › contextWindowFor` answers `null` for an unknown window and
    // the meter shows tokens without a percentage, which is the null-never-zero rule doing its job.
    windowSource: null,
    // ⚠ A REAL BILLED COST, AND THIS IS THE ONLY RUNTIME THAT REPORTS ONE. `agent.getUsage()` ->
    // `{rawCostCents, chargedCents}`. `billed: true` is what gives this runtime a cost line the
    // others never show. ⚠ IT IS A CALL, NOT A STREAM EVENT, which is why `launch-spec.js` mints
    // the `dopl/turnCompleted` frame — a normalizer that only read the stream would report
    // `costUsd: null` on a platform that DOES emit a cost, and the cap would silently never fire.
    cost: { currency: 'usd', billed: true },
  },

  mcp: mcp.descriptor,

  // ⚠ `'unverified'` (§5 item X7), AND IT IS NOT COSMETIC: it changes what the MCP server TEACHES.
  // `packages/mcp-server` teaches arm-and-re-arm only where a long-pending call really is
  // backgrounded and delivered as a wake, and says plainly that there is no wake where it is not.
  // ⚠ AND THE QUESTION HAS A DIFFERENT SHAPE HERE THAN ANYWHERE ELSE, because the pending call is
  // OURS: `axis-b.js › execute` is the thing that would be left hanging for ~215s. So this asks
  // whether THIS RUNTIME backgrounds a long-running `customTools` promise, which is a question
  // about the SDK's own scheduler rather than about an MCP host's. `thresholdMs` is null rather
  // than another runtime's number, because a budget sized against an unmeasured behaviour is a
  // number nobody measured.
  wake: { backgroundsPendingCall: 'unverified', thresholdMs: null },

  credential: credential.descriptor,

  // ⚠ NULL IN v1 — AND THIS IS THE ONE CELL WHERE THIS ADAPTER CONTRADICTS THE DESIGN'S §1.4
  // TABLE, WHICH PREDICTS `cursor://…/prompt` WITH AN 8,000 CEILING. It is recorded as a finding
  // rather than resolved by conformity, and the argument is the SAME FOUR-PART ONE the 2026-08-31
  // amendment applied to the other native runtime — every part of which holds here:
  //   ① the scheme is documented (`cursor://anysphere.cursor-deeplink/{prompt|command|rule}`);
  //   ② IT DOES NOT AUTO-SEND — the research says "nothing executes automatically; the user
  //      reviews and confirms", so it is strictly a PREFILL and not a launch;
  //   ③ there is no documented deep link that opens an EXISTING session by id, which is the rung
  //      a handoff would actually need;
  //   ④ ⚠ THE CEILING IS UNBISECTED. 8,000 is a number the docs PRINT, and §5 item X5 asks the two
  //      things that make a ceiling usable — is it on `text` or on the whole URL, and does it
  //      TRUNCATE or DROP — and neither is answered. The standing invariant is MEASURE THE BUILT
  //      OUTPUT AND ASSUME SILENT DROP OR TRUNCATION (the 1.7.21 bruise, where a scheme silently
  //      dropped >4096 chars and still reported success), and `cursor-research.md` says the same
  //      rule applies here. A `ceiling` with a null `ceilingScope` and a null `onOverflow` cannot
  //      be enforced or failed safely, so it is not a ceiling.
  // And the design's §7 ships NO deep-link rung for ANY platform in v1 regardless. A non-null
  // declaration would render an "Open in Cursor" button §7 says does not ship — the declared-but-
  // not-applied shape. ⚠ There is a security edge too: Proofpoint's "CursorJack" write-up is
  // specifically about weaponising this scheme, so a prefill whose truncation behaviour is
  // unmeasured is the one link shape that should be measured before it is built, not after.
  // §5 X5 is what flips it.
  deepLink: null,

  ambientFences: {
    // ⚠ EMPTY, AND IT IS A STRUCTURAL FACT ABOUT AN IN-PROCESS RUNTIME RATHER THAN AN OMISSION.
    // There is no child process to hand a scrubbed environment to — the SDK runs IN THIS PROCESS
    // and reads `process.env` directly — so a scrub would mean mutating the app's own environment,
    // which is a global side effect on Dopl and not a fence on one session. The research names no
    // permission-affecting environment variable for this runtime; §5 item X20 asks, and a POSITIVE
    // answer there is a real problem on this runtime rather than a line to add here.
    envDeny: [],
    // ⚠ ALSO EMPTY, AND THIS ONE IS THE REAL GAP. The other native runtime has
    // `--ignore-user-config`, which skips the operator's own config entirely. Nothing in
    // `cursor-research.md` gives this runtime an equivalent, and it reads permission strings from
    // `~/.cursor/cli-config.json`, `<project>/.cursor/cli.json`, a team dashboard and four hook
    // tiers (enterprise > team > project > user). What stands in for the flag is that DENY BEATS
    // ALLOW: an operator's `permissions.allow` cannot open something this launch denied. That
    // covers widening and does NOT reach the hook tiers. §5 item X13.
    configFlags: [],
  },

  prose: {
    // ⚠ NULL => THE "load it with ToolSearch" SENTENCE IS OMITTED, NEVER TRANSLATED into a verb
    // that does not exist. Nothing in the research says this runtime defers MCP tools at all — and
    // Dopl's own tools are in-process here, so there is nothing to defer.
    toolSearchVerb: null,
    // ⚠ `'unverified'`, matching `wake.backgroundsPendingCall`. The guidance an agent is given
    // about awaiting is a claim about what the HOST does with a long-pending call, and this one is
    // unmeasured.
    awaitGuidance: 'unverified',
    entryFile: '.cursorrules',
  },

  // ⚠ THE SEAM, DELIBERATELY OPEN AND DELIBERATELY EMPTY. Cloud/remote execution is out of scope
  // (decision 6), but `remoteCapable` is TRUE here: the Cloud Agents REST API, a VM per agent, SSE
  // streaming and artifacts are all documented. Adding `'cloud'` to `locations` later is a
  // descriptor change plus a location picker, not a re-architecture. Length 1 renders no picker.
  execution: { locations: ['local'], remoteCapable: true },

  // ⚠ NULL — this runtime does not run wake tier 3. `triage.js` carries the whole argument: two of
  // the four fences have no documented analogue here (§5 item X6), and one of them is weaker on
  // this runtime than anywhere because an over-running triage call could not be stopped (X0).
  triage: triage.descriptor,
  packaging,
};

// ── THE RUNTIME ──────────────────────────────────────────────────────────────────────────────

const runtime = {
  // ⚠ THE ID, ON THE BEHAVIOUR HALF TOO. Core stamps it onto a session at spawn so every later
  // gate decision, floor and tool lookup resolves the SAME runtime the session started on.
  id: 'cursor',

  /**
   * ⚠ THE MODULE PROBE, AND ON THIS RUNTIME IT IS A REAL QUESTION. `packaging.delivery` is `path`,
   * so `@cursor/sdk` is resolved from the operator's environment and may simply not be there. This
   * answers only "can this build load the Cursor SDK" — not whether `cursor-agent` is installed
   * (a diagnostic, `client.js › probeBinary`), and not whether this Mac is signed in (that is
   * `credentialState`). Collapsing those three is how a machine with a perfectly good install came
   * to be told channel requests could not be answered.
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
  // ⚠ THE ONE ADAPTER THAT ANSWERS SOMETHING HERE. It takes the engine's REQUEST object rather
  // than a bare session — one argument either way, so the contract's arity is unchanged — because
  // an in-process tool PAINTS a consent card and RESOLVES one, and needs the same two injected
  // handles `buildLaunchSpec` takes for the same reason. It answers a PROMISE, because the tool
  // surface is the Dopl server's own and is read from it rather than restated here.
  axisBTools(request) { return axisB.axisBTools(request); },

  toolConfigFor(profile) { return tools.buildSessionToolConfig(profile); },
  axisAAllows(mode, toolName) { return tools.axisAAllows(mode, toolName); },

  models() { return models.models(); },
  registerMcp(cfg) { return mcp.registerMcp(cfg); },
  probeMcp() { return mcp.probeMcp(); },
  credentialState() { return credential.credentialState(); },
  signIn() { return credential.signIn(); },
  triageSpec(request) { return triage.triageSpec(request); },
};

module.exports = { descriptor, runtime };
