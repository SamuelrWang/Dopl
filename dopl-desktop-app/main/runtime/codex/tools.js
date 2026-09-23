// Codex's Axis-A vocabulary and containment table, in its own words. Restricted profiles ship a deny list
// (`grantDecision` step 1) AND the sandbox, which bounds the filesystem but not delegation or persistence.

const {
  DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY,
  DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('../../tool-profiles');
const doplTools = require('../../session-dopl-tools');
const { canonicalDoplName } = require('../../mcp-tool-names');

const DOPL_WRITE_TOOLS = doplTools.DOPL_WRITE_TOOLS;
const DOPL_READ_TOOLS = doplTools.DOPL_READ_TOOLS;

// Per-server `enabled_tools` lists use the bare server-local name.
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// Codex gates action categories, not named built-ins; `server-requests.js › REQUEST_NAMES` maps onto these.
const COMMAND_ITEM = 'commandExecution'; // item/commandExecution/requestApproval — the shell
const FILE_ITEM = 'fileChange'; //          item/fileChange/requestApproval    — a write

// `granular`'s five categories, verbatim. `rules`/`mcp_elicitations` are in no allow or deny list:
// unclassified, so they gate in every mode (fail-closed).
const GRANULAR_CATEGORIES = [
  'sandbox_approval', 'rules', 'mcp_elicitations', 'request_permissions', 'skill_approval',
];

// Reaches the shell or escapes the sandbox (twin of Claude's `ESCALATION_TOOLS`). `request_permissions` and
// `skill_approval` are deliberately absent: capability escalation gates in every mode.
const ESCALATION_ITEMS = [COMMAND_ITEM, 'sandbox_approval'];

// `index.js › editScopedTools` stays empty: a fileChange approval carries no path to scope a grant by.
const EDIT_ITEMS = [FILE_ITEM];

// Narrowest first, read by index (`capability.js`): `[0]` is the fail-closed default, last is widest.
// `granular` sits at 1 because Dopl cannot read its categories. `on-failure` is deprecated, so absent.
const TOOL_MODES = ['untrusted', 'granular', 'on-request', 'never'];

// Positive allow-lists only: an unrecognised name gates in every mode, `never` included.
const UNTRUSTED_TOOLS = DOPL_READ_TOOLS.slice();
const ON_REQUEST_TOOLS = DOPL_READ_TOOLS.concat(EDIT_ITEMS);
const NEVER_TOOLS = ON_REQUEST_TOOLS.concat(ESCALATION_ITEMS, DOPL_WRITE_TOOLS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? TOOL_MODES[0] : mode; // fail-closed to `untrusted`
}

// Never sees a channel call (`grantDecision` branches it to Axis B first). Names canonicalised (F-139).
function axisAAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'untrusted' || m === 'granular') return UNTRUSTED_TOOLS.indexOf(name) !== -1;
  if (m === 'on-request') return ON_REQUEST_TOOLS.indexOf(name) !== -1;
  return NEVER_TOOLS.indexOf(name) !== -1; // never
}

// `preApproved` is empty: Codex raises no request for a read, so a pre-approval would only be a shadow.
// `dopl_only` has no web here (network is a sandbox property, `sandbox_approval` denied) — deliberate.
// Thread `features` fence, every profile: `apps`/`plugins` off — `codex_apps` mounts from the operator's
// ChatGPT auth; `multi_agent` off (delegation fence; code-mode models are fenced by `catalog.js`).
const ACCOUNT_FENCE = Object.freeze({ apps: false, plugins: false, multi_agent: false });

// goals/sleep_tool/memories/hooks off on every profile: later work is a visible Dopl agent and waiting is a
// `dopl_channel` hold, never a runtime timer, goal loop or memory (`codex-persistence-fence-live` measures).
const PERSISTENCE_FENCE = Object.freeze({ goals: false, sleep_tool: false, memories: false, hooks: false });

// `notify` runs after every turn; a thread-level `notify = []` silences a home-layer one (deliberate).
const NOTIFY_FENCE = Object.freeze([]);

const FEATURE_FENCE = Object.freeze({ ...ACCOUNT_FENCE, ...PERSISTENCE_FENCE });

const RESTRICTED_DENY = Object.freeze([COMMAND_ITEM, FILE_ITEM, 'sandbox_approval', 'request_permissions', 'skill_approval']);

function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);
  // `dopl_channel` is in no deny or pre-approval list, so it reaches the gate for Axis B.
  const doplSurfaceDeny = DOPL_ADMIN_TOOLS.concat(RETIRED_DOPL_TOOLS);

  if (p === 'read_only') {
    return {
      builtinTools: [],
      preApproved: [],
      disallowedTools: RESTRICTED_DENY.concat(doplSurfaceDeny, DOPL_SAFE_TOOLS),
      doplToolsPolicy: [channelShort],
      native: { sandbox_mode: 'read-only', approval_policy: 'untrusted' },
      features: { ...FEATURE_FENCE },
    };
  }

  if (p === 'dopl_only') {
    return {
      builtinTools: [],
      preApproved: [],
      // Non-admin Dopl surface offered; under mcp `approve` only `dopl_channel` raises a request (CX-23).
      disallowedTools: RESTRICTED_DENY.concat(doplSurfaceDeny),
      doplToolsPolicy: DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort]),
      native: { sandbox_mode: 'read-only', approval_policy: 'untrusted' },
      features: { ...FEATURE_FENCE },
    };
  }

  // `full` minus the shell AND the escape that reaches it (`ESCALATION_ITEMS`); `native` stays null so the
  // operator's Axis-A pick rides.
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

  // full: the universal floor only (Dopl admin + retired tools).
  return {
    builtinTools: [],
    preApproved: [],
    disallowedTools: UNIVERSAL_HARD_DENY.slice(),
    doplToolsPolicy: null,
    native: null,
    features: { ...FEATURE_FENCE },
  };
}

// Declared data: `capability.js › floorWindowlessTool` raises a windowless session to it by index into
// TOOL_MODES and never narrows (`never` stays `never`).
const WINDOWLESS_FLOOR = 'on-request';

module.exports = {
  shortDoplName,
  buildSessionToolConfig,
  axisAAllows, normalizeToolMode,
  TOOL_MODES, GRANULAR_CATEGORIES, ESCALATION_ITEMS, EDIT_ITEMS,
  COMMAND_ITEM, FILE_ITEM, WINDOWLESS_FLOOR,
  NOTIFY_FENCE,
  ON_REQUEST_TOOLS, NEVER_TOOLS,
};
