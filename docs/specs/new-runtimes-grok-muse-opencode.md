# New runtimes: Grok Build, Muse Code, OpenCode

Status: SPEC; **Muse BUILT 2026-10-13 (§4.0)**, Grok and OpenCode not started. Research date 2026-10-13 (all vendor versions/counts measured that day). Nothing installed or run; every vendor claim
below is from source/docs reading and the "smoke" items are the open ones.

## 0. TL;DR

| | Grok Build (xAI) | Muse Code (Meta) | OpenCode V2 (anomalyco) |
|---|---|---|---|
| Embed surface | ACP `grok agent stdio` (JSON-RPC/stdio) | MSP `muse serve` (JSON-RPC/stdio) | `opencode serve --stdio` → HTTP + SSE |
| Closest Dopl template | Codex (proc + frame queue) | **Codex, near 1:1** | Codex proc + new HTTP/SSE client |
| Axis B (held gate) | `session/request_permission` ✅ (smoke: fires for MCP tools in every mode) | `approval/requested` → `approval/decide` ✅ | `permission.asked` → `.../reply` ✅, forceable per tool via ask rule |
| Steer mid-turn | ❌ (`x.ai/interject` ext, smoke) | ✅ `turn/steer` | ✅ `delivery:"steer"` |
| Interrupt | ✅ `session/cancel` | ✅ `turn/interrupt` | ✅ `.../interrupt` |
| Resume | ✅ `session/load`/`resume` | ✅ `session/resume` | ✅ (sessions persist in its DB) |
| Tokens | ✅ per response + `_meta.usage` | ✅ `session/tokenUsage` | ✅ `session.step.ended.tokens` |
| Context window | from model roster (grok-4.6 = 500k) | smoke | models.dev catalog |
| Auth Dopl can own | API key or device-auth into isolated `GROK_HOME` | API key (`META_API_KEY`) or browser sign-in | provider API keys in its DB; **never** Claude Pro/Max OAuth |
| Binary | closed? no — Apache-2.0, signed? smoke; no checksum in install.sh | closed binary, MIT SDK | MIT, npm `@opencode/cli` |
| Churn | weekly stable | lockstep CLI/SDK, "developer preview" | **2.0.0 on 09-11, 29 releases since**, routes marked experimental |
| Recommended order | **1st** (what Samuel asked for) | **2nd** (cheapest build: Codex clone) | **3rd**, once V2 API settles (long-tail models incl. Grok + Muse via API key) |

Grok "Grok Bot" (the hosted teammate product) has no public API → out of scope.

## 1. What Dopl actually consumes (the bar to match)

From the adapter contract (`dopl-desktop-app/main/runtime/contract.js`) and the downstream trace.
A new runtime only has to produce these; everything else may be dropped.

| Core event (`runtime/events.js`) | Used for | Required? |
|---|---|---|
| `launched {sessionId, model, mcpServers}` | session id persisted before reducer (`session-io.js › applyCoreEvents`) → resume; model pill; Dopl MCP status (`null` = unreported, OK) | **yes** |
| `assistant {text}` | narration (whole block, not streamed, cap 8000); directed-reply capture | **yes** |
| `thinking {text}` | narration, collapsed | optional |
| `tool_use {toolUseId,name,inputSummary,inputFull}` / `outbound_post` via `toolCallEvents()` | generic "Used N tools" card; own-channel post box; idle TTL re-arm | **yes** |
| `tool_result {toolUseId, ok, resultSummary}` | card completion | **yes** |
| `result {sessionTokens (cumulative), model}` | turn count, `tokensSpent`, presence idle/awaiting_peer | **yes** |
| `context {tokens, model, window}` | context % bar (null window = empty bar) | strongly wanted |
| `auth_hold {text}` | re-sign-in prompt | **yes** |
| `shape_drift`, `mcp_status_report`, `runtime_outdated` | diagnostics | optional |

Ignored by Dopl today (drop freely): text/reasoning deltas, cost, rate limits, plan/todo, diffs,
images, subagent trees, compaction notices. No per-kind tool rendering exists, so tool arg shapes
only need a readable `inputSummary`.

## 2. Contract obligations every new adapter must meet

Module `main/runtime/<id>/index.js` exporting `{ descriptor, runtime }`, sealed at require time.

- **All 19 runtime methods** with exact arity (`contract.js › RUNTIME_METHODS`); absent capability → method
  returns `null`.
- **Four refusals** (`contract.js › LAUNCH_BLOCKING`):
  1. `axisB.enforcementPoint` non-null — held callback or in-process tool boundary. Headless JSON
     modes can never satisfy this.
  2. every restricted containment profile has a `denyList` === `toolConfigFor(p).disallowedTools`.
  3. `session.usageResetsOnResume` ≠ `'unverified'` or resume is refused.
  4. `toolMode.windowlessFloor` non-null or windowless launch is refused.
- `toolMode.levels {ask, auto, full}` monotone (`permission-level.js › levelProblems`).
- `models.pick.pattern` present; declared dimensions (effort) have options.
- Env scrub via `cli-spawn.scrubbedEnv` + vendor knob strip; private config home.
- Files `.js` only, ≤500 lines each (eslint cap).

**Cross-tree edits per new runtime id** (from the conformance suites):
- `main/runtime/index.js` (`register(...)` block) — `register(...)`, and `UPDATE_SOURCES` if self-updating.
- `test/runtime-vocab-cross-tree.test.mjs › RUNTIMES` + every tool-mode word in:
  `src/features/channels/schema-launch-modes.ts`, `packages/contracts/src/directives.ts`,
  `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`, and a new migration extending the
  `channel_launch_directives.applied_tool_mode` CHECK.
- `X-Dopl-Vendor` word: `src/shared/auth/runtime-header.ts` (vendor word map) + hand copy in
  `packages/mcp-server/src/tools/identity.ts` (`toolLoaderFor` deferred-tool verb).
- `launch_directives.runtime` has no CHECK → no migration for the id itself.
- Conformance suites that auto-loop all adapters: `runtime-contract`, `adapter-parity`,
  `runtime-meter-truth`, `core-vocabulary` (no vendor word outside `main/runtime/<id>/`),
  `runtime-stamp-literals`, `runtime-copy`, `runtime-model-catalog`, `runtime-launch-default`,
  `runtime-credentials`, `posture-runtime-keyed`.

## 3. Grok Build adapter (`main/runtime/grok/`)

Source: `xai-org/grok-build@main` (rev 559751fd), bundled user-guide docs; docs.x.ai lags source.

### 3.1 Surface choice: ACP, not headless
`grok -p` cancels every permission request silently (or approves all with `--always-approve`) —
`xai-grok-pager/src/headless.rs` (permission handler). Fails refusal #1. ACP (`agent-client-protocol 0.10.4`,
`ProtocolVersion::V1`) gives held permission round-trips, cancel, load/resume, mode/model switch.

Spawn: `<bin> agent --no-leader stdio` with env:
```
GROK_HOME=<userData>/runtimes/grok/home      # config.toml, auth.json, sessions/, logs/
GROK_AUTH_PATH=$GROK_HOME/auth.json
GROK_DISABLE_AUTOUPDATER=1                    # stdio agent has no --no-auto-update flag
GROK_CLAUDE_{AGENTS,RULES,SKILLS,MCPS,HOOKS}_ENABLED=false
GROK_CURSOR_{...}_ENABLED=false
XAI_API_KEY=<Dopl-held key, only when API-key mode>
```
`--no-leader` is mandatory: `[cli] use_leader` would route into a shared leader process.

### 3.2 Event mapping (ACP `session/update` → core)

| ACP / grok | Core event |
|---|---|
| `session/new` response `sessionId` + `_meta.modelState` | `launched(sessionId, model, mcpServers=null→ fill from MCP status if reported)` |
| `agent_message_chunk` (accumulate per message) | `assistant(text)` on message boundary / turn end |
| `agent_thought_chunk` | `thinking(text)` (accumulated) |
| `tool_call {toolCallId,title,kind,rawInput,_meta["x.ai/tool"].name}` | `toolCallEvents({id, name: x.ai/tool.name ?? title, input: rawInput})` |
| `tool_call_update status=completed/failed` | `tool_result {toolUseId, ok: status==='completed', resultSummary}` |
| `session/prompt` response `{stopReason}` + `_meta.usage` | `result(sessionTokens cumulative)` + `context(tokens, model, window)` |
| `stopReason: cancelled` | `result` (turn ends) |
| JSON-RPC error 401/403 / auth method required | `auth_hold` |
| unknown `x.ai/session_notification` kinds | `shape_drift` (logged, not fatal) |
| `plan`, `available_commands_update`, `current_mode_update`, compaction | drop |

Tokens: `ResponseUsage{input_tokens, output_tokens, cache_read_input_tokens,
cache_creation_input_tokens, reasoning_tokens}`; adapter keeps the cumulative sum
(`sessionTokens`). Context window from the model roster (`grok-4.6` 500k, `grok-4.5` per
`xai-grok-models/default_models.json`) until a live window is seen.

### 3.3 Axis B and Axis A
- **Axis B — enforcement `held-callback`:** `session/request_permission` → Dopl gate →
  reply with the matching `PermissionOption` id (allow_once / reject_once). Dopl MCP passed in
  `session/new.mcpServers` as `{type:"http", url, headers:[Authorization, X-Dopl-*]}`.
  **Smoke S1 (blocking):** permission requests must fire for Dopl MCP tools in every mode we use,
  incl. `auto`. If `auto`/yolo skips them, fall back to:
  (a) per-tool ask rule in `$GROK_HOME/config.toml` permissions for `MCPTool(dopl__*)`, or
  (b) the `x.ai/mcp/sdk_call` reverse channel — Dopl serves the Dopl tools over ACP in-process
      (`enforcementPoint: 'in-process'`, Cursor pattern).
- **Axis A — modes:** ACP session modes `ask` / `default` / `plan`, `_meta.autoMode`,
  `_meta.yoloMode`. Proposed: `ask → default` (every edit/exec asks → gate), `auto → autoMode`,
  `full → yoloMode` (Dopl MCP still gated per S1). Windowless floor = `auto`.
- **Containment deny lists** use Grok tool ids (`run_terminal_cmd`, `spawn_subagent`/`Agent`,
  `web_fetch`, …) — **smoke S5** for the real id set (read from `available_commands`/tool_call).
- Sandbox: `--sandbox workspace` for restricted profiles (Seatbelt on macOS; child-network block is
  a no-op on macOS — do not rely on it for exfil).

### 3.4 Lifecycle
| Feature | Plan |
|---|---|
| Binary | Dopl downloads `https://x.ai/cli/grok-<ver>-macos-{aarch64,x86_64}` (fallback GCS host), pins version, records sha256 itself (install.sh verifies nothing). `delivery:'bundled'` later; start `'path'`+download like Codex. |
| Identity | `grok version --json` → `{path, version}` |
| Update source | `grok/update-source.js` reading `https://x.ai/cli/stable`; gated by a shape probe (`initialize` capability set) |
| Credential | (1) API key → `x.ai/setApiKey` or env; (2) `grok login --device-auth` run with isolated `GROK_HOME` (pty, like Claude). Note precedence: cached token beats `XAI_API_KEY`. `credentialState` = auth.json present / key set. |
| Interrupt | `session/cancel` (`_meta.cancelSubagents:true`), bounded wait like Codex 5s |
| Steer | `session.steer: false` initially (queue as next prompt). Smoke S9: `x.ai/interject`. |
| Resume | `session/load` by stored id; `usageResetsOnResume`: smoke S8 (does `_meta.usage` restart per process?) — until measured, `'unverified'` ⇒ resume refused. |
| Models | `x.ai/models/list` / `modelState`; effort via `session/set_config_option {configId:"reasoning_effort"}`; `pick.pattern` `^grok-`. |
| Skills | compat flags off; no Dopl skill install v1. |
| Operator tools | not v1. |

### 3.5 Isolation gaps
No switch found for reading `.claude/settings.json` **permission rules** or project `.mcp.json`.
Smoke S7; if they load, mitigate by `HOME` override for the child (like OpenCode) or project-trust
fence (Codex pattern).

## 4. Muse Code adapter (`main/runtime/muse/`)

### 4.0 Status (2026-10-13): BUILT on the runtime scaffold — INVARIANTS §11.0j is the rule, this is the evidence

Built against muse 1.4.7-R6101.1 (darwin arm64) with Meta's `echo` provider (no model, no account). Auth ruling
(Samuel, 2026-10-13): the user's Muse SUBSCRIPTION via Muse's own device-code sign-in into a Dopl-owned home —
no API key; `META_API_KEY` is stripped from every child (it "always takes priority over the account login").

**Verified live (echo, `test/muse-live.test.mjs` + the probes recorded under `test/fixtures/muse/live-*.ndjson`):**
- `serve --help`: no approval flag (approval mode is wire-selected); `--provider echo|meta|local`, `--contributor-mode`,
  `--disable-write`, `--disable-shell`, `--trust-workspace`, `-c KEY=JSON` (unknown key → exit 2, wrong type → exit 3).
- `-c` keys accepted: `context.foreign_personal_skills`, `run.reminder_roster.agents`, `run.workflow_trigger_mode`,
  `tools.web_fetch.enabled`, `tools.web_search.mode`, `tools.artifact.enabled`; `permissions.default_profile` is
  REFUSED on serve ("permission-profile selection is wire surface").
- Handshake: `requestedCapabilities: ['sessionMcp']` + `experimentalApi: true` → both granted; `museHome` lands inside
  Dopl's private home; `schema.version` 1, stable fingerprint `sha256:6de32db0…`.
- `session/start` echoes `approvalMode.mode` and `permissionState { profileId, reviewerAuthority }`; profiles listed by
  `permissionProfile/list`: `:read-only`, `:ask-me` (human), `:auto-review` (AI judge), `:unrestricted`. Dopl sends
  `:ask-me`/`:read-only` only and refuses any echo whose reviewer is not `human`.
- Echo turn: `turn/start` ack (`disposition: started`) → `turn/started` → `item/*` (`agentMessage`) →
  `session/tokenUsage` → `turn/completed`; with `run.reminder_roster.agents=[]` no `reminderChild` items.
- `turn/steer` racing a finished turn → `-32030 already_terminal`; Dopl sends `turn/start { ifBusy: 'steer' }` instead
  (a second push during an echo turn was QUEUED — echo turns finish in ~200 ms, too fast to observe a real steer).
- `turn/interrupt` on a finished turn answers `accepted` at once (bounded anyway).
- A `required` session MCP server that cannot start: the session opens, the turn fails `configError "Required MCP server
  \`dopl_session\` failed during startup"` — Dopl renders "Dopl's tools did not connect".
- Isolation: an operator `~/.claude/skills` skill is invisible through Dopl's env (private HOME); the operator's
  `META_API_KEY` does not reach the child (`account/read` ≠ `envKey`). ⚠ The `foreign_personal_skills` toggle itself
  does NOT hide those skills in `skill/list` (F-772).
- Sign-in: `account/loginStart { type: 'deviceCode' }` → `{ verificationUrl: https://auth.meta.com/oauth/device/?code=…,
  userCode }`; `account/loginCancel` → `loginCompleted { outcome: 'cancelled' }` (no login completed).
- Channel `https://api.meta.ai/muse-code/channels/muse-stable` is `state: public`; the manifest names each build with
  sha256 + size; the arm64 build is signed by Meta's team `V9WTTPBFK9` (strict Developer ID check passes).
- `muse schema generate-json-schema --experimental` → the Shape; the measured build covers every `requiredShape` tier.

**Still needs a REAL-MODEL smoke (Samuel's Muse login; none of these can be shown with echo):**
1. MCP approval subjects under each mode: does a Dopl MCP write (`dopl_channel` post) raise `approval/requested` with
   `subject.kind: "tool"` and `toolName: "mcp__dopl_session__dopl_channel"` under `promptUnmatched` AND `onRequest`
   (Axis B depends on it; `allowAll` is sent as `onRequest` for exactly this reason).
2. AI judge off: under `:ask-me`, every Dopl approval reaches Dopl (`approval/resolved.resolvedBy` never `llmJudge`).
3. Read-only MCP skip: Dopl's `readOnlyHint` tools run without an approval under `onRequest` (expected, harmless).
4. Token carry on resume: is `session/tokenUsage.cumulative` continued after host restart + `session/resume`? Until
   measured `usageResetsOnResume` stays `'unverified'` and resume is refused.
5. Reasoning stream: do `reasoning` items carry `summary[]` for the Meta model (`thinking` events)?
6. `authRequired`: does a revoked/expired account login end a turn with `error.kind: "authRequired"` (→ auth hold), or
   exit 3 at spawn? Also: the account-login credential FILE name under the file backend (`config/muse/auth.json` is read
   from the binary's own text, not yet observed after a granted login).
7. Real model ids, `contextLimit`, `reasoningEffortVariants` from `model/list` signed in; `session/contextUsage`
   `windowTokens` vs `contextLimit`; whether MCP tools are deferred behind a search verb (`prose.toolSearchVerb`).
8. A real mid-turn steer (`disposition: 'steered'`) and Stop during a tool call (`terminal: 'cancelled'`).
9. Local trace logs never carry the session MCP `Authorization` header (F-773).

The table and notes below are the pre-build plan, kept for the record.

`muse serve` = Muse Session Protocol, JSON-RPC 2.0/stdio, `initialize`/`initialized` handshake —
structurally Codex app-server. Schema: `muse schema`, `meta-models/muse-code-sdk/schema/msp/msp.d.ts`.
SDK `@muse-code/sdk` 1.4.7 (MIT, zero deps, Node 20+) — usable for types; drive raw JSON-RPC like Codex.

| MSP | Core |
|---|---|
| `session/start` result | `launched` |
| `item/completed` agent message / reasoning | `assistant` / `thinking` |
| `item/started` tool items | `toolCallEvents` |
| `item/completed` tool items | `tool_result` |
| `turn/*` completion + `session/tokenUsage` | `result` + `context` |
| `approval/requested` → `approval/decide` | Axis B held callback + Axis A approvals |
| `turn/steer`, `turn/interrupt`, `session/resume`, `session/setModel`, `setReasoningEffort`, `setApprovalMode` | steer ✅, interrupt ✅, resume ✅, model/effort dims |
| `item/delta`, `session/todoListChanged`, `subagent/*` | drop |

Auth: `META_API_KEY` (env name inconsistent across Meta docs — smoke) or browser sign-in into an
isolated home. **Subscription credential is "for use with Muse Code only"** — fine, Dopl runs the
real Muse Code binary; still confirm Meta ToS allows driving `muse serve` from another app.
Isolation: reads `~/.claude/skills`, `.claude/skills`, `~/.codex/skills` — disable via preference
(smoke). CLI license unpublished/closed binary → `delivery:'path'` + download, no redistribution
until licence confirmed. Smoke M1–M5: JSONL schema of `--json`, home-dir override env, approval for
MCP tools in auto, usage reset on resume, context window field.

## 5. OpenCode adapter (`main/runtime/opencode/`) — deferred

Target **V2** (`@opencode/cli` 2.0.x, MIT). Spawn `opencode serve --stdio` (reads
`OPENCODE_PASSWORD`, prints `{"url"}`, exits on stdin EOF); talk HTTP Basic + SSE `GET /api/event`
via `@opencode/client` (or raw fetch). Never attach to the user's shared background service.

| OpenCode V2 | Core |
|---|---|
| `POST /api/session` → id | `launched` |
| `session.text.ended` / `session.reasoning.ended` | `assistant` / `thinking` |
| `session.tool.called` / `.success` / `.failed` | `toolCallEvents` / `tool_result` |
| `session.step.ended {tokens, cost}` + `session.idle` | `result` + `context` (window from models.dev) |
| `permission.asked` → `POST /api/session/:sid/permission/:rid/reply {decision}` | Axis B + A |
| `prompt {delivery:"steer"}`, `/interrupt`, `switchModel` | steer, interrupt, live model switch |

Axis B: append last-wins rule `{action:"dopl_*", resource:"*", effect:"ask"}` so Dopl MCP calls
always raise `permission.asked`, even under `--auto`. Axis A via ordered permission rules per level.
Isolation: `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_DISABLE_PROJECT_CONFIG=1`,
`OPENCODE_DB`, `OPENCODE_DISABLE_AUTOUPDATE=1`, **plus `HOME`/`XDG_*` override** — `~/.claude`
skills scan has no env switch (`packages/core/src/config.ts`, `global` option). SSE is live-only, slow consumer
killed → must drain into a queue; recover via `GET .../permission` + session log on reconnect.
Credentials: provider API keys only. **Never** offer Claude Pro/Max OAuth through it (Anthropic
terms forbid it; server-side blocking since 2026-01). ChatGPT sign-in exists but Codex already
covers OpenAI.

Why deferred: V2 is a month old with 29 releases and self-described experimental routes; ACP mode
is single-prompt only. Value is the long tail (any provider, incl. Grok and Muse models via API
key), not a harness we lack.

## 6. Smoke-test packet (Phase 0, before any adapter code)

Run in a throwaway home, API-key auth, recorded transcripts saved as test fixtures.

Grok:
- S1 permission requests fire for Dopl MCP (http) tools in ask, auto, yolo. **Blocking.**
- S2 option ids/kinds on `session/request_permission`; reject behaviour.
- S3 `--cwd` / `GROK_SANDBOX` honoured by `agent stdio`.
- S4 standard ACP `usage_update` / mode / commands notifications emitted?
- S5 real tool id set + `rawInput` shapes (deny-list vocabulary).
- S6 model ids under API key vs OAuth (`grok-build-*`, `grok-code-fast-*`?).
- S7 `.claude/settings.json` permissions + `.mcp.json` leakage with compat flags off.
- S8 usage after `session/load` — cumulative or reset.
- S9 `x.ai/interject` as steer.
- S10 isolated `GROK_HOME` with no `~/.grok`; leader socket stays inside.

Muse: M1–M5 (§4). OpenCode: `serve --stdio` under Electron child_process, SSE drain, ask-rule
forcing, HOME sandbox blocks `~/.claude`.

## 7. Phases

0. Smoke packet (Grok + Muse), fixtures committed. Gate: S1/M3 pass.
1. **Grok adapter**: proc + ACP client (`grok/client.js`, `launch-handle.js`), normalize, descriptor,
   credential (API key first, device-auth second), download+pin, cross-tree vocab + migration,
   conformance + per-adapter tests from fixtures.
2. **Muse adapter**: clone Codex structure on MSP.
3. OpenCode V2 when its API stops moving (re-check release notes).
4. Optional: extract a shared JSON-RPC/stdio frame queue from Codex/Grok/Muse if the third copy
   appears.

## 8. Open questions for Samuel

1. Grok auth: API key only for v1, or device-auth (SuperGrok/X Premium+ subscription) too?
2. OK to ship Grok as `delivery:'path'` + Dopl-managed download (no bundling) for v1?
3. Muse: confirm Meta ToS before we drive `muse serve`; build it in this wave or after Grok ships?
4. OpenCode: defer (recommended) or start now for the multi-provider long tail?
