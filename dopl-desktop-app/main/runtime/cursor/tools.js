// THE CURSOR ADAPTER'S TOOL VOCABULARY — Axis A's tail, and the per-profile containment table.
//
// ⚠ EVERY NAME HERE IS ONE `cursor-research.md` WRITES DOWN: the run modes' own names, and the
// permission strings `Shell(commandBase)`, `Read(pathOrGlob)`, `Write(pathOrGlob)`,
// `WebFetch(domainOrPattern)`, `Mcp(server:tool)` (globs `**`/`*`/`?`, DENY BEATS ALLOW).
//
// ⚠ ONLY DOPL'S OWN SURFACE REACHES DOPL'S GATE. With no permission callback (`approval.js`), a
// Cursor built-in is supervised by CURSOR (run mode, classifier, sandbox, the strings below) and
// never reaches `grantDecision`; every Dopl tool does (`axis-b.js`). Consequences:
//   1. `taxonomy.edits` / `.escalation` / `.bypassReads` are `[]` ("no members"), not `null`.
//   2. The permission strings in `disallowedTools` are INERT AT THE GATE (no call arrives under
//      `Shell(*)`) and LOAD-BEARING AT LAUNCH as deny entries (`launch-spec.js`). One list, so a
//      profile's containment cannot be half-declared.
//
// ⚠ HARM GROUPS (Claude's `DENIED_BUILTINS`): local execution -> `Shell(*)` + sandbox; filesystem
// writes -> `Write(**)` + sandbox; outbound -> `WebFetch(*)` + sandbox network allowlist. NOT
// grounded: DELEGATION (subagents are client-declared; `launch-spec.js` declares none — plausible,
// not proven, §5 item X11) and PERSISTENCE (cloud Automations have no documented deny; `Shell(*)`
// covers local cron/launchd; §5 item X12). So `read_only` / `dopl_only` are NOT proven unable to
// delegate (Samuel's §8 open question 2).
//
// ── ⚠ FROZEN AT THREE PROFILES (2026-09-02, ruling X0) ───────────────────────────────────────
// The other adapters gained `channel_agent` (ruling B7). This one did not, by design: X0 holds
// (`descriptor.session.interrupt` is `'unverified'`), and a containment table written against
// unsmoke-tested research is a claim, not a fence. `contract.js › LAUNCH_BLOCKING[1]` refuses a
// launch at an undeclared profile; `test/channel-agent-profile.test.mjs` pins it. When X0 clears,
// this file gains the branch and `index.js` the entry, in one change with the grounding smoke item.

const {
  DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY,
  DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('../../tool-profiles');
// ⚠ DOPL'S OWN SURFACE, IMPORTED, NEVER RESTATED: a second copy is how one adapter gates a read
// another allows (`main/session-dopl-tools.js` header).
const doplTools = require('../../session-dopl-tools');
const { canonicalDoplName } = require('../../mcp-tool-names');

const DOPL_WRITE_TOOLS = doplTools.DOPL_WRITE_TOOLS;
const DOPL_READ_TOOLS = doplTools.DOPL_READ_TOOLS;
const { GRANULAR_SAFE_TOOLS, withGranularOffer } = doplTools;

/** The bare, server-local name. Our server registers tools bare; only a host adds a prefix. */
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// ── CURSOR'S OWN PERMISSION STRINGS ──────────────────────────────────────────────────────────
//
// ⚠ THE WIDEST GLOB EACH CLASS TAKES: a deny list is a FLOOR and a narrow deny is a hole.
const SHELL_ANY = 'Shell(*)';
const WRITE_ANY = 'Write(**)';
const WEB_ANY = 'WebFetch(*)';
// ⚠ `Mcp(*)` DENIED WHOLESALE ON RESTRICTED PROFILES — not redundant: the operator's
// `~/.cursor/mcp.json` and team dashboard are read too, with no flag to skip them (§5 item X13).
// It does not touch Dopl's own tools (`customTools`, not an MCP server the model can name).
const MCP_ANY = 'Mcp(*)';

// The credential paths every profile fences: an auto-run tool never reaches Dopl's gate, so only a
// launch-time deny fences it. ⚠ Path tools only — `Shell(<path>)` matches a COMMAND BASE and would
// deny nothing while reading as coverage.
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
// ⚠ NARROWEST FIRST; CORE READS THE ORDER (`capability.js`): unknown fail-closes to `[0]`, the last
// is widest, which keeps the windowless floor widen-only.
// ⚠ `allowlist` < `auto-review` (not the docs' order): for an unlisted call Allowlist ASKS, while
// Auto-review may let a CLASSIFIER allow it. Reversed, the floor would NARROW a session.
// ⚠ `auto-review` allows nothing more in DOPL's gate: its extra reach is Cursor's classifier over
// Cursor's built-ins, which Dopl cannot read and must not assume.
const TOOL_MODES = ['allowlist', 'auto-review', 'run-everything'];

// ⚠ POSITIVE ALLOW-LISTS, NEVER NEGATIVE: a negative mode auto-allows every UNRECOGNISED name, which
// a build-time hard-deny cannot cover. Unknown GATES IN EVERY MODE, `run-everything` included.
const ALLOWLIST_TOOLS = DOPL_READ_TOOLS.slice();
const AUTO_REVIEW_TOOLS = DOPL_READ_TOOLS.slice(); // see TOOL_MODES: no wider in DOPL's gate
const RUN_EVERYTHING_TOOLS = DOPL_READ_TOOLS.concat(DOPL_WRITE_TOOLS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? TOOL_MODES[0] : mode; // fail-closed to `allowlist`
}

// Does Axis A auto-allow this call? Never sees a channel call (`grantDecision` branches a message op
// to Axis B first). The name is CANONICALISED first (F-139).
function axisAAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'run-everything') return RUN_EVERYTHING_TOOLS.indexOf(name) !== -1;
  if (m === 'auto-review') return AUTO_REVIEW_TOOLS.indexOf(name) !== -1;
  return ALLOWLIST_TOOLS.indexOf(name) !== -1; // allowlist — Dopl's reads and nothing else
}

// ── THE PER-PROFILE CONTAINMENT TABLE ────────────────────────────────────────────────────────
//
// ⚠ `preApproved` IS EMPTY ON EVERY PROFILE: built-ins never reach Dopl's gate, and Dopl's own tools
// must never be pre-approved (a pre-approval list is a SHADOW; the channel op has to gate).
// ⚠ THERE IS NO POSITIVE BUILT-IN BOUND (`builtinTools: []`): the vocabulary of the SDK's `tools`
// allowlist is unsettled (§5 item X14), and a bound in the wrong vocabulary silently offers
// everything. The fence is the DENY plus the sandbox, both fail-closed.
// ⚠ RESTRICTED PROFILES PIN SANDBOX + RUN MODE (`native`); `full` leaves both to the operator
// (Axis A + `toolMode.secondaryAxis`).
// ⚠ `dopl_only` KEEPS THE WEB here, unlike Codex: `WebFetch` is a first-class permission string, so
// "look things up, with no shell" ports intact.
// ⚠ CREDENTIAL-PATH RULES ARE NOT IN THIS TABLE: they read userData, which a plain-Node harness
// cannot, so `launch-spec.js` concatenates them at assembly time (as Claude's does).
function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);
  // ⚠ `dopl_channel` is in NEITHER deny NOR pre-approval on ANY profile, so it REACHES the gate and
  // is op-scoped against Axis B. Here `doplToolsPolicy` is not advisory: it is the list of
  // `customTools` registered at all.
  const doplSurfaceDeny = DOPL_ADMIN_TOOLS.concat(RETIRED_DOPL_TOOLS);

  if (p === 'read_only') {
    return {
      builtinTools: [],
      preApproved: [],
      // Local execution + writes + the web + third-party MCP, plus the whole Dopl surface except
      // the channel tool. The twin of Claude's read_only, in Cursor's vocabulary.
      disallowedTools: [SHELL_ANY, WRITE_ANY, WEB_ANY, MCP_ANY]
        .concat(doplSurfaceDeny, DOPL_SAFE_TOOLS, GRANULAR_SAFE_TOOLS),
      doplToolsPolicy: withGranularOffer([channelShort]),
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
      doplToolsPolicy: withGranularOffer(DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort])),
      native: { runMode: 'allowlist', sandbox: true },
    };
  }

  // 🔒 ⚠ `channel_agent` THROWS RATHER THAN FALLING THROUGH TO `full` (2026-09-02, F-594).
  // `normalizeProfile` knows the name, so without this arm it took the `full` return — the widest
  // profile, shell not denied. Throws rather than downgrading to `read_only`, which would silently
  // run containment the operator did not ask for. When X0 clears, this becomes the fourth branch.
  if (p === 'channel_agent') {
    throw new Error(
      'cursor: no containment table for profile "channel_agent" — this runtime is frozen at three profiles (ruling X0, interrupt unverified). Launch is refused by contract.js LAUNCH_BLOCKING before this point.',
    );
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

// ⚠ AXIS A'S WINDOWLESS FLOOR IS DECLARED DATA, applied by INDEX into TOOL_MODES
// (`capability.js › floorWindowlessTool`). A windowless session has no gate surface, so a gated call
// is a silent DENY of ordered work; the floor only widens what the profile permits (hard-deny and
// the deny list are checked before Axis A).
//
//     allowlist       -> auto-review
//     auto-review     -> auto-review
//     run-everything  -> run-everything   (NEVER NARROWED — widen-only)
const WINDOWLESS_FLOOR = 'auto-review';

module.exports = {
  shortDoplName,
  buildSessionToolConfig, buildSecretPathDenyRules,
  axisAAllows, normalizeToolMode,
  TOOL_MODES, WINDOWLESS_FLOOR,
  AUTO_REVIEW_TOOLS, RUN_EVERYTHING_TOOLS,
  SHELL_ANY, WRITE_ANY, WEB_ANY, MCP_ANY, SECRET_TOOLS,
};
