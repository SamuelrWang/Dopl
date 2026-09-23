// THE CODEX ADAPTER'S TOOL VOCABULARY — Axis A's tail, and the per-profile containment table.
//
// ⚠ EVERY NAME IN THIS FILE IS ONE `codex-research.md` WRITES DOWN. Nothing is translated from
// Claude's vocabulary and nothing is invented. The four Axis-A modes are `approval_policy`'s own
// values (§2); the two item names are the app-server's own approval-request items
// (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, §1); the five
// category names are `granular`'s own (§2). Inventing a category name inside the descriptor whose
// entire purpose is to enforce NATIVE vocabulary is the exact failure decision (1) exists to
// prevent, and revision 1 of the design made it once already.
//
// ⚠ WHY A DENY LIST EXISTS AT ALL ON A RUNTIME WITH A NATIVE SANDBOX (design §0.1a). It is
// tempting to say Codex has `sandbox_mode`, therefore `read_only` / `dopl_only` are "declared, not
// enumerated". That is right for `full` and WRONG for the other two: `session-profiles.js ›
// grantDecision` step 1 reads `cfg.disallowedTools` as THE GATE'S OWN FIRST CHECK — the one
// verdict no task grant and no widest mode can open. A sandbox bounds the FILESYSTEM; it does not
// deny a delegation, an exfil channel or a persistence hook. So a restricted profile ships BOTH:
// the native containment floor (declared in `native`) and a deny list in Codex's own words.
//
// ⚠ AND THE TWO GROUPS THE RESEARCH COULD NOT GROUND WERE MEASURED, NOT GUESSED SILENT.
// Claude's `DENIED_BUILTINS` has six harm groups. Four map onto something Codex documents:
//   local execution      -> `commandExecution` (the approval item) + `sandbox_mode`
//   filesystem writes    -> `fileChange` (the approval item) + `sandbox_mode`
//   outbound channels    -> the sandbox's network boundary (no network under read-only, and none
//                           under workspace-write by default) + `sandbox_approval`
//   capability escalation-> `sandbox_approval` / `request_permissions` / `skill_approval`
// The FIFTH — DELEGATION — has no approval item to deny, and 🔒 SINCE 2026-09-22 IT IS OFF ON
// EVERY PROFILE BY CONFIGURATION instead (§5 C25 closed, measured on codex-cli 0.155.1):
// `features.multi_agent = false` below removes it for a model with no catalog
// `multi_agent_version` (gpt-5.5), and `catalog.js`'s delegation-free model catalog removes it for
// every code-mode model, where the feature flag alone does nothing. A forced `spawn_agent` then
// answers `unsupported call` and no child thread starts. The SIXTH — PERSISTENCE/SCHEDULING — is
// 🔒 GROUNDED TOO (§5 C26 closed, 2026-09-22, codex-cli 0.155.1): every surface that makes work run
// later or state outlive the session was measured and is off on every profile by configuration —
// `PERSISTENCE_FENCE` and `NOTIFY_FENCE` below record what each did before the fence and after it.

const {
  DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY,
  DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('../../tool-profiles');
// ⚠ DOPL'S OWN SURFACE, IMPORTED AND NEVER RESTATED. `mcp__dopl__*` names are OUR server on every
// runtime; a second copy of "which dopl tool writes" is how one adapter comes to gate a read
// another allows (`main/session-dopl-tools.js`'s header).
const doplTools = require('../../session-dopl-tools');
const { canonicalDoplName } = require('../../mcp-tool-names');

const DOPL_WRITE_TOOLS = doplTools.DOPL_WRITE_TOOLS;
const DOPL_READ_TOOLS = doplTools.DOPL_READ_TOOLS;

// The dopl server registers tools bare; a per-server `enabled_tools` / `disabled_tools` list uses
// the bare server-local name (`codex-research.md` §3, MCP row).
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// ── CODEX'S OWN ACTION VOCABULARY ────────────────────────────────────────────────────────────
//
// ⚠ THESE ARE THE NAMES A GATE DECISION IS ASKED ABOUT ON THIS RUNTIME, and they are the
// app-server's, not ours. Codex does not gate NAMED BUILT-IN TOOLS the way Claude does — there is
// no "approve Read but not Grep" — it gates CATEGORIES OF ACTION, and the categories arrive as
// typed approval requests. `approval.js › toolNameFor` is the one place a request becomes one of
// these words, so the gate, the deny lists and the Axis-A lists all speak the same three-word
// vocabulary and cannot drift.
const COMMAND_ITEM = 'commandExecution'; // item/commandExecution/requestApproval — the shell
const FILE_ITEM = 'fileChange'; //          item/fileChange/requestApproval    — a write

// `approval_policy = { granular = { … } }`'s five selective-approval categories, verbatim.
// ⚠ RENDERED AS A SUB-CONTROL UNDER THE `granular` MODE (design §3.1) AND USED HERE AS NAMES A
// VERDICT CAN BE ASKED ABOUT. `rules` and `mcp_elicitations` are deliberately in NEITHER an
// Axis-A allow-list nor a restricted profile's deny list: the research names them and does not
// say what they cover, and an unclassified name GATES in every mode — the fail-closed answer.
const GRANULAR_CATEGORIES = [
  'sandbox_approval', 'rules', 'mcp_elicitations', 'request_permissions', 'skill_approval',
];

// Escalation-shaped: reaches the SHELL or escapes the sandbox (and with it the network boundary).
// ⚠ THE TWIN OF CLAUDE'S `ESCALATION_TOOLS`, DERIVED THE SAME WAY: the counterparty's message text
// steers what the agent proposes, so the widest mode covers these and nothing narrower does.
// `request_permissions` and `skill_approval` are NOT here — they are capability escalation, whose
// Claude analogues (`Skill`, `ToolSearch`, `EnterWorktree`) are in NO Axis-A list and therefore
// gate in EVERY mode, the widest included. That asymmetry is deliberate on both runtimes.
const ESCALATION_ITEMS = [COMMAND_ITEM, 'sandbox_approval'];

// The write half. ⚠ `editScopedTools` is EMPTY rather than this list — see the descriptor note in
// `index.js`: `session-grant-keys.js` scopes an edit grant to the RESOLVED DIRECTORY of a path
// field, and which field of a `fileChange` approval payload carries that path is §5 item C2,
// uncaptured. An unknown field means the key falls back to a digest of the WHOLE input, which is
// strictly NARROWER than a directory scope — the safe direction, taken deliberately.
const EDIT_ITEMS = [FILE_ITEM];

// ── AXIS A: `approval_policy`, IN CODEX'S OWN WORDS ──────────────────────────────────────────
//
// ⚠ NARROWEST FIRST, AND THE ORDER IS READ BY CORE (`main/runtime/capability.js`). `[0]` is where
// every unknown value fail-closes and the LAST entry is the widest, which is how the windowless
// floor stays widen-only. `on-failure` is absent because `codex-research.md` §2 documents it as
// DEPRECATED ("Still parsed… Don't surface it"), not because it was forgotten.
//
// ⚠ WHERE `granular` SITS, AND WHY IT IS NOT LAST. The design's §1.4 table writes the four values
// as "untrusted / on-request / never / granular", which is a LIST, not an ordering of
// permissiveness — and this array IS an ordering. Putting `granular` last would make it the
// WIDEST mode, which `floorWindowlessTool` never narrows: a granular session configured tightly
// would then be immune to a floor it should be raised by, and the widest-mode question
// (`isClassifiedTool`) would be asked of a mode whose reach nobody can compute. It sits at index 1
// because that is the only placement that is honest about what Dopl can know: its five categories
// are configured ON CODEX'S SIDE and this process cannot read them, so Dopl's own gate treats it
// as no wider than `untrusted` and lets the floor raise it like any narrow mode.
const TOOL_MODES = ['untrusted', 'granular', 'on-request', 'never'];

// ⚠ POSITIVE ALLOW-LISTS, NEVER NEGATIVE — the same rule the Claude adapter states and for the
// same reason: a negative mode auto-allows every UNRECOGNISED name ('', null, a category a future
// CLI adds, a renamed channel tool), and hard-deny is a build-time blacklist that cannot cover
// them. Unknown therefore GATES IN EVERY MODE, `never` included.
//
// `untrusted` — "Approves only known-safe read operations" (§2). Dopl's read surface is what that
//   means in names this gate is asked about; Codex's own reads never raise an approval request at
//   all, so there is nothing else to list.
// `granular`  — the same set, fail-closed. See TOOL_MODES.
// `on-request`— Codex's own interactive setting, paired with `workspace-write`: reads and
//   in-workspace edits run, escalation asks. The twin of Claude's `auto`.
// `never`     — every KNOWN action, escalation included. NOT the capability-escalation
//   categories: those are in no list and gate in every mode.
const UNTRUSTED_TOOLS = DOPL_READ_TOOLS.slice();
const ON_REQUEST_TOOLS = DOPL_READ_TOOLS.concat(EDIT_ITEMS);
const NEVER_TOOLS = ON_REQUEST_TOOLS.concat(ESCALATION_ITEMS, DOPL_WRITE_TOOLS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? TOOL_MODES[0] : mode; // fail-closed to `untrusted`
}

// Does Axis A auto-allow this action? ⚠ Never sees a channel call — `grantDecision` branches a
// message op to Axis B before Axis A is consulted, on every runtime. The name is CANONICALISED
// first so a Dopl tool arriving under any server segment matches the same list (F-139's rule,
// which is the whole reason `mcp-tool-names.js` is core and not an adapter's).
function axisAAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'untrusted' || m === 'granular') return UNTRUSTED_TOOLS.indexOf(name) !== -1;
  if (m === 'on-request') return ON_REQUEST_TOOLS.indexOf(name) !== -1;
  return NEVER_TOOLS.indexOf(name) !== -1; // never
}

// ── THE PER-PROFILE CONTAINMENT TABLE ────────────────────────────────────────────────────────
//
// ⚠ `preApproved` IS EMPTY ON EVERY PROFILE, AND THAT IS NOT AN OMISSION. Claude pre-approves its
// local read built-ins because on that runtime a read WOULD otherwise raise a permission prompt.
// Codex raises no approval request for a read at all — under every policy, reads are the thing
// that does not ask — so there is no name to pre-approve, and listing one would create a SHADOW
// (a tool auto-allowed before any button appears, `session-profiles.js`'s shadow gotcha) that buys
// nothing. Absent, not `null`: `grantDecision` indexes it.
//
// ⚠ `builtinBound` IS NULL ON EVERY PROFILE. Claude's L0 layer is `options.tools`, a POSITIVE
// bound on built-in names so an unnamed tool is never offered to the model. Codex documents no
// analogue; its positive bound is the SANDBOX, declared in `native`. Null says "this runtime has
// no such control", which is a different statement from "the list is empty".
//
// ⚠ THE RESTRICTED PROFILES PIN THE SANDBOX; `full` EXPOSES IT. `read_only` and `dopl_only` are
// containment, so they pin `sandbox_mode`/`approval_policy` and the launch spec does not let the
// operator's Axis-A pick move them. `full`'s supervision IS Axis A plus the sandbox row
// (`toolMode.secondaryAxis`), so its `native` is null and the operator's choices ride.
//
// ⚠ ONE HONEST NARROWING, RECORDED RATHER THAN HIDDEN: `dopl_only` reaches the WEB on Claude
// (`WEB_TOOLS` are granted there) and CANNOT on Codex. Network on this runtime is a property of
// the sandbox, not a named tool — `read-only` has none and `workspace-write` has none by default —
// and the escalation that would open it (`sandbox_approval`) is on this profile's deny list. So
// `dopl_only` is strictly narrower here than there. That is a capability difference to SHOW, not
// to close by widening the sandbox: the profile's whole point is "look things up with no shell",
// and on Codex the Dopl archive is the only lookup surface it gets.
// 🔒 THE THREAD `features` FENCE (CXP-3A, MEASURED 2026-09-22 on codex-cli 0.155.1). With the
// operator's ChatGPT auth linked, every thread mounts `codex_apps` — a FOREIGN MCP server whose
// tools (Sites, document control, …) sit behind the same `tool_search` Dopl now orders — and the
// multi-agent (delegation) tools ride that search too. `thread/start.config.features.apps = false`
// removes the apps source (and `request_plugin_install`); `multi_agent = false` removes delegation.
// ⚠ APPS OFF ON EVERY PROFILE: the twin of Claude's `ENABLE_CLAUDEAI_MCP_SERVERS=0`, which is set
// unconditionally too — an account connector is ambient authority no profile granted.
// 🔒 ⚠ DELEGATION OFF ON EVERY PROFILE TOO (2026-09-22), matching Claude, which removes `Agent` on
// ALL profiles (`runtime/claude/tools.js › FULL_BUILTIN_BOUND`): on Dopl an agent delegates by
// launching a visible Dopl agent (`dopl_channel(op="manage", action="launch")`), never a hidden
// sub-session that does not inherit the bound. ⚠ THIS FLAG IS HALF THE FENCE: it is what gpt-5.5
// obeys. A `code_mode_only` model keeps its `collaboration` namespace whatever `[features]` say —
// its catalog `multi_agent_version` wins — so `catalog.js` fences those, on every launch.
const ACCOUNT_FENCE = Object.freeze({ apps: false, plugins: false, multi_agent: false });

// 🔒 ⚠ THE PERSISTENCE / SCHEDULING FENCE (§5 C26, MEASURED 2026-09-22 on codex-cli 0.155.1 with
// a scripted model — `test/codex-persistence-fence-live.test.mjs`). The twin of Claude's
// `CronCreate` / `ScheduleWakeup` / `Monitor` removal: on Dopl, later work is a VISIBLE Dopl agent
// (`dopl_channel(op="manage", action="launch")`) and waiting is a hold on `dopl_channel`
// `read(wait_ms)` — never a runtime's own timer, goal loop or memory. Off on EVERY profile:
//   goals       `get_goal`/`create_goal`/`update_goal` were OFFERED on every profile (top-level on
//               gpt-5.5, in `ALL_TOOLS` on code-mode). ONE forced `create_goal` made the app-server
//               start ~500 turns by itself in 8s ("Continue working toward the active thread
//               goal"), none prompted by Dopl, the goal stored in `goals_1.sqlite` in the SHARED
//               private home. Off: tools absent on both paths, a forced call is `unsupported call`.
//   sleep_tool  `clock.sleep` (1ms..12h) on every code-mode model — a timed wake inside a turn.
//               Off: namespace absent, a forced call is `unsupported call: clocksleep`.
//   memories    OFF BY DEFAULT today and pinned here because a default flip would be a leak: ON,
//               Codex ran a hidden "Memory Writing Agent" (a second model request, on a model the
//               session did not pick) with a shell, writing `$CODEX_HOME/memories/` — the home
//               EVERY Dopl Codex session shares, so any channel's agent would read another's.
//   hooks       NOT agent-reachable: a `hooks.json` planted in the private home LOADS but is
//               `untrusted` and never fired, and trust can only come from config (a `config.toml`
//               there refuses the launch; `thread/start.config` is Dopl's). Pinned anyway because
//               with trust supplied it DID fire, and off it did not — the twin of Claude's
//               `settingSources: []`. ⚠ Dopl's own `PreToolUse` stamp (§5 C18) turns this back on
//               with its own hook; that is one deliberate edit here, never a side effect.
// ⚠ AUTOMATIONS AND THE THREAD QUEUE HAVE NO AGENT VERB: no automation tool is offered, signed in
// or not, with `in_app_local_automation` on or off, and `thread/queue/*` / `thread/goal/set` /
// `memory/*` are CLIENT methods only Dopl could send (it sends none). Plugin-carried
// `scheduled_tasks` arrive by `plugin/install` behind `plugins: false` above. The shell remains a
// shell — `crontab`, `launchd`, `codex queue` — exactly as Claude's `Bash` is; that is the
// shell's own fence (`commandExecution`, the sandbox), not this one.
const PERSISTENCE_FENCE = Object.freeze({ goals: false, sleep_tool: false, memories: false, hooks: false });

// 🔒 `notify` — a program Codex runs after EVERY turn. MEASURED: it fires from the home
// `config.toml`, from `-c notify=…` on argv AND from `thread/start.config.notify`, and a thread
// `notify = []` silenced a home-layer one. No agent can write either lane Dopl owns (argv, thread
// config) and the private home refuses a `config.toml`; the empty thread value is the belt that
// also covers a layer the home fence does not reach (`/etc/codex/config.toml`).
const NOTIFY_FENCE = Object.freeze([]);

// Every profile's thread `features`: the account fence plus the persistence fence.
const FEATURE_FENCE = Object.freeze({ ...ACCOUNT_FENCE, ...PERSISTENCE_FENCE });
const RESTRICTED_FENCE = Object.freeze({ ...FEATURE_FENCE });

function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);
  // ⚠ `dopl_channel` is in NEITHER the deny list NOR the pre-approval list on ANY profile, exactly
  // as on Claude, so it REACHES the gate where `grantDecision` op-scopes it against Axis B. It
  // stays in each restricted profile's `doplToolsPolicy` as defence in depth.
  const doplSurfaceDeny = DOPL_ADMIN_TOOLS.concat(RETIRED_DOPL_TOOLS);

  if (p === 'read_only') {
    return {
      builtinTools: [],
      preApproved: [],
      // Local execution + writes + every escalation Codex names, plus the whole Dopl surface
      // except the channel tool. The twin of Claude's read_only, in Codex's vocabulary.
      disallowedTools: [COMMAND_ITEM, FILE_ITEM,
        'sandbox_approval', 'request_permissions', 'skill_approval']
        .concat(doplSurfaceDeny, DOPL_SAFE_TOOLS),
      doplToolsPolicy: [channelShort],
      native: { sandbox_mode: 'read-only', approval_policy: 'untrusted' },
      features: { ...RESTRICTED_FENCE },
    };
  }

  if (p === 'dopl_only') {
    return {
      builtinTools: [],
      preApproved: [],
      // Same floor; the non-admin Dopl surface is reachable (each still through the gate, because
      // nothing is pre-approved here — the WRITE half of it gates at every mode but `never`).
      disallowedTools: [COMMAND_ITEM, FILE_ITEM,
        'sandbox_approval', 'request_permissions', 'skill_approval']
        .concat(doplSurfaceDeny),
      doplToolsPolicy: DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort]),
      native: { sandbox_mode: 'read-only', approval_policy: 'untrusted' },
      features: { ...RESTRICTED_FENCE },
    };
  }

  // ⚠ THE FOURTH PROFILE (2026-09-02, Samuel's ruling B7) — `full`, MINUS THE SHELL, IN CODEX'S
  // OWN WORDS. Every field is `full`'s with `ESCALATION_ITEMS` added to the floor, and that list
  // is the SHELL PLUS THE ESCAPE THAT REACHES IT: `commandExecution` is local execution, and
  // `sandbox_approval` is the one documented way out of the sandbox that bounds it. Denying the
  // first without the second would be a fence with the gate beside it open — which is the same
  // reason the Claude adapter's shell group carries `BashOutput` / `KillShell` beside `Bash`.
  //
  // ⚠ IT IS DERIVED FROM A LIST THIS FILE ALREADY HAS, NOT A NEW ONE. `ESCALATION_ITEMS` is the
  // twin of Claude's `SHELL_BUILTINS` half of `ESCALATION_TOOLS`, so the two lanes narrow by the
  // same idea in two vocabularies rather than by two hand-written lists.
  //
  // ⚠ `native` STAYS NULL, LIKE `full`'S. The ruling removes the SHELL; pinning a `sandbox_mode`
  // / `approval_policy` pair here would be a second, unasked posture decision, and it would take
  // the operator's own Axis-A pick off a profile that is otherwise `full`. The deny list is the
  // fence, exactly as this file's own header argues for the restricted profiles.
  //
  // ⚠ DELEGATION AND PERSISTENCE ARE FENCED HERE AS ON EVERY PROFILE (`FEATURE_FENCE` +
  // `catalog.js` + `NOTIFY_FENCE`), so this profile differs from `full` by the shell alone.
  if (p === 'channel_agent') {
    return {
      builtinTools: [],
      preApproved: [],
      disallowedTools: UNIVERSAL_HARD_DENY.concat(ESCALATION_ITEMS),
      doplToolsPolicy: null,
      native: null,
      features: { ...FEATURE_FENCE },
    };
  }

  // full: the UNIVERSAL FLOOR and nothing else — Dopl's own admin + retired tools, openable by no
  // mode and no grant on any runtime. Everything else reaches the gate, where Axis A supervises it
  // in Codex's own mode vocabulary and the sandbox row bounds the filesystem.
  return {
    builtinTools: [],
    preApproved: [],
    disallowedTools: UNIVERSAL_HARD_DENY.slice(),
    doplToolsPolicy: null,
    native: null,
    features: { ...FEATURE_FENCE },
  };
}

// ⚠ AXIS A'S WINDOWLESS FLOOR IS DECLARED DATA ON THIS RUNTIME, NOT A TRANSFORM. Its value is
// `descriptor.toolMode.windowlessFloor` and `main/runtime/capability.js › floorWindowlessTool`
// applies it by INDEX into TOOL_MODES above. The argument is the Claude adapter's, unchanged: a
// windowless session has no gate surface, so a gated action there is a silent DENY of work the
// prompt ORDERS the agent to do; the floor widens what the PROFILE already permits and nothing
// else, because hard-deny and the profile's deny list are both checked before Axis A.
//
//     untrusted   -> on-request
//     granular    -> on-request
//     on-request  -> on-request
//     never       -> never        (NEVER NARROWED — widen-only)
const WINDOWLESS_FLOOR = 'on-request';

module.exports = {
  shortDoplName,
  buildSessionToolConfig,
  axisAAllows, normalizeToolMode,
  TOOL_MODES, GRANULAR_CATEGORIES, ESCALATION_ITEMS, EDIT_ITEMS,
  COMMAND_ITEM, FILE_ITEM, WINDOWLESS_FLOOR, ACCOUNT_FENCE, RESTRICTED_FENCE,
  PERSISTENCE_FENCE, FEATURE_FENCE, NOTIFY_FENCE,
  UNTRUSTED_TOOLS, ON_REQUEST_TOOLS, NEVER_TOOLS,
};
