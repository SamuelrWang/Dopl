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
const { normalizeProfile } = require('../../tool-profiles');

// The env vars the spawned child carries. ⚠ NAMES ONLY IN ARGV; the values are in the child's env.
// `*_TOKEN` so Codex's own `*TOKEN*` default exclude also matches it where that exclude is on.
const BEARER_ENV = 'DOPL_MCP_TOKEN';
const WORKSPACE_ENV = 'DOPL_MCP_WORKSPACE_ID';
const SESSION_ENV = 'DOPL_MCP_SESSION_ID';

// 🔒 Codex builds every shell command's env from its own, so the bearer above would be readable by
// `env` in any command (CX-03). Measured on codex-cli 0.155.1 with no model turn: with no policy a
// thread shell sees every var (the KEY/TOKEN/SECRET default exclude is OFF by default); this
// thread-level `exclude` removes the `DOPL_MCP_*` set.
const SHELL_ENV_EXCLUDE = Object.freeze(['DOPL_MCP_*']);
function shellEnvironmentPolicy() {
  return { exclude: SHELL_ENV_EXCLUDE.slice() };
}

// Same header and value Claude stamps (`claude/loader.js › withToolProfileStamp`): the server offers
// this session only its profile's tools; it may only narrow (CX-12).
const TOOL_PROFILE_HEADER = 'X-Dopl-Tool-Profile';

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

// ⚠ THE KEY DOPL MOUNTS ITS OWN SERVER UNDER, AND THE ONE DEFINITION OF IT. `launch-spec.js ›
// buildLaunchSpec` writes `config.mcp_servers.<SERVER_KEY>`, and `server-requests.js` compares an
// elicitation's `serverName` against THIS constant to decide whether the request came from Dopl's
// own surface. Those two must never be two literals: the whole allow path below turns on an
// identity comparison, and a rename that moved the mount without moving the comparison would
// either open the path to a FOREIGN server (if the comparison kept the old word and something
// else claimed it) or close it silently (if the mount moved). `test/codex-gate.test.mjs` pins the
// built launch spec's single `mcp_servers` key EQUAL to this value, so the two cannot drift even
// though `launch-spec.js` still spells the key inline.
const SERVER_KEY = 'dopl';

// ── THE PER-TOOL APPROVAL POLICY, AND WHY IT IS A TABLE RATHER THAN TWO LITERALS ─────────────
//
// 🔒 ⚠ **THIS TABLE IS WHAT MAKES A NAMELESS ELICITATION NAMEABLE.** Measured 2026-09-22
// (codex-cli 0.155.1, U4): the approval for an MCP tool call arrives as
// `mcpServer/elicitation/request` carrying `serverName` and NO tool name and NO `itemId` — the
// tool's name exists only inside the operator-facing SENTENCE, and reading a name out of prose is
// not a bound. So the name is not recovered FROM THE WIRE at all. It is recovered from the
// CONFIGURATION DOPL ITSELF WROTE: if exactly one tool on this server is configured in a mode that
// can raise an ask, then an ask from this server is that tool. Server identity + "an ask happened"
// resolves the name, structurally, with nothing parsed.
//
// ⚠ THAT IS ONLY TRUE IF THE DEFAULT NEVER ASKS, WHICH IS WHY `default_tools_approval_mode`
// CHANGED FROM `'writes'` TO `'auto'` ON 2026-09-22, DELIBERATELY. Under `'writes'` every
// non-read-only Dopl tool could also raise an ask, the asking set was not a singleton, and no ask
// could be named — which is exactly the state in which `server-requests.js` had no choice but to
// decline unconditionally, i.e. a Dopl-launched Codex agent could not post, read or do anything
// else through Dopl's own MCP surface. What the change gives up is stated plainly rather than
// hidden: Dopl's NON-channel tools (`dopl_kb` writes and the rest) now run on this runtime without
// an Axis-A card. They are not ungoverned — the session is only OFFERED the tools in
// `enabled_tools` (the profile's own policy, below), the profile's deny list is applied to that
// list, and the bearer's scope bounds what the server will do for this session at all — but the
// per-call Axis-A question is not asked for them here. It was never actually asked before either:
// before this change those calls were DENIED outright, so nothing that used to reach a card stops
// reaching one. Axis B — the invariant that matters, that NO tool posture can send a message —
// is untouched: `CHANNEL_TOOL` still asks, and its ask now reaches Dopl's real gate.
//
// ⚠ ONE MORE TOOL IN AN ASKING MODE AND THE DERIVATION MUST STOP, NOT GUESS. `askingToolsIn`
// answers a SET, `soleAskingTool` answers `null` for anything but a singleton, and the caller
// treats `null` as "the Dopl surface as a whole" rather than as a name. Adding a second asking
// tool therefore degrades to a gate, loudly, instead of mis-naming a call.
// 🔒 ⚠ **AND `'auto'` TURNED OUT TO ASK (MEASURED 2026-09-22, codex-cli 0.155.1, CXP-3A).** A
// scripted-model call to `dopl_kb` under `approval_policy` `untrusted` or `on-request` with the
// default at `'auto'` raised `mcpServer/elicitation/request` from `serverName: 'dopl'` (its `_meta`
// even offered `persist: ['session','always']`) — and `approval.js › doplElicitation` named that
// ask `dopl_channel`, handing the channel tool's Axis-B lanes a knowledge-base call's arguments.
// The measured never-ask mode is `'approve'`: the same call ran with NO request under both
// policies. So the default is `'approve'` — which is what the 2026-09-22 ruling above ASSUMED
// `'auto'` was ("non-channel tools run without an Axis-A card") — and the singleton premise is
// now true on the wire, not just in this table. (`test/codex-mcp-discovery.test.mjs` re-measures.)
const DEFAULT_TOOL_APPROVAL_MODE = 'approve';
const TOOL_APPROVAL_MODES = Object.freeze({ [CHANNEL_TOOL]: 'prompt' });

// The modes that CAN produce an ask. ⚠ MEMBERSHIP IS THE FAIL-CLOSED DIRECTION: `writes` only asks
// for non-read-only tools, but "only sometimes" is still "can", and counting it as asking can only
// make the set BIGGER — which makes `soleAskingTool` answer `null` and the caller fall back to the
// un-named surface. Counting it as silent would be the unsafe error, so it is not made.
// 🔒 MEASURED 2026-09-22 (C24 answered): `prompt` asks, `auto` asks for a tool with no
// `readOnlyHint`, `writes` asks; `approve` NEVER asks. So `approve` left this list and `auto` joined.
const ASKING_MODES = Object.freeze(['prompt', 'auto', 'writes']);

/**
 * The tools on ONE server entry that can raise an approval ask, or `null` when EVERY tool can.
 *
 * ⚠ READ OFF THE ENTRY, NOT OFF THE CONSTANTS ABOVE, so this answer cannot drift from the entry
 * the launch actually sends. `null` means "not a nameable set" — a default mode that asks puts
 * every tool on the server in the set, including ones Dopl never enumerated.
 */
function askingToolsIn(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  if (ASKING_MODES.indexOf(e.default_tools_approval_mode) !== -1) return null;
  const table = (e.tools && typeof e.tools === 'object') ? e.tools : {};
  return Object.keys(table)
    .filter((tool) => {
      const cfg = table[tool];
      return !!cfg && ASKING_MODES.indexOf(cfg.approval_mode) !== -1;
    })
    .sort();
}

/**
 * The ONE tool an ask from Dopl's server can be, or `null` when that is not derivable.
 *
 * ⚠ IT ASKS A REAL ENTRY, built the same way a launch builds one. `enabled_tools` is deliberately
 * NOT intersected here: this function does not know the session's profile, and the failure that
 * omission can produce is closed rather than open — a profile that does not offer `CHANNEL_TOOL`
 * cannot make a call that elicits, and if one somehow arrived it would be judged as a channel call
 * by a profile whose deny list already hard-denies the channel tool (`session-profiles.js ›
 * grantDecision` step 1, which runs ahead of the Axis-B branch).
 */
function soleAskingTool(entry) {
  const asking = askingToolsIn(entry || buildDoplServerEntry(null));
  return asking && asking.length === 1 ? asking[0] : null;
}

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
 * ⚠ `'prompt'` RATHER THAN `'approve'`, AND SINCE 2026-09-22 THAT IS MEASURED (§5 C24): `prompt`
 * raises the elicitation, `approve` runs the call with no request at all. ⚠ UNDER CODEX'S NATIVE
 * `approval_policy: 'never'` EVEN `prompt` RAISES NOTHING — the call FAILS (measured) — which is
 * why Dopl no longer SENDS native `never` (2026-09-22): the operator's `never` rides as `granular`
 * with only `mcp_elicitations` asking (`policy.js › NEVER_NATIVE`), so this pin reaches the gate
 * on every Axis-A mode.
 * ⚠ `default_tools_approval_mode` IS `'approve'` (it was `'writes'`, then `'auto'` on 2026-09-22,
 * which was measured to ASK — see `DEFAULT_TOOL_APPROVAL_MODE`) AND THAT IS A RULING, NOT A DEFAULT. The argument for the change — and what it costs — is written out in
 * full beside `TOOL_APPROVAL_MODES` above; the short form is that a second asking tool makes every
 * ask un-nameable on this runtime, and an un-nameable ask can only be declined.
 */
function buildDoplServerEntry(doplToolsPolicy, profile) {
  const entry = {
    url: MCP_URL,
    bearer_token_env_var: BEARER_ENV,
    http_headers: Object.assign({}, RUNTIME_HEADERS, { [TOOL_PROFILE_HEADER]: normalizeProfile(profile) }),
    env_http_headers: {
      'X-Workspace-Id': WORKSPACE_ENV,
      'X-Dopl-Session-Id': SESSION_ENV,
    },
    enabled: true,
    startup_timeout_sec: STARTUP_TIMEOUT_SEC,
    tool_timeout_sec: clientTimeoutSec(),
    default_tools_approval_mode: DEFAULT_TOOL_APPROVAL_MODE,
    // ⚠ BUILT FROM THE TABLE, NEVER RE-SPELLED. `askingToolsIn` reads this same field back, so the
    // name the elicitation path derives is the name the entry actually pinned.
    tools: Object.keys(TOOL_APPROVAL_MODES).reduce((acc, tool) => {
      acc[tool] = { approval_mode: TOOL_APPROVAL_MODES[tool] };
      return acc;
    }, {}),
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
  // 🔒 MEASURED 2026-09-22, codex-cli 0.155.1 (§5 item C22 / U4) — `test/codex-mcp-surface.test.mjs`
  // holds the capture. It was `null` for "nobody has ever seen a Codex MCP tool name", and the
  // answer turned out to be that THERE IS NO SINGLE NAME: the app-server's `mcpToolCall` thread
  // item carries `{ server: 'dopl', tool: 'dopl_channel' }` as TWO FIELDS, and the tool half is
  // BARE — no `mcp__<server>__`, no prefix of any kind. `mcpServer/tool/call` takes the same two
  // parameters. So `main/mcp-tool-names.js › canonicalDoplName` canonicalises the `tool` field
  // correctly and the F-139 spelling hazard does NOT apply here.
  // ⚠ WHAT DOES APPLY IS NOT A NAMING PROBLEM: the APPROVAL for that call arrives as
  // `mcpServer/elicitation/request`, which carries `serverName` and a `message` and NO tool-name
  // field at all, so nothing downstream can be handed the name above FROM THE WIRE.
  // 🔒 RESOLVED BY SERVER, 2026-09-22 (Samuel's ruling). The request names the SERVER, and this
  // file is the one place that server's entry is built — so the name is recovered from Dopl's own
  // configuration instead of from the request: `TOOL_APPROVAL_MODES` puts exactly ONE tool on this
  // server in an asking mode, `soleAskingTool` answers it, and `approval.js › doplElicitation`
  // hands that name and `_meta.tool_params` to the SAME gate every other request reaches. A
  // non-Dopl `serverName`, a missing `_meta`, a different `codex_approval_kind` and a
  // non-singleton asking set all still fail closed.
  toolNamePrefix: '<tool>',
  // The companion half of the shape above — named so a reader cannot take `toolNamePrefix` for a
  // claim that the server is absent from the wire. It is present, on its own field.
  toolNameServerField: 'server',
  // ⚠ GENUINELY PER-TOOL, AND IT IS AXIS B'S PIN. See `buildDoplServerEntry`.
  // 🔒 MEASURED 2026-09-22: the real app-server retains `mcp_servers.dopl.tools.dopl_channel.
  // approval_mode` through `config/read` EVEN UNDER `--strict-config`, which errors on any field
  // this CLI does not recognise. The key is supported; what it produces is the elicitation above.
  perToolApproval: 'tools.<tool>.approval_mode',
  // ⚠ null: this runtime has no eager-load flag — MEASURED 2026-09-22 (codex-cli 0.155.1,
  // CXP-3A). Codex DOES defer every MCP tool behind `tool_search`, and no server key, thread
  // `config` or `[features]` toggle opts Dopl's entry out, so `prose.toolSearchVerb` names that
  // verb and `capability.mcpDiscoveryVerb` makes the turn order the search (index.js).
  eagerLoadFlag: null,
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp, probeMcp, descriptor,
  buildDoplServerEntry, buildMcpEnv,
  // The elicitation allow path's two structural inputs: WHICH server is Dopl's, and which tool an
  // ask from it can be. Both are read off this file so neither can drift from the entry.
  SERVER_KEY, askingToolsIn, soleAskingTool,
  DEFAULT_TOOL_APPROVAL_MODE, TOOL_APPROVAL_MODES, ASKING_MODES,
  BEARER_ENV, WORKSPACE_ENV, SESSION_ENV, RUNTIME_HEADERS, CHANNEL_TOOL,
  TOOL_PROFILE_HEADER, SHELL_ENV_EXCLUDE, shellEnvironmentPolicy,
};
