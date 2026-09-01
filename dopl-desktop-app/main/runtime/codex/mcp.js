// MCP REGISTRATION — ⚠ TWO MECHANISMS, NOT ONE.
//
//   SESSION TRANSPORT   what the SPAWNED session gets. Built per launch as config OVERRIDES on the
//                       `codex app-server` command line, never a file and never a CLI verb. This is
//                       the lane Axis B's whole enforcement story depends on: the Dopl MCP server
//                       is remote HTTP, so the desktop main process is NOT in the call path of a
//                       channel call, and the held approval request is the only thing between the
//                       model and that endpoint.
//   HOST REGISTRATION   the OPERATOR's own user-scope entry (`codex mcp add`), so their manual
//                       `codex` runs reach Dopl too. ⚠ NOT WRITTEN IN v1 — see `registerMcp`.
//
// ⚠ THE BEARER NEVER TOUCHES ARGV, AND THAT IS THE REASON THIS FILE PREFERS THE ENV FORMS. A
// `-c mcp_servers.dopl.http_headers.Authorization="Bearer …"` override would put the device token
// on a command line every `ps` on the machine can read. `codex-research.md` §3 documents
// `bearer_token_env_var` and `env_http_headers` — both name an ENV VAR and let the CLI read the
// value itself — so the token and the two per-session pins ride the child's environment and only
// their VARIABLE NAMES appear in argv. The Claude adapter solves the same problem by never
// serialising the entry at all; this is the same rule with this platform's lever.
//
// ⚠ THE POLICY LAYER STAYS IN CORE AND THIS FILE ONLY NAMES THE LANE. `main/mcp-config.js` owns
// the per-server call timeout (`MCP_CLIENT_TIMEOUT_MS`, derived from the server's own await budget)
// and the device token. Both are READ from there and never restated — the timeout drifted once
// already by being restated.

const { MCP_URL } = require('../../config');

// The env vars the spawned child carries. ⚠ NAMES ONLY IN ARGV; the values are in the child's env.
const BEARER_ENV = 'DOPL_MCP_BEARER';
const WORKSPACE_ENV = 'DOPL_MCP_WORKSPACE_ID';
const SESSION_ENV = 'DOPL_MCP_SESSION_ID';

// ⚠ CUSTODY, NOT VENDOR — two headers, two facts, and step 1 of the port exists because they were
// nearly fused. `desktop-session` means "the desktop app spawned this" and stays TRUE for a
// Dopl-driven Codex session; three live consumers compare it by strict equality or array
// membership (`packages/mcp-server/src/tools/identity.ts › runtimeWord`,
// `› channel-wake-guidance.ts`, `main/targeting.js › DESKTOP_RUNTIMES`), so a vendor word THERE
// would silently drop every Codex session out of the desktop branch. The vendor is the second
// header, and `src/shared/auth/runtime-header.ts › CODEX_VENDOR` is the literal it must match —
// there is no shared module across that join, so the two sides agree by literal or not at all.
const RUNTIME_HEADERS = {
  'X-Dopl-Runtime': 'desktop-session',
  'X-Dopl-Vendor': 'codex',
};

// ⚠ THE DOCUMENTED DEFAULT, NAMED SO IT IS VISIBLE RATHER THAN INHERITED (`codex-research.md` §3:
// `startup_timeout_sec` 10s). The Dopl endpoint streams, so a slow first connect is a real
// possibility and a silent 10s is easier to diagnose when it is written down.
const STARTUP_TIMEOUT_SEC = 10;

// The channel tool's bare, server-local name — `enabled_tools` and the per-tool policy both use it.
const CHANNEL_TOOL = 'dopl_channel';

function clientTimeoutSec() {
  // ⚠ ONE DEFINITION, READ NOT RESTATED. Lazy because `mcp-config` pulls auth, and an unwired
  // harness must read as "no token", never throw into a launch.
  try {
    return Math.max(1, Math.ceil(require('../../mcp-config').MCP_CLIENT_TIMEOUT_MS / 1000));
  } catch (_) {
    return 60;
  }
}

function doplBearer() {
  try {
    return require('../../mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    return '';
  }
}

/**
 * The `mcp_servers.dopl` entry for one spawn, as a plain object of config keys.
 *
 * ⚠ THE URL IS ALWAYS THE COMPILED-IN `MCP_URL`. Reading it off disk would let any local process
 * repoint the session's whole MCP surface — bearer included — at its own endpoint.
 *
 * ⚠ `tools.dopl_channel.approval_mode` IS AXIS B'S PIN AND IT IS INDEPENDENT OF AXIS A. The
 * session's `approval_policy` is the operator's own Axis-A choice and may be as wide as `never`;
 * the channel tool must reach the gate REGARDLESS, because no tool posture can send a message
 * (`session-profiles.js`'s standing invariant). `codex-research.md` §3 documents per-MCP-tool
 * approval as genuinely per-tool and calls it "strictly better than what we have" — this is that
 * lever used for the one thing it must guarantee.
 * ⚠ `'prompt'` RATHER THAN `'approve'`, AND THE CHOICE IS RECORDED: the enum is
 * `auto | prompt | writes | approve`, in which `auto` plainly means "never ask" and `writes` means
 * "ask for non-read-only tools". Which of `prompt` and `approve` is the unconditional ask is NOT
 * disambiguated by the research, and Axis B's whole enforcement point rides on getting it right —
 * §5 item C24. `prompt` is the unambiguous reading of the two.
 * ⚠ `default_tools_approval_mode: 'writes'` for everything else, per the design's step-7 build
 * order: prompt for non-read-only tools, which is the heuristic Dopl's two-axis gate approximates.
 */
function buildDoplServerEntry(doplToolsPolicy) {
  const entry = {
    url: MCP_URL,
    bearer_token_env_var: BEARER_ENV,
    http_headers: Object.assign({}, RUNTIME_HEADERS),
    env_http_headers: {
      'X-Workspace-Id': WORKSPACE_ENV,
      'X-Dopl-Session-Id': SESSION_ENV,
    },
    enabled: true,
    startup_timeout_sec: STARTUP_TIMEOUT_SEC,
    tool_timeout_sec: clientTimeoutSec(),
    default_tools_approval_mode: 'writes',
    tools: { [CHANNEL_TOOL]: { approval_mode: 'prompt' } },
  };
  // ⚠ DEFENCE IN DEPTH, NOT THE BOUND. The real bound is `grantDecision` step 1 reading the
  // profile's deny list; this narrows what the session is even OFFERED. Absent (a `full` session)
  // means the whole Dopl surface is reachable and every call still stops at the gate.
  if (Array.isArray(doplToolsPolicy) && doplToolsPolicy.length) entry.enabled_tools = doplToolsPolicy.slice();
  return entry;
}

/**
 * The per-session ENVIRONMENT the entry above refers to by variable name.
 *
 * ⚠ THE SLOT KEY IS A LABEL, NOT A LOCK: nothing granted, nothing enforced, no session count
 * limited. It names the registry slot this run occupies so two concurrent sessions of one agent
 * handle are distinguishable on the wire, which nothing else about them is. A missing slot sets
 * no variable, so no header is sent.
 * 🔒 `bearerOverride` is the CONTAINER LOCK: a child credential locked to one workspace, minted at
 * spawn for a shared link container. It REPLACES the device token, and it is what actually refuses
 * another workspace server-side. `X-Workspace-Id` below stays a HINT that grants nothing.
 */
function buildMcpEnv(workspaceId, bearerOverride, slotKey) {
  const override = typeof bearerOverride === 'string' ? bearerOverride.trim() : '';
  const token = override || doplBearer();
  const env = {};
  // ⚠ NO TOKEN => NO ENTRY, and the session still runs (pre-sign-in, or a harness). Returning a
  // half-built entry that would 401 on every call is worse than none: the agent would be told it
  // HAS a delivery path and watch it fail.
  if (!token) return { env, usable: false };
  env[BEARER_ENV] = token;
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) env[WORKSPACE_ENV] = pin;
  const slot = typeof slotKey === 'string' ? slotKey.trim() : '';
  // Same shape the server's own header parser accepts (id characters only, no whitespace, <=128).
  if (slot && /^[A-Za-z0-9:._-]{1,128}$/.test(slot)) env[SESSION_ENV] = slot;
  return { env, usable: true };
}

// ── HOST REGISTRATION ────────────────────────────────────────────────────────────────────────

/**
 * The OPERATOR's own user-scope entry.
 *
 * ⚠ REFUSED IN v1, DELIBERATELY, AND THE REFUSAL IS THE SAFE ANSWER. `codex mcp add` exists
 * (`codex-research.md` §3) but the research documents only the `--url` and OAuth forms; how a
 * static `Authorization` header is passed, and what scope flag this CLI takes, are not settled.
 * Writing a WRONG entry into a config file the operator also owns is a side effect that outlives
 * the session and that they have to find and undo by hand — the Claude lane's whole discipline is
 * that it "NEVER EDITS the config file directly" and only ever speaks through verbs it has
 * verified. So this answers false with a reason until §5 item C27 comes back, rather than guessing
 * an argv into somebody's `~/.codex/`.
 */
function registerMcp(_cfg) {
  return Promise.resolve({
    ok: false,
    reason: 'Dopl does not yet write a `codex mcp add` entry: the header and scope flags for this '
      + 'CLI are unverified, and a wrong entry in your own Codex config is not ours to leave behind. '
      + 'Sessions Dopl spawns reach Dopl regardless — this only affects your own manual `codex` runs.',
  });
}

/**
 * ⚠ ABSENT AND UNKNOWN ARE THE SAME ANSWER ON THIS RUNTIME, WHICH IS WHY `probe` IS `false`. The
 * Claude lane distinguishes them because its CLI prints a "no such server" line it can parse; the
 * Codex CLI's `mcp get` output format is not documented, and an exit code alone cannot separate
 * "no such server" from "the binary is missing" or "the config is unreadable". A probe that
 * collapses the two makes "repair the entry" indistinguishable from "do not touch the operator's
 * config", so this reports UNKNOWN rather than claiming a distinction it cannot make.
 */
function probeMcp() {
  return Promise.resolve({ present: null, reason: 'this runtime cannot distinguish an absent entry from an unreadable one' });
}

// Descriptor half.
const descriptor = {
  sessionTransport: 'http',
  hostRegistration: 'cli-verb',
  // ⚠ false: see `probeMcp` — a capability claim, not an absence.
  probe: false,
  // ⚠ null: the prefix a Codex host puts on an MCP tool name is NOT documented anywhere in
  // `codex-research.md`, and it is load-bearing far beyond prose. `main/mcp-tool-names.js` strips
  // `^mcp__.*__` and canonicalises a KNOWN short name back onto `mcp__dopl__…`; a bare name
  // (`dopl_channel`) canonicalises correctly and so does the `mcp__<server>__` form, but any THIRD
  // shape misses every list in the gate at once — Axis B, the pre-approvals, both Axis-A modes and
  // HARD-DENY — which is exactly the F-139 defect, reproduced. §5 item C22, and it is a
  // design-changing item rather than a prose one.
  toolNamePrefix: null,
  // ⚠ GENUINELY PER-TOOL, AND IT IS AXIS B'S PIN. See `buildDoplServerEntry`.
  perToolApproval: 'tools.<tool>.approval_mode',
  // ⚠ null: this runtime has no eager-load flag. Claude's `alwaysLoad` exists because its CLI
  // defers every MCP tool behind a tool-search verb; nothing in the research says Codex defers
  // tools at all, and `prose.toolSearchVerb` is `null` here for the same reason.
  eagerLoadFlag: null,
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp, probeMcp, descriptor,
  buildDoplServerEntry, buildMcpEnv,
  BEARER_ENV, WORKSPACE_ENV, SESSION_ENV, RUNTIME_HEADERS, CHANNEL_TOOL,
};
