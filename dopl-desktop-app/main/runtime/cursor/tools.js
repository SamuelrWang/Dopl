// THE CURSOR ADAPTER'S TOOL VOCABULARY — Axis A's tail, and the per-profile containment table.
//
// ⚠ EVERY NAME IN THIS FILE IS ONE `cursor-research.md` WRITES DOWN. The three Axis-A modes are
// the run modes' own names (§"Cursor's native permission vocabulary"); the deny entries are that
// same section's PERMISSION STRINGS — `Shell(commandBase)`, `Read(pathOrGlob)`, `Write(pathOrGlob)`,
// `WebFetch(domainOrPattern)`, `Mcp(server:tool)`, with `**`/`*`/`?` globs and DENY BEATING ALLOW.
// Nothing is translated from another runtime's vocabulary and nothing is invented.
//
// ⚠ WHAT REACHES DOPL'S GATE ON THIS RUNTIME IS ONLY DOPL'S OWN SURFACE, and that asymmetry is
// the whole shape of the adapter. This platform has NO programmatic permission callback
// (`approval.js › descriptor.heldCallback` is `false`, and hooks are file-based, which the design
// puts out of scope). So a Cursor BUILT-IN — a shell command, a file write, a web fetch — is
// supervised by CURSOR: its run mode, its classifier, its sandbox and the permission strings
// below. It never reaches `grantDecision`. What DOES reach `grantDecision` is every Dopl tool,
// because on this runtime those are `local.customTools` this process IMPLEMENTS (`axis-b.js`).
// Two consequences, both deliberate and both written here rather than discovered later:
//   1. `taxonomy.edits` / `taxonomy.escalation` / `taxonomy.bypassReads` are EMPTY. `[]` says
//      "no members", which is true; `null` would say "no such concept", which is not — Cursor has
//      edits and escalations, they are simply not names Dopl's gate is ever asked about.
//   2. The permission strings in `disallowedTools` are INERT AT THE GATE and LOAD-BEARING AT
//      LAUNCH. `grantDecision` step 1 will never match `Shell(*)` against a tool name, because no
//      call arrives under that name; the string does its work as a `deny` entry on the launch
//      (`launch-spec.js`), where deny beats allow. Both halves are in ONE list on purpose, so a
//      profile's containment cannot be half-declared.
//
// ⚠ AND THE HALF THIS RESEARCH CANNOT GROUND IS ON THE SMOKE CHECKLIST, NOT GUESSED SILENT.
// Claude's `DENIED_BUILTINS` has five harm groups. Three map cleanly onto something Cursor
// documents:
//   local execution      -> `Shell(*)` + `sandboxOptions.enabled`
//   filesystem writes    -> `Write(**)` + the sandbox's write boundary
//   outbound channels    -> `WebFetch(*)` (and the sandbox's network boundary, allowlist-only)
// The other two do NOT, and each is a live question rather than a covered group:
//   DELEGATION       Cursor's subagents are DECLARED BY THE CLIENT (`agents: {…}` on
//                    `Agent.create()`), so declaring none is a plausible deny — and it is not a
//                    PROVEN one, because nothing in the research says a model cannot reach a
//                    delegation tool that was never declared. `launch-spec.js` declares none;
//                    §5 item X11 is what turns "plausible" into "proven".
//   PERSISTENCE/SCHEDULING  Automations (cron, webhooks) are a CLOUD/dashboard surface with no
//                    documented agent-invocable verb and no documented deny. `Shell(*)` covers
//                    the local half (`launchd`, `cron`); the cloud half is §5 item X12.
// ⚠ SO A CURSOR SESSION AT `read_only` OR `dopl_only` IS NOT PROVEN UNABLE TO DELEGATE, exactly
// as on the other native-containment runtime. It is Samuel's §8 open question 2 in concrete form
// and it is recorded, not papered over.

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

/** The bare, server-local name. Our server registers tools bare; only a host adds a prefix. */
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// ── CURSOR'S OWN PERMISSION STRINGS ──────────────────────────────────────────────────────────
//
// ⚠ THE WIDEST GLOB EACH CLASS TAKES, because a deny list is a FLOOR and a narrow deny is a hole.
// `Shell(commandBase)` matches a command base and takes argument-level globs (`curl:*`), so `*`
// is the whole class; `Read`/`Write` take path globs, where `**` is every path.
const SHELL_ANY = 'Shell(*)';
const WRITE_ANY = 'Write(**)';
const WEB_ANY = 'WebFetch(*)';
// ⚠ `Mcp(server:tool)` DENIED WHOLESALE ON THE RESTRICTED PROFILES, and it is not redundant with
// registering no servers: this runtime reads MCP entries from the operator's own
// `~/.cursor/mcp.json` and from a team dashboard as well as from the inline registration, and
// there is no documented per-launch flag that skips those files (§5 item X13). The deny is what
// makes "no third-party MCP surface" true rather than intended. ⚠ It does NOT touch Dopl's own
// tools, which are `customTools` on this runtime and are not an MCP server the model can name.
const MCP_ANY = 'Mcp(*)';

// The credential paths every profile fences, in this runtime's own string form. ⚠ The twin of the
// other runtime's secret-path rules and it exists for the same reason: a tool the platform
// auto-runs never reaches Dopl's gate, so only a launch-time deny can fence it. Path tools only —
// a `Shell(<path>)` entry would match a COMMAND BASE and deny nothing while reading as coverage.
const SECRET_TOOLS = ['Read', 'Write'];
const SECRET_PATHS = ['**/.cursor/**', '**/.codex/**', '**/.claude*/**'];

function buildSecretPathDenyRules(userDataDir) {
  const paths = SECRET_PATHS.slice();
  const dir = typeof userDataDir === 'string' ? userDataDir.trim() : '';
  if (dir) paths.unshift(dir.replace(/\/+$/, '') + '/**');
  const rules = [];
  for (const tool of SECRET_TOOLS) {
    for (const p of paths) rules.push(`${tool}(${p})`);
  }
  return rules;
}

// ── AXIS A: THE RUN MODES, IN CURSOR'S OWN WORDS ─────────────────────────────────────────────
//
// ⚠ NARROWEST FIRST, AND THE ORDER IS READ BY CORE (`main/runtime/capability.js`). `[0]` is where
// every unknown value fail-closes and the LAST entry is the widest, which is how the windowless
// floor stays widen-only.
//
// ⚠ WHY `allowlist` IS NARROWER THAN `auto-review`, WHICH IS NOT THE ORDER THE DOCS PRINT THEM IN.
// Read what each one does with a call that is NOT on the allowlist: under **Allowlist** it ASKS;
// under **Auto-review** it is sandboxed where possible and otherwise goes to a CLASSIFIER that may
// ALLOW it. A mode that can auto-allow an unlisted call is wider than one that always asks, so
// `allowlist` is index 0. Getting this backwards would make the windowless floor NARROW a session
// (the floor is widen-only by index) — the same defect the Codex adapter's `granular` placement
// note records.
//
// ⚠ AND `auto-review` ALLOWS NOTHING MORE THAN `allowlist` DOES IN DOPL'S OWN GATE. Its extra
// reach is CURSOR'S: a classifier reviewing CURSOR'S built-ins, which never reach `grantDecision`.
// Dopl cannot read what that classifier decided, so Dopl's gate must not assume it decided
// anything — the fail-closed reading, and the same argument the other native runtime's `granular`
// mode is placed on. What picking `auto-review` changes is what CURSOR runs without asking.
const TOOL_MODES = ['allowlist', 'auto-review', 'run-everything'];

// The CLI spelling of the widest mode, kept beside the mode it belongs to rather than in the
// launch spec: `-f, --force` (alias `--yolo`). ⚠ Dopl's widest mode is NOT this flag — hard-deny
// and the outbound gate survive every mode, which is why the launch maps modes to a run-mode
// setting rather than to a bypass switch.
const RUN_EVERYTHING_FLAG = '--force';

// ⚠ POSITIVE ALLOW-LISTS, NEVER NEGATIVE — the same rule both other adapters state and for the
// same reason: a negative mode auto-allows every UNRECOGNISED name ('', null, a renamed channel
// tool, a Dopl tool a later server ships), and hard-deny is a build-time blacklist that cannot
// cover them. Unknown therefore GATES IN EVERY MODE, `run-everything` included.
const ALLOWLIST_TOOLS = DOPL_READ_TOOLS.slice();
const AUTO_REVIEW_TOOLS = DOPL_READ_TOOLS.slice(); // see TOOL_MODES: no wider in DOPL's gate
const RUN_EVERYTHING_TOOLS = DOPL_READ_TOOLS.concat(DOPL_WRITE_TOOLS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? TOOL_MODES[0] : mode; // fail-closed to `allowlist`
}

// Does Axis A auto-allow this call? ⚠ Never sees a channel call — `grantDecision` branches a
// message op to Axis B before Axis A is consulted, on every runtime. The name is CANONICALISED
// first so a Dopl tool arriving under any host prefix matches the same list (F-139's rule).
function axisAAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'run-everything') return RUN_EVERYTHING_TOOLS.indexOf(name) !== -1;
  if (m === 'auto-review') return AUTO_REVIEW_TOOLS.indexOf(name) !== -1;
  return ALLOWLIST_TOOLS.indexOf(name) !== -1; // allowlist — Dopl's reads and nothing else
}

// ── THE PER-PROFILE CONTAINMENT TABLE ────────────────────────────────────────────────────────
//
// ⚠ `preApproved` IS EMPTY ON EVERY PROFILE, AND THAT IS NOT AN OMISSION. Claude pre-approves its
// local read built-ins because on that runtime a read would otherwise raise a permission prompt.
// Here a Cursor built-in never reaches Dopl's gate at all, so there is nothing to pre-approve; and
// the one surface that DOES reach it — Dopl's own tools, implemented in-process — must never be
// pre-approved, because a pre-approval list is a SHADOW and the channel op is the call that has to
// gate (`main/runtime/claude/axis-b.js`'s header, and design §6's last invariant).
//
// ⚠ `builtinBound` IS NULL ON EVERY PROFILE. Claude's L0 layer is `options.tools`, a POSITIVE
// bound on built-in names. This runtime documents `tools: [...]` as an allowlist too, but in what
// vocabulary its entries are read — bare tool names, or the permission strings above — is NOT
// settled by the research (§5 item X14), and a positive bound written in the wrong vocabulary is a
// bound that silently offers everything. So the positive bound is declared absent and the fence is
// the DENY plus the sandbox, both of which fail closed if the vocabulary turns out to be the other
// one. Null says "this runtime has no such control we can honestly drive"; `[]` would say "no
// members", which on a positive bound means the opposite of what it looks like.
//
// ⚠ THE RESTRICTED PROFILES PIN THE SANDBOX AND THE RUN MODE; `full` EXPOSES BOTH. `read_only`
// and `dopl_only` are containment, so they pin `sandboxOptions.enabled` and the run mode and the
// operator's Axis-A pick does not move them. `full`'s supervision IS Axis A plus the sandbox row
// (`toolMode.secondaryAxis`), so its `native` is null and the operator's choices ride.
//
// ⚠ `dopl_only` KEEPS THE WEB HERE, unlike on the other native runtime. Network on Codex is a
// property of the sandbox with no named tool, so its `dopl_only` lost web reads; Cursor has
// `WebFetch(domainOrPattern)` as a first-class permission string, so the profile's documented
// posture — "look things up, with no shell" — ports intact. Recorded because it is the one place
// the two native-containment adapters differ on what a profile MEANS.
// ⚠ THE CREDENTIAL-PATH RULES ARE NOT IN THIS TABLE, AND THAT IS THE OTHER LANES' PRECEDENT
// RATHER THAN AN OMISSION. `buildSecretPathDenyRules` reads the app's own userData directory,
// which a plain-Node harness cannot answer — so a profile entry built at MODULE LOAD (the
// descriptor) and one built at LAUNCH would carry different lists, and the descriptor would be
// describing containment the gate does not apply. `runtime/claude/launch-spec.js` concatenates
// them onto `disallowedTools` at assembly time for exactly this reason; so does ours.
function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);
  // ⚠ `dopl_channel` is in NEITHER the deny list NOR the pre-approval list on ANY profile, exactly
  // as on both other runtimes, so it REACHES the gate where `grantDecision` op-scopes it against
  // Axis B. It stays in each restricted profile's `doplToolsPolicy` as defence in depth — and on
  // THIS runtime that policy is not advisory: it is the list of `customTools` we register at all.
  const doplSurfaceDeny = DOPL_ADMIN_TOOLS.concat(RETIRED_DOPL_TOOLS);

  if (p === 'read_only') {
    return {
      builtinTools: [],
      preApproved: [],
      // Local execution + writes + the web + third-party MCP, plus the whole Dopl surface except
      // the channel tool. The twin of Claude's read_only, in Cursor's vocabulary.
      disallowedTools: [SHELL_ANY, WRITE_ANY, WEB_ANY, MCP_ANY]
        .concat(doplSurfaceDeny, DOPL_SAFE_TOOLS),
      doplToolsPolicy: [channelShort],
      native: { runMode: 'allowlist', sandbox: true },
    };
  }

  if (p === 'dopl_only') {
    return {
      builtinTools: [],
      preApproved: [],
      // Same floor minus the web: this profile's whole point is looking things up with no shell.
      disallowedTools: [SHELL_ANY, WRITE_ANY, MCP_ANY]
        .concat(doplSurfaceDeny),
      doplToolsPolicy: DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort]),
      native: { runMode: 'allowlist', sandbox: true },
    };
  }

  // full: the UNIVERSAL FLOOR plus the credential-path fence, and nothing else. Everything else
  // reaches either Cursor's own supervision (its built-ins) or Dopl's gate (Dopl's tools).
  return {
    builtinTools: [],
    preApproved: [],
    disallowedTools: UNIVERSAL_HARD_DENY.slice(),
    doplToolsPolicy: null,
    native: null,
  };
}

// ⚠ AXIS A'S WINDOWLESS FLOOR IS DECLARED DATA ON THIS RUNTIME, NOT A TRANSFORM. Its value is
// `descriptor.toolMode.windowlessFloor` and `main/runtime/capability.js › floorWindowlessTool`
// applies it by INDEX into TOOL_MODES above. The argument is the other adapters', unchanged: a
// windowless session has no gate surface, so a gated call there is a silent DENY of work the
// prompt ORDERS the agent to do; the floor widens what the PROFILE already permits and nothing
// else, because hard-deny and the profile's deny list are both checked before Axis A.
//
//     allowlist       -> auto-review
//     auto-review     -> auto-review
//     run-everything  -> run-everything   (NEVER NARROWED — widen-only)
const WINDOWLESS_FLOOR = 'auto-review';

module.exports = {
  shortDoplName,
  buildSessionToolConfig, buildSecretPathDenyRules,
  axisAAllows, normalizeToolMode,
  TOOL_MODES, WINDOWLESS_FLOOR, RUN_EVERYTHING_FLAG,
  ALLOWLIST_TOOLS, AUTO_REVIEW_TOOLS, RUN_EVERYTHING_TOOLS,
  SHELL_ANY, WRITE_ANY, WEB_ANY, MCP_ANY, SECRET_TOOLS, SECRET_PATHS,
};
