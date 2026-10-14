# Grok runtime adapter — Grok Build CLI over ACP, mapped onto the runtime scaffold

Status: **BUILT 2026-10-13** (`dopl-desktop-app/main/runtime/grok/`, INVARIANTS §11.0k; branch `runtime/muse-scaffold`,
not pushed) — see §0 for what the build measured beyond this spec and the remaining smoke list. Sandbox/binary
smoke S5b–S16 run **2026-10-14** (branch `runtime/grok-smoke`, §0). Probed 2026-10-13 against `grok 1.0.52 (0920c8169e27)` macOS aarch64, first
unauthenticated, then on Samuel's subscription sign-in (real-model smoke, ~10 turns on `grok-4.7`).
Template: `runtime-scaffold.md` §4 (layout), §4.4 (checklist), §8 (kit mapping). Prior research:
`new-runtimes-grok-muse-opencode.md` §3 — **this file supersedes it where they disagree** (several §3 claims
were wrong on the live build; each is called out below).

Evidence: `~/Downloads/platform-research/grok/` — recordings are ndjson `{t, dir, raw}` (dir = `out` to grok,
`in` from grok, plus `mark`/`spawn`/`exit`), redacted (paths → `<SANDBOX>`, email/team id/host stripped).
`g*-*.ndjson` / `g4-inspect-*.json` = unauthenticated probes; `smoke-s*.ndjson` = real-model smoke;
`smoke-s1-mcp-server.log` = what the Dopl-like MCP stub saw. Driver scripts sit beside them
(`acp-smoke.mjs`, `mcp-stub.mjs`, `s1..s4-*.mjs`). Source excerpts from `xai-org/grok-build@2bdd1d6a`
(2026-09-29 — **the public source lags the binary by ~2 weeks**; live behaviour wins).

Tags used below: **LIVE** = observed on 1.0.52 on 2026-10-13 (recording named); **SRC** = read in
source/bundled docs only; **SMOKE** = still open.

---

## 0. Built (2026-10-13) — what the build changed, measured, and left open

Every file is a scaffold slot (`runtime-scaffold.test.mjs` pins `EXTRA.grok` / `PENDING.grok` empty): the
hook answerer this spec called `hook-gate.js` (EXTRA) lives in `approval.js › makeApprovalDriver`, beside the
permission reply it shares a memo with. Suites: `grok-normalize`, `-approval`, `-launch-lifecycle`,
`-config-home`, `-resolve-bin` (incl. the shape), `-signin`, `-live`. Where the build departs from §2–§9:

- **Tool-mode words are `default | autoMode | approve-all`**, not `default | auto | approve-all`: the directive
  wire is a SET and `auto` is Claude's word (`directive-set-mode.test.mjs` pins "no word is shared"). `autoMode`
  is the `_meta` flag's own name. Windowless floor `autoMode`.
- **No `authenticate` at all** (not even with `cached_token` offered): `session/new` works without it (§6).
  `credentialState` is the file's presence; the handshake's missing `cached_token` is the auth hold.
- **The hook asks the gate only for Dopl MCP calls.** A built-in Grok never asks about (`read_file`) would
  park a card nobody consumes; built-ins get only the instant containment verdicts (deny list; on read_only /
  dopl_only any built-in outside `native.hookAllow`). A truncated hook input is never judged.
- **`login.js` is the pty flow, measured**: `grok login --device-auth` prints
  `https://accounts.x.ai/oauth2/device?user_code=XXXX-XXXX` + the code, polls, exits 0 with `$GROK_AUTH_PATH`
  written (`test/fixtures/grok/login-device-auth-1.0.52.txt`). Run under `script -q /dev/null`.
- **`shape.js` = the `initialize` answer** (in a throwaway home): ACP v1 baseline methods + `session/load` iff
  `loadSession`, field paths with `false` leaves absent, `hooks blockingEvents/decisions` + auth method ids
  as values.
- **`update-source.js`**: no digest published → `updates/registry.js › downloadMeasured` (size ceiling, sha256
  + md5 as the bytes land), the response's own `x-goog-hash` md5 checked (transport), `{version,url,sha256,size}`
  recorded as `<root>/grok.sha256.json`.

LIVE in the build's own live tier (grok 1.0.52, 2026-10-13, ≈9 prompts on `grok-4.7-build-fast`):
- isolation via `grok inspect --json` in Dopl's env: only Dopl's `config.toml` as a permission source, MCP
  allow-list `name:dopl_session`, project `.mcp.json` disabled, untrusted folder, no hooks/plugins, every compat
  cell off, `XAI_API_KEY` stripped;
- the Dopl MCP permission round-trip in `default` AND `autoMode` (ask rule) — gate asked once by
  `mcp__dopl_session__post_message` with its own args, held in `request_permission`, then run; headers
  verbatim on every MCP request (`Authorization`, `X-Dopl-Vendor: grok`, `X-Dopl-Runtime`); the hook reports
  `permissionMode: "auto"`;
- per-session model read back; **effort as a plain string (`low`) accepted** (S4 closed); usage summed; context
  window 256 000;
- resume via `session/load` — ⚠ **only in the SAME cwd** (another folder: `-32603 "Path not found."`; Dopl's
  spawn dir is per channel, so a real resume uses the same one); replay dropped; live model switch; interject
  folded into the running turn; cancel → prompt resolved promptly.
- ⚠ **`grok agent` DELETES `$GROK_HOME/requirements.toml` during `initialize`** (F-775); Dopl rewrites it before
  every spawn. In an untrusted folder the agent starts no project `.mcp.json` server with or without it.
- ⚠ **An interjection that lands after the turn ended runs as Grok's OWN turn** (`prompt_id
  "interject-fallback-…"`), and **a `session/prompt` sent mid-turn is QUEUED** (it runs after a cancel). So
  `queued` is final (never re-sent), a turn Grok starts itself renders and ends on `_x.ai/session/prompt_complete`,
  and Stop cancels it too. The `_x.ai/session/interjection` confirmation can precede the interject's answer.

**Sandbox/binary smoke, 2026-10-14** (grok 1.0.52, branch `runtime/grok-smoke`, ≈18 real turns on
`grok-4.7-build-fast`; redacted recordings in `dopl-desktop-app/test/fixtures/grok/smoke-s5b-*`, `-s5c-*`,
`-s10-*`, `-s11-*`; the probe drivers were throwaway scripts in the session scratchpad):
- **S5b — LIVE.** Hook `toolName` / rawInput: `list_dir {target_directory}`, `grep {pattern, path}`,
  `search_replace {file_path, old_string, new_string}` (asks in `default`; permission rawInput `variant:
  "SearchReplace"` + `replace_all`), `web_fetch {url}` (`read_only: true` yet ASKS), `spawn_subagent
  {description, prompt, background}` — every id as `tools.js` assumed. ⚠ **`web_search` ran on xAI's BACKEND**
  (`tool_call` id `ws_…`, rawInput `{variant:"WebSearch", backend:true}`) with **no hook** — a restricted
  profile's deny could not hold. Fix: `config.toml [features] backend_tools = false` → `web_search {query}` is
  the client tool, through the hook (deny fails that call; allowed, it answers — S5c/S5d). Subagent tools beyond
  `spawn_subagent` not exercised (denied on every profile).
- **S10 — LIVE: a prompt `/always-approve on` DOES toggle always-approve over ACP** (no model call; the next
  `search_replace` ran with no permission request), and `_x.ai/sessions/changed` still said `yolo: false`. With
  the word joiner it went to the model as chat and nothing changed. Kept the joiner (now also before leading
  zero-width characters) and added the readback that sees it: the hook's `permissionMode` read
  `bypassPermissions`; anything but `default`/`auto` is denied and the session stopped (F-778).
- **S11 — LIVE.** Fail-open at the group timeout (3 s group, reply held 9 s → the call ran). A reply held 40 s
  under the 600 s group then `deny` → only that call failed, turn `end_turn`. `updatedInput` in a reply is
  IGNORED (output unchanged). Permission options are only `allow_once`/`reject_once`/`allow_always`; a
  `cancelled` outcome ends the turn (`PermissionCancelled`). ⇒ F-777 fixed by holding the hook (§3).
- **S12** — moot (subagents denied on every profile; the hook denied `spawn_subagent` live).
- **S13 — shape recorded.** `_x.ai/auth/get_url {}` (signed out) → `{auth_url: null, external_provider: false,
  mode: null}`; `x.ai/auth/get_url` (no underscore) → `-32601`. It READS a flow already started — by
  `authenticate`, which Dopl never calls (browser OAuth that never answers) — so `signIn` stays the pty
  `grok login --device-auth`. No sign-in was started.
- **S14 — not possible copy-free.** A bogus `auth.json` in a probe home is not offered as `cached_token`
  (two shapes tried), and an external auth provider is a different path (`grok.com` with
  `_meta.external_provider`); both stop at `session/new` with the already-mapped `-32000 "Authentication
  required"`. True mid-session expiry needs Samuel's own `auth.json` changed — not done.
- **S15 — LIVE, no guard needed.** `session/load` in a new process with a rotated bearer (`tok-A` → `tok-B`):
  every MCP request of the resumed session (`server/discover`, `initialize`, `GET`, `tools/list`, `tools/call`)
  carried `tok-B`; none carried `tok-A`.
- **S16 — LIVE: `requirements.toml` IS applied before `grok agent` deletes it** (F-775 resolved). Folder trust
  off (`GROK_FOLDER_TRUST=0`): a project `.mcp.json` http server started without the file and not with it.
  `[features] managed_config = false` does not stop the deletion.

Still open: **S17** (the in-app sign-in end to end in the packaged app: download on demand → `grok login
--device-auth` → installed `auth.json` → first launch) and **S18** (a real Dopl MCP server — the stub stood in
for it — and a windowless launch's settled deny in the hook) — run separately (screenshot checks).

## 1. Verdict

**Build it on ACP (`grok agent --no-leader stdio`). "Can Grok do headless?" — yes, `grok -p` exists, but it
cannot hold an approval**: in non-interactive mode a call the policy would ask about is cancelled or fails
(`22-permissions-and-safety.md` › Auto-review mode, SRC), or everything is approved with `--always-approve`.
Either way Dopl's outbound gate is off → `contract.js › LAUNCH_BLOCKING[0]` refuses it. ACP gives what headless
cannot: a held `session/request_permission` round trip (LIVE), a synchronous client `PreToolUse` hook (LIVE),
cancel, interject, load-after-restart, live model switch. It is a Codex-shaped adapter (process + JSON-RPC over
stdio), so it reuses the same kit modules as Muse. (`grok agent headless` is a WebSocket relay, unrelated.)

## 2. Slot-by-slot map (scaffold §4.1 → Grok)

| Slot (file) | Grok / ACP mechanism | Kit module | Vendor code the adapter writes | Status |
|---|---|---|---|---|
| `index.js` | — | — | canonical key order, delegation | — |
| `client.js` | spawn `<bin> agent --no-leader stdio` (flag order matters: agent options go BEFORE `stdio`); NDJSON JSON-RPC 2.0; ext methods are wire-prefixed `_x.ai/…` (`x.ai/models/list` → `-32601`; `_x.ai/models/list` works) | `stdio-rpc.js › connect`, `probe-bin.js › makeProber` | server-request router: `session/request_permission`, `_x.ai/hooks/run` | LIVE (`g2-init-new.ndjson`) |
| `protocol.js` | `REQUIRED_METHODS`: `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel` (notification), `session/set_config_option`, `session/close`, `_x.ai/interject`; server→client `session/request_permission`, `_x.ai/hooks/run` | — | version gate = `initialize.result.protocolVersion === 1` + `_meta.agentVersion` | LIVE |
| `tools.js` | modes are session `_meta` flags, not ACP modes (`session/new` returns NO `modes`, LIVE); built-in tool ids below | — | `TOOL_MODES`, containment table in Grok ids | LIVE |
| `axis-b.js` | `held-callback`: `session/request_permission`, forced for Dopl MCP by a private-config ask rule; plus client `PreToolUse` hook for synchronous verdicts | `../held-gate.js › makeHeldGate` (no options) | §3 | LIVE |
| `approval.js` | reply `{outcome:{outcome:"selected", optionId}}`; options seen: `allow-once`/`allow_once`, `reject-once`/`reject_once`, `always-allow`/`allow_always` (the last disappears with `remember_tool_approvals=false`) | — | never pick `allow_always`; unwrap `use_tool` | LIVE (`smoke-s1`, `smoke-s2`) |
| `policy.js` | — (no native per-thread policy echo; mode fixed at `session/new`) | — | — | LIVE |
| `launch-spec.js` | `session/new {cwd, mcpServers, _meta:{autoMode?, "x.ai/hooks"}}` then `session/set_config_option` model + effort | `../cli-spawn.js › scrubbedEnv` | env + private home + per-session `_meta` | LIVE |
| `launch-handle.js` | frames = `session/update` + `_x.ai/*` notifications; interrupt = `session/cancel` notification | `frame-queue.js`, `run-handle.js`; `boundedInterrupt` | interrupt/close policy | LIVE |
| `normalize.js` | §4 | `usage.js › tokensFrom` (no `cached`), `auth-shape.js › authShaped` | replay suppression on load | LIVE |
| `models.js` | `_x.ai/models/list` (result is double-wrapped `{result:{result:{currentModelId, availableModels}}}`) or `session/new.result.models` | `model-arg.js › passThroughModelArg` | `pick.pattern ^grok-`; effort dimension | LIVE |
| `mcp.js` | `session/new.mcpServers:[{type:"http", name:"dopl_session", url, headers:[{name,value}]}]`; headers reach the server verbatim | `dopl-mcp.js › doplBearer`, `clientTimeoutMs` | stamp `X-Dopl-Runtime`, `X-Dopl-Vendor: grok` | LIVE (`smoke-s1-mcp-server.log`: Authorization + X-Dopl-Runtime present on all 42 requests) |
| `credential.js` | `auth.json` at `GROK_AUTH_PATH`; `initialize.authMethods` lists `cached_token` only when a token exists | — | §6 | LIVE |
| `login.js` | pty `grok login --device-auth` in a throwaway home (Muse pattern) | `private-home.js › installFile` | URL/code scrape, cancel | SRC (Samuel ran it by hand, 2026-10-13) |
| `config-home.js` | `HOME` **and** `GROK_HOME` → private dirs; Dopl-written `config.toml` + `requirements.toml` | `private-home.js` | §8 fences | LIVE |
| `resolve-bin.js` | `DOPL_GROK_BIN` override → downloaded build | `bin-resolve.js › makeResolver` (`bundledCandidate` → `null`) | — | — |
| `identity.js` | `grok version --json` → `{"currentVersion":"1.0.52 (0920c8169e27)","channel":"unknown"}`; account from `authenticate` `_meta` (`auth_mode`, `subscription_tier`) | — | parse | LIVE |
| `required-shape.js` + `shape.js` | build's self-description = `initialize` result (`agentCapabilities`, `_meta["x.ai/hooks"]`, `x.ai/mcp/sdk`) | — | tiered required fields | LIVE |
| `update-source.js` | `https://x.ai/cli/stable` (text `1.0.52`) → `https://x.ai/cli/grok-<ver>-macos-<aarch64|x86_64>` | shared `../updates` | §7 | LIVE |
| `packaging.js` | `delivery:'path'` + on-demand download | — | — | — |
| `launch-verify.js` | optional: `session/new.result.configOptions` echoes model/effort; `_meta["x.ai/sessionConfig"]` | — | asked-vs-running | LIVE (shape only) |
| `operator-tools.js` | later (would need `allowed_mcp_servers` widened per operator server) | — | — | — |
| EXTRA | `hook-gate.js` (the `_x.ai/hooks/run` answerer), `replay.js` if normalize > cap | — | — | — |

## 3. The four contract refusals (`contract.js › LAUNCH_BLOCKING`)

**[0] Axis B — `enforcementPoint: 'held-callback'`.** Measured per mode (`smoke-s1-modes.ndjson`, stub server
with `post_message` + read-only `read_channel`, server name `dopl_session`):

| Session mode (`session/new._meta`) | `request_permission` for Dopl MCP tools? |
|---|---|
| none (= `default`, "ask") | **yes, both tools** (even `readOnlyHint` ones) — LIVE |
| `autoMode: true` | **no** — the classifier ran `post_message` silently — LIVE |
| `yoloMode: true` | **no** — LIVE |
| `autoMode` + private config `[permission] ask = ["MCPTool(dopl_session__*)"]` | **yes** — LIVE (`smoke-s2`) |
| `yoloMode` + that ask rule + `requirements.toml [ui] disable_bypass_permissions_mode = true` | **no — the lock does NOT stop `_meta.yoloMode`**, post ran unasked — LIVE (`smoke-s2`, `yolo-under-lock`) |

So: the ask rule is mandatory (it is what makes Axis B hold under `auto`), and **Dopl must never send
`yoloMode`** (nothing in Grok backstops it). Prior spec §3.3 "full → yoloMode" is wrong.

Two details the gate must handle (LIVE):
- MCP tools are deferred: the model calls `search_tool` then `use_tool {tool_name:"dopl_session__post_message",
  tool_input}`. The permission request's `toolCall.title` is the resolved name, `rawInput` is
  `{variant:"UseTool", tool_name, tool_input}`, `_meta["x.ai/tool"].name` is `use_tool`. `approval.js` names the
  call from `rawInput.tool_name`, the gate's args are `rawInput.tool_input`.
- **`reject_once` ends the whole turn**: `stopReason:"cancelled"`, `_x.ai/session/prompt_complete`
  `cancellationCategory:"PermissionRejected"` (`smoke-s2`). A hook `deny` instead fails only that tool
  (`"Hook denied: <msg>"`) and the turn continues.

Hence the split (the client hook is advertised in `initialize._meta["x.ai/hooks"]`, registered per session with
`session/new._meta["x.ai/hooks"] = {PreToolUse:[{matcher:"*", hookCallbackIds:["dopl_gate"], timeout:600}]}`):
1. `_x.ai/hooks/run` arrives for EVERY tool before permission rules, in every mode, including read-only tools
   (`read_file`) and with `use_tool` already resolved (`toolName:"dopl_session__post_message"`, `toolInput`
   = the use_tool wrapper) — LIVE. Params: `{hookCallbackId, hookEventName:"pre_tool_use", sessionId,
   permissionMode, toolName, toolUseId, toolInput, toolInputTruncated, cwd, transcriptPath, …}`.
   Reply `{decision:"continue"|"deny", systemMessage}`.
   **It fails OPEN** on timeout (default 30 s, per-group max 600 s), transport error, malformed reply, or
   `decision:"ask"` (SRC `xai-grok-shell/src/session/acp_session/hooks.rs › fail_open`). So the hook answers
   containment (hard-deny, `denyList`) at once, and for a Dopl MCP call WAITS on the gate up to
   `policy.HOOK_HOLD_MS` (570 s, under the 600 s group timeout): allow → `continue`, deny (settled or the
   operator's) → `deny` with the sentence, turn continues (LIVE S11: a reply held 40 s was honoured, F-777).
   Still parked at the hold → `continue` and remember `toolUseId`. A hook `permissionMode` other than
   `default`/`auto` (`bypassPermissions` after a slash-command switch, LIVE S10) → deny + stop the session.
2. `session/request_permission` (no timeout, ACP) is where a PARKED decision waits for the operator. Its
   `toolCall.toolCallId` equals the hook's `toolUseId` (LIVE), so a call the hook already settled is answered
   `allow_once` at once without re-asking the gate.
`opScoped: true`; `inputRewrite: null` (a client-hook reply's `updatedInput` is IGNORED — LIVE S11, 2026-10-14).
Fallback not needed: `x.ai/mcp/sdk` (`_meta["x.ai/mcp/sdk"]: true`) in-process tools remain an option if a
later build stops prompting.

**[1] Containment deny lists** — enforced in the hook (works for tools that never prompt, e.g. `web_search`,
`read_file`; subagents inherit parent hooks, SRC `client_hooks_tests.rs › subagent_inherits_parent_pre_tool_use_client_hook`).
`denyList` === `toolConfigFor(p).disallowedTools` in Grok ids (§5).

**[2] `usageResetsOnResume: true`** — LIVE (`smoke-s3-resume-steer.ndjson`): usage is reported per prompt
(`session/prompt` result `_meta.usage`, and `_x.ai/session/update` `turn_completed.usage`); after a process
restart + `session/load`, the next prompt's usage is that prompt only (17 668 tokens, 1 model call), while
`_meta.totalTokens` (context occupancy) continued (17 622 → 17 676). Dopl's cumulative counter is Dopl's own
sum of per-prompt deltas, so each process starts from zero.

**[3] `windowlessFloor: 'auto'`** — `autoMode` + the Dopl ask rule: routine local work proceeds, Dopl MCP still
reaches the gate (which, windowless, settles or denies per core rules).

## 4. Event mapping → core events (`runtime/events.js`)

Observed `session/update` kinds over the smoke (LIVE): `agent_message_chunk`, `agent_thought_chunk`,
`tool_call`, `tool_call_update`, `available_commands_update`, `session_info_update` (title),
`user_message_chunk` (load replay only), `config_option_update`. Notifications: `_x.ai/session_notification`
(`model_changed`, `hook_annotation`, …), `_x.ai/session/setup` (phases), `_x.ai/session/prompt_complete`,
`_x.ai/session/update` (`turn_completed` + usage), `_x.ai/mcp/server_status`, `_x.ai/mcp_initialized`,
`_x.ai/mcp/servers_updated`, `_x.ai/queue/changed`, `_x.ai/sessions/changed`, `_x.ai/models/update`,
`_x.ai/settings/update`, `_x.ai/announcements/update`, `_x.ai/session/interjection`.

| Grok frame | Core event |
|---|---|
| `session/new` / `session/load` result `sessionId` + `configOptions[model].currentValue` | `launched {sessionId, model, mcpServers}` — mcpServers from `_x.ai/mcp/server_status {name, status:"ready"}` (else `null`) |
| `agent_message_chunk` (accumulate; flush on `tool_call` and at prompt result) | `assistant {text}` |
| `agent_thought_chunk` | `thinking {text}` |
| `tool_call {toolCallId, title, rawInput, _meta["x.ai/tool"]{name, kind, read_only}}` | `toolCallEvents` — name = `rawInput.tool_name` when `x.ai/tool.name === "use_tool"`, else `x.ai/tool.name` |
| `tool_call_update status completed / failed` | `tool_result {toolUseId, ok: status==="completed"}`; hook denies arrive as `failed` + `"Hook denied: …"` |
| `session/prompt` result `{stopReason, _meta}` | `result {sessionTokens: running sum, model: _meta.modelId}` + `context {tokens: _meta.totalTokens, window}` |
| `stopReason:"cancelled"` (+ `cancellationCategory` `MidTurnAbort` / `PermissionRejected`) | `result` (turn over) |
| JSON-RPC `-32000 "Authentication required"` (data `"no auth method id provided"`) | `auth_hold` |
| `_x.ai/mcp/server_status` | `mcp_status_report` |
| frames between `session/load` request and its result (`user_message_chunk`, replayed `agent_message_chunk`) | **drop** (replay; LIVE — the old "OK" came back on load) |
| `plan`, `available_commands_update`, `config_option_update`, `session_info_update`, the `_x.ai/*` chatter | drop |

**Tokens** (LIVE, `smoke-s1..s3`): per-response keys at `_meta.inputTokens/outputTokens/cachedReadTokens/
reasoningTokens`; per-prompt aggregate at `_meta.usage {inputTokens, outputTokens, totalTokens,
cachedReadTokens, cacheCreationTokens, reasoningTokens, modelCalls, costUsdTicks, modelUsage{…}}`. Feed
`usage.js › tokensFrom` with `{input:['inputTokens'], output:['outputTokens'], total:['totalTokens']}` from
`_meta.usage`, **no `cached`**: `cachedReadTokens` is a subset of `inputTokens` (17 792 ≤ 17 896), not
additive. Total is per prompt → sum it; do not use `makeUsageCarry`. Null-not-0 when `_meta.usage` is absent
(a turn cancelled before any model call).

**Context window**: from the LIVE roster's `availableModels[]._meta.totalContextTokens` — 256 000 for
`grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5` (2026-10-13). The pre-auth offline roster says
`grok-4.6` = 500 000 (`g2-init-new.ndjson`) — **do not use the unauthenticated roster** (it is a built-in
fallback, log: `had_real_catalog:false`). Prior spec's "grok-4.6 = 500k" is the fallback value.

## 5. Axis A — Ask / Auto / Full

Grok has no ACP session modes on this build (`session/new` result keys: `sessionId, models, configOptions,
_meta`, LIVE); `session/set_mode` on an unknown id never answered (LIVE, `g3-auth-shapes.ndjson`). The mode
is fixed at `session/new` by `_meta`:

| Level | `tools.TOOL_MODES` value | What Dopl sends | Effect |
|---|---|---|---|
| ask | `default` | no mode flag | every non-read-only call → `request_permission` → Dopl surface |
| auto | `auto` | `_meta.autoMode:true` | classifier; escalations + every Dopl MCP call (ask rule) → `request_permission` |
| full | `approve-all` (`native:false`) | no mode flag | Dopl's `approval.js` answers every NON-Dopl request `allow_once` at once; Dopl MCP still goes to the gate. **Never `yoloMode`** (§3). |

`default` and `approve-all` share a native mode, so Ask⇄Full can switch live (Dopl-side policy); Auto needs a
new session. Read-only built-ins never prompt in any mode (`read_file`, `list_dir`, `grep`, `web_search`,
`todo_write`, skills — SRC `22-permissions-and-safety.md`), so egress via `web_search` is a CONTAINMENT
(hook) concern, not an approval one.

**Built-in tool ids** (for deny lists): LIVE — `run_terminal_command` (kind `execute`), `read_file` (`read`,
read_only), `write` (kind `write`, namespace `opencode`), `search_tool`, `use_tool` (MCP dispatch); LIVE
2026-10-14 (S5b) — `list_dir` (`list`), `grep` (`search`), `search_replace` (`edit`, asks), `web_fetch`
(`web_fetch`, read_only but ASKS), `web_search` (client tool only with `[features] backend_tools = false` — the
backend variant never reaches the hook), `spawn_subagent` (`task`). SRC/docs — `write_file`,
`send_subagent_message`, `get_command_or_subagent_output`, `kill_command_or_subagent`, `todo_write`,
`ask_user_question`, `exit_plan_mode`, `task_complete`. `echo`/`sleep` shell commands never ask in `default`
(Grok's safe-command list), so a shell `echo` is no permission probe.

## 6. Credential — the subscription, Dopl-owned

Target (Samuel, 2026-10-13): the user's SuperGrok / X Premium sign-in through Grok's own login, stored in a
Dopl-private file; env keys stripped. Facts:
- `auth.json` location = `GROK_AUTH_PATH` (LIVE: every smoke ran with `GROK_HOME` = a fresh home and
  `GROK_AUTH_PATH` = the login home's file). Precedence (SRC `02-authentication.md` › Auth Precedence):
  per-model `api_key` > session token > `XAI_API_KEY`. Add `XAI_API_KEY`, `GROK_CODE_XAI_API_KEY` (both strings
  are in the binary) to `cli-spawn.js › INHERITED_CREDENTIAL_ENV`.
- `credentialState`: usable ⇔ Dopl's `auth.json` exists AND `initialize.authMethods` contains `cached_token`
  (absent file → only `grok.com` advertised, LIVE `g2`; present → `cached_token` + `grok.com`, LIVE `smoke-s1`).
  `authenticate {methodId:"cached_token"}` then returns account `_meta` (`auth_mode:"Oidc"`,
  `subscription_tier`, email, team fields) → `identity.account`.
- ⚠ **Never call `authenticate` when `cached_token` is not advertised.** LIVE (`g3-auth-shapes.ndjson`, log
  `auth cached_token fallthrough → fallback grok.com → inline auth flow, use_oauth:true`): with no token it
  silently starts the browser OAuth flow and the request never answers. A session that hits `auth_hold` must
  not self-heal by calling it.
- With a token present, `session/new` works without an `authenticate` call (LIVE, `smoke-s2`/`s3`).
- `signIn` (`login.js`): pty `grok login --device-auth` with HOME/GROK_HOME/GROK_AUTH_PATH = a throwaway login
  home; scrape the verification URL + code; on exit 0 install that `auth.json` into the private home with
  `private-home.js › installFile` (0600), exactly the Muse flow. ACP also has `_x.ai/auth/get_url` /
  `_x.ai/auth/submit_code` (SRC `15-agent-mode.md`); LIVE S13: signed out, `get_url` answers `{auth_url:null,
  external_provider:false, mode:null}` — it reads a flow `authenticate` started, so it is not a pty-free
  replacement while Dopl never calls `authenticate`.
- `signOut`: `grok logout` under the same env, then remove the file.
- Refresh: Grok refreshes the OIDC token in place and re-reads `auth.json` on change (SRC) → the file must stay
  writable by the child.

Sandbox sign-in command (what Samuel ran; keep for re-sign-in on another machine):
```
SB=/private/tmp/claude-501/-Users-samuelwang/71c73b57-c34b-4784-b0bc-53923490258f/scratchpad/grok-home
env -i PATH=/usr/bin:/bin HOME=$SB/login-home GROK_HOME=$SB/login-home/.grok \
  GROK_AUTH_PATH=$SB/login-home/.grok/auth.json GROK_DISABLE_AUTOUPDATER=1 \
  $SB/bin/grok login --device-auth
```

## 7. Binary

- Pointer `https://x.ai/cli/stable` → `1.0.52` (last-modified 2026-10-12); artifact
  `https://x.ai/cli/grok-1.0.52-macos-aarch64`, 172 237 072 bytes, sha256
  `c2caa9895dd763297a75e8fb6077e175d9c5304c53903e52cff8891a1384bbb9`, GCS headers `x-goog-hash md5/crc32c`
  (2026-10-13). Mach-O arm64, hardened runtime, `Developer ID Application: X.AI Corporation (5Y6N3AJ54S)`,
  identifier `xai-grok-pager`, notarization not checked (`spctl` rejects it only as "not an app").
- x.ai publishes **no checksum manifest** and `install.sh` verifies nothing, so — as for Muse — the proof is the
  signature: `update-source.js` requires team `5Y6N3AJ54S` on the candidate and records its own sha256 + size;
  the `x-goog-hash md5` header is a transport check only (same origin as the file).
- Update source = the `stable` pointer; compatibility = the candidate's `initialize` shape against
  `required-shape.js`, never a version range. Auto-update off: `GROK_DISABLE_AUTOUPDATER=1` +
  `[cli] auto_update=false` (no updater lines in `logs/unified.jsonl`, LIVE; not packet-verified).
- Licence: `xai-org/grok-build` is Apache-2.0 (`gh api repos/xai-org/grok-build --jq .license.spdx_id`),
  so bundling is legally possible, but the shipped binary is xAI's signed build (separate download terms not
  reviewed) and is 172 MB. **Recommend download-on-demand like Muse** (`delivery:'path'`, `onDemand`, fetched
  when the operator signs in to Grok), not bundling.

## 8. Isolation fences (all LIVE via `grok inspect --json`, `g4-inspect-*.json`)

| Leak | Compat env flags off? | Fence |
|---|---|---|
| `~/.claude/settings.json` **permission rules + `defaultMode`** (an operator `allow: mcp__dopl_session__*` would bypass the gate) | **still loaded** (4 rules from a sandbox `~/.claude/settings.json`, `g4-inspect-home-claude.json`) | `HOME` → private dir (mandatory; prior spec §3.5 S7 answered) |
| `~/.claude.json` MCP, `~/.claude/CLAUDE.md`, `~/.claude` hooks | disabled by `GROK_CLAUDE_*_ENABLED=false` | flags + private HOME |
| foreign sessions scan | `GROK_{CLAUDE,CURSOR,CODEX}_SESSIONS_ENABLED=false` works | set them |
| project `.mcp.json` (cwd = the operator's repo) | **active** regardless of flags | `requirements.toml`: `enable_all_project_mcp_servers = false` + `[[allowed_mcp_servers]] server_name = "dopl_session"` → `disabledReason: "not in allowedMcpServers"`, Dopl's own server still connects (`smoke-s2`) |
| project `.claude/settings.json`, `.grok/hooks`, project instructions | gated by folder trust; a fresh private home trusts nothing (`projectTrusted:false`, rules not loaded) | never grant trust from Dopl |
| Claude managed settings `/Library/Application Support/ClaudeCode/managed-settings.json` | read from the system path | cannot be fenced; MDM-only, document |
| leader process / socket | `--no-leader`: no socket created (LIVE) | always pass it |
| remembered "always allow" grants (satisfy ask rules) | — | `[ui] remember_tool_approvals = false` (removes the `allow_always` option, LIVE) |
| telemetry | — | `[features] telemetry = false`, `GROK_TELEMETRY_ENABLED=0` (SRC) |

`GROK_HOME` is honoured (LIVE: with `HOME≠GROK_HOME` nothing was written under HOME). A failed `session/new`
still creates a session dir (orphan, LIVE) — harmless in a private home. Private `config.toml` +
`requirements.toml` as Dopl writes them: `g4-inspect-dopl-config.json`, `g4-inspect-dopl-requirements.json`.
⚠ A prompt text `/always-approve on` DOES toggle the mode over ACP (LIVE S10, 2026-10-14; the requirements
lock did not stop it, and the `yolo` readback stays false) — prompt framing never sends a prompt that starts
with `/` (word joiner, LIVE-verified), and the hook's `permissionMode` readback stops a session that switched.

## 9. Cross-tree edits (same list as Muse, scaffold §4.4)

1. `main/runtime/index.js` — `register(require('./grok'))` AFTER muse (append; order is load-bearing);
   `UPDATE_SOURCES` += `require('./grok/update-source')`.
2. `cli-spawn.js › INHERITED_CREDENTIAL_ENV` += `XAI_API_KEY`, `GROK_CODE_XAI_API_KEY`; `scrubbedEnv` prefix
   `/^GROK_/` + knob regex (strip every inherited `GROK_*`, then set Dopl's).
3. `test/runtime-vocab-cross-tree.test.mjs › RUNTIMES` += `grok`; tool-mode words `default`, `auto`,
   `approve-all` in `src/features/channels/schema-launch-modes.ts`, `packages/contracts/src/directives.ts`,
   `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`; a migration widening
   `channel_launch_directives.applied_tool_mode` CHECK.
4. `X-Dopl-Vendor` word `grok` in `src/shared/auth/runtime-header.ts` + hand copy in
   `packages/mcp-server/src/tools/identity.ts › toolLoaderFor`.
5. Fixture suites `grok-normalize`, `grok-gate`, `grok-client-transport` from the recordings above; scaffold
   test census row; INVARIANTS §11.0 subsection (never `yoloMode`; hook fails open → synchronous only).

## 10. Real-model smoke — done and open

Done 2026-10-13 (LIVE, `smoke-s*.ndjson`): S1 permission per mode (§3 table); S2 reject → turn cancelled; S4
update kinds + usage; S5 partial tool ids/rawInput (`run_terminal_command {command, description}`,
`read_file {target_file}`, `write {file_path, content}`, `use_tool {tool_name, tool_input}`); S8 load after
restart (works, replays history, usage per prompt); S9 `_x.ai/interject {sessionId, text}` → `{status:
"queued"}` + `_x.ai/session/interjection`, applied inside the running turn (reply ended "BANANA") → **steer:
true**; cancel = `session/cancel` NOTIFICATION → prompt resolves immediately `stopReason:"cancelled"`,
`cancellationCategory:"MidTurnAbort"` (as a request it is `-32601`); model switch live via
`session/set_config_option {configId:"model", value:"grok-4.7-build-fast"}` and `session/set_model` →
`liveModelSwitch: true`. Effort: `{configId:"reasoning_effort", value:{value:"low"}}` (the docs' shape) is
REJECTED (`-32602 untagged enum`); send the plain string (SMOKE: confirm `value:"low"` is accepted). The
`-m` flag on `grok agent` did not take (session reported `grok-4.7`) → always set the model per session.

Done 2026-10-14: S5b, S10, S11, S13 (shape), S15, S16 — results in §0. S12 moot; S14 not possible without
touching the operator's `auth.json`. Open: S17, S18 (packaged app, run separately).

## 11. Effort vs Muse

About the same as Muse, slightly less transport work and slightly more gate work. Same kit modules
(`stdio-rpc`, `frame-queue`, `run-handle`, `usage`, `auth-shape`, `dopl-mcp`, `private-home`, `bin-resolve`,
`probe-bin`, `model-arg`, `held-gate`); ACP is a published protocol with stable method names, and steer,
cancel, resume and live model switch are all already measured. The extra is the two-channel gate
(`hook-gate.js` + `approval.js` sharing a `toolUseId` memo, `use_tool` unwrap) and the larger fence set
(`HOME` + two Dopl-written TOML files). Estimate: Muse's file count (≈20 files) plus one EXTRA; fixtures
already exist.
