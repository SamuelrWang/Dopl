// Muse's Axis-A vocabulary and containment table, in its own words. Restricted profiles ship a deny list
// (`grantDecision` step 1) AND host-level fences (`muse serve` flags and settings), which bound what runs
// without ever asking.

const {
  DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY,
  DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('../../tool-profiles');
const { DOPL_WRITE_TOOLS, DOPL_READ_TOOLS, GRANULAR_SAFE_TOOLS, withGranularOffer } = require('../../session-dopl-tools');
const { canonicalDoplName } = require('../../mcp-tool-names');

function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// THE GATE IS ASKED IN MSP'S OWN WORDS: an approval's `subject.kind` (the schema's open discriminator
// `shell | fileAccess | network | unixSocket | process | tool`); for `tool` the approval's `toolName`
// (`mcp__<server>__<tool>` for an MCP tool). `approval.js › gateName` is the one translator.
const SHELL_SUBJECT = 'shell';
const FILE_SUBJECT = 'fileAccess';
const NETWORK_SUBJECT = 'network';
const SOCKET_SUBJECT = 'unixSocket';
const PROCESS_SUBJECT = 'process';
const TOOL_SUBJECT = 'tool';
const SUBJECT_KINDS = Object.freeze([SHELL_SUBJECT, FILE_SUBJECT, NETWORK_SUBJECT, SOCKET_SUBJECT, PROCESS_SUBJECT, TOOL_SUBJECT]);

// Reaches the shell or a host process (twin of Claude's `ESCALATION_TOOLS`).
const ESCALATION_SUBJECTS = [SHELL_SUBJECT, PROCESS_SUBJECT, SOCKET_SUBJECT];
const EDIT_SUBJECTS = [FILE_SUBJECT];

// `ApprovalMode`'s own words (closed, select-never-create), narrowest first; `[0]` is the fail-closed
// default. `denyUnmatched` is NOT offered: it fails Dopl's own channel posts with no request (no gate, no
// consent card) — the same reason Codex's native `never` is never sent.
const TOOL_MODES = ['promptUnmatched', 'onRequest', 'allowAll'];

// Positive allow-lists only: an unrecognised name gates in every mode, `allowAll` included.
const PROMPT_UNMATCHED_TOOLS = DOPL_READ_TOOLS.slice();
const ON_REQUEST_TOOLS = DOPL_READ_TOOLS.concat(EDIT_SUBJECTS);
const ALLOW_ALL_TOOLS = ON_REQUEST_TOOLS.concat(ESCALATION_SUBJECTS, [NETWORK_SUBJECT], DOPL_WRITE_TOOLS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? TOOL_MODES[0] : mode;
}

// Never sees a channel call (`grantDecision` branches it to Axis B first). Names canonicalised (F-139).
function axisAAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'promptUnmatched') return PROMPT_UNMATCHED_TOOLS.indexOf(name) !== -1;
  if (m === 'onRequest') return ON_REQUEST_TOOLS.indexOf(name) !== -1;
  return ALLOW_ALL_TOOLS.indexOf(name) !== -1; // allowAll
}

// HOST FENCES — `muse serve` argv, fixed for the host's lifetime (one host per session). Each flag and
// `-c` key below was accepted by `muse serve` 1.4.7 (an unknown key refuses the run, so a rename fails loud).
// Every profile: workflows (durable multi-agent runs) off — later work is a visible Dopl agent.
const EVERY_PROFILE = Object.freeze(['-c', 'run.workflow_trigger_mode="off"']);
// Restricted profiles: no workspace writes, no shell, no web tools.
const NO_WRITE = Object.freeze(['--disable-write']);
const NO_SHELL = Object.freeze(['--disable-shell']);
const NO_WEB = Object.freeze(['-c', 'tools.web_fetch.enabled=false', '-c', 'tools.web_search.mode="off"']);

// MSP permission profiles (`permissionProfile/list`, measured 1.4.7). `:ask-me` has a HUMAN reviewer — the
// AI judge (`:auto-review`) never decides for Dopl; `:read-only` reads files only. `:unrestricted` (no
// prompts) is never sent.
const ASK_PROFILE = ':ask-me';
const READ_ONLY_PROFILE = ':read-only';

const RESTRICTED_DENY = Object.freeze([SHELL_SUBJECT, FILE_SUBJECT, NETWORK_SUBJECT, SOCKET_SUBJECT, PROCESS_SUBJECT]);

function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);
  const doplSurfaceDeny = DOPL_ADMIN_TOOLS.concat(RETIRED_DOPL_TOOLS);
  const row = (fields) => Object.assign({ builtinTools: [], preApproved: [] }, fields);
  const native = (permissionProfile, flags) => ({ permissionProfile, serveFlags: EVERY_PROFILE.concat(flags) });

  if (p === 'read_only') {
    return row({
      disallowedTools: RESTRICTED_DENY.concat(doplSurfaceDeny, DOPL_SAFE_TOOLS, GRANULAR_SAFE_TOOLS),
      doplToolsPolicy: withGranularOffer([channelShort]),
      native: native(READ_ONLY_PROFILE, NO_WRITE.concat(NO_SHELL, NO_WEB)),
    });
  }
  if (p === 'dopl_only') {
    return row({
      disallowedTools: RESTRICTED_DENY.concat(doplSurfaceDeny),
      doplToolsPolicy: withGranularOffer(DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort])),
      native: native(ASK_PROFILE, NO_WRITE.concat(NO_SHELL, NO_WEB)),
    });
  }
  // `full` minus the shell and the host-process escapes.
  if (p === 'channel_agent') {
    return row({
      disallowedTools: UNIVERSAL_HARD_DENY.concat(ESCALATION_SUBJECTS),
      doplToolsPolicy: null,
      native: native(ASK_PROFILE, NO_SHELL.slice()),
    });
  }
  return row({
    disallowedTools: UNIVERSAL_HARD_DENY.slice(),
    doplToolsPolicy: null,
    native: native(ASK_PROFILE, []),
  });
}

// Declared data: the safest mode (every unmatched action asks, so a windowless session denies it rather
// than running it unseen). `capability.js › floorWindowlessTool` never narrows a wider pick.
const WINDOWLESS_FLOOR = 'promptUnmatched';

module.exports = {
  shortDoplName, buildSessionToolConfig, axisAAllows, normalizeToolMode,
  TOOL_MODES, WINDOWLESS_FLOOR, SUBJECT_KINDS, ESCALATION_SUBJECTS, EDIT_SUBJECTS, RESTRICTED_DENY,
  SHELL_SUBJECT, FILE_SUBJECT, NETWORK_SUBJECT, TOOL_SUBJECT,
  ON_REQUEST_TOOLS, ALLOW_ALL_TOOLS, ASK_PROFILE, READ_ONLY_PROFILE,
};
