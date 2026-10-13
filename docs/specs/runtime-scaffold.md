# Runtime adapter scaffold — one structure for every SDK

Status (2026-10-13, branch `runtime/muse-scaffold`, local commits, unpushed): **Phase 0 DONE, Phase 1 DONE**
(§0 below); Phase 2 (kit), Phase 3 (Muse) and Phase 4 NOT STARTED. §1–§3 are the AUDIT SNAPSHOT taken before
Phase 1 and still use the old file names (`loader.js`, `server-requests.js`, `model-table.js`, `proc-config.js`,
`catalog.js`); §0 maps them to today's. Every count carries its date; re-derive with the command, never quote it.

## 0. Phase 0 / Phase 1 — what landed (2026-10-13)

Rulings applied: D1 rename `claude/loader.js` → `client.js` after slimming it; D2 rename `codex/server-requests.js`
→ `approval.js` with INVARIANTS §11.0d rewritten in the same commit; D3 the kit goes in `main/runtime/kit/` (Phase 2).

| Step | Commit | What |
|---|---|---|
| 0.2 | `7cbcc9be` | `contract.js › OPTIONAL_METHODS` (`shape`, `signInFull`, `hasFullLogin`, `cancelSignIn`), arity-checked when present |
| 0.1 | `390716e4` | `test/runtime-scaffold.test.mjs` — REQUIRED / capability-gated / OPTIONAL / dated `EXTRA` census / dated `PENDING` census, `toolMode.options` == `tools.js › TOOL_MODES`, windowless floor, key order |
| 0.3 | `3cb57e83` | §6 items 1–6 fixed in INVARIANTS; item 7 filed as F-771 |
| 1.1 | `c2f20898` | Claude `required-shape.js` + `shape.js › describe` |
| 1.2 | `290232d8` | Claude `identity.js` (own injectable deps; the roster suite injects both) |
| 1.3 | `8586d702` | Claude `model-table.js` → `usage.js` (marker `CLAUDE-USAGE`, suite `claude-usage.test.mjs`) |
| 1.4 | `9df0ea3f` | Claude MCP entry + stamps + bearer/timeout → `mcp.js` |
| 1.5 | `7509b53d` | Claude `resolve-bin.js`; `tools.js › buildSecretPathDenyRules(userDataDir)` + `launch-spec.js › userDataDir` |
| 1.6 | `630795b4` | Claude `loader.js` → `client.js` |
| 1.7 | `8133cda4` | Codex `server-requests.js` → `approval.js` |
| 1.8 | `8833c498` | Codex `proc-config.js` → `launch-verify.js`, `catalog.js` → `delegation-fence.js` |
| 1.9 | `e218cc6b` | Codex + Cursor `models.js › modelArg` |
| 1.10 | `3823e16c` | canonical descriptor key order; `claude/tools.js › WINDOWLESS_FLOOR` |

Where the plan was NOT followed literally (each deliberate, none a behaviour change):
- **`toolMode.options` stays in each `index.js`** — no `TOOL_MODE_OPTIONS` was moved into `tools.js` (1.10). The
  scaffold test pins the values equal to `tools.js › TOOL_MODES`, which closes the "two lists, nothing compares
  them" gap without moving descriptor data across files. Making one derive from the other is a Phase 2 option.
- **Suite names kept for Codex** (`codex-server-requests`, `codex-proc-config`): F-389 records that a
  `codex-approval` suite "has never existed", so re-using that name would contradict the findings log.
- **Claude keeps `launch-contract.js`** (launch-verify slot) and `models.js › resolveLaunchModel` (the
  `modelArg` body, already in the models slot): neither rename was in §5, both are noted in the census.
- **Claude `login.js` is the one open `PENDING` row** — its flow is core `main/claude-auth.js` (Phase 4).
- **`modelArg` was MOVED, not deduped**: Codex and Cursor each own an identical pass-through in `models.js`;
  sharing it needs a kit helper (Phase 2).
- Side effects of the moves, all checked: `claude/mcp.js` now requires `config`, `tool-profiles`, `mcp-connect`
  at load (electron-free, the same set `codex/mcp.js` already loads eagerly; the registry stays electron-free);
  `claude/client.js` no longer requires electron at all; the mcp-server `registrar.ts` comment changed with its
  committed `dist/` (rebuilt, identical).

Gates run per step (targeted, serialized with `lockf`): the conformance set (`runtime-contract`, `adapter-parity`,
`runtime-meter-truth`, `core-vocabulary`, `runtime-stamp-literals`, `runtime-vocab-cross-tree`, `runtime-copy`,
`runtime-model-catalog`, `runtime-launch-default`, `runtime-credentials`, `posture-runtime-keyed`,
`main-require-paths`, `main-exports-defined`, `module-split-identity`, `runtime-scaffold`) + every non-live suite
naming the adapter's tree (`git grep -l 'runtime/<id>\|"runtime", "<id>"' test`), desktop eslint on touched
files, `node scripts/check-doc-refs.mjs`; 1.10 also the two SPA vitest files.

---


Samuel's ask: Muse gets "the same structure as Codex and Claude", and the structure itself becomes one core
template so that "it's very clear how to map each item over to a new SDK or how each SDK maps it over".

Short answer: **the CONTRACT is already one structure; the FILE LAYOUT is not.** `contract.js` + the
conformance suites force every adapter to export the same `{ descriptor, runtime }` with the same 18 methods
and the same descriptor blocks. But behind `index.js` the three directories put the same job in
differently-named files, split one job across files in one adapter and not another, and carry ~10 pieces of
non-vendor machinery that Muse (a near-1:1 Codex clone over JSON-RPC/stdio) would copy a fourth time. This
doc gives the file matrix, the duplication list, a canonical layout, and an ordered, behaviour-preserving
migration plan.

---

## 1. File matrix — every adapter file → its slot

Line counts @ 2026-10-13: `cd dopl-desktop-app/main/runtime && wc -l claude/*.js codex/*.js cursor/*.js`.
claude 2,974 lines in 20 `.js` files (+ `skills/` assets); codex 3,772 in 27; cursor 1,475 in 11.

Slot names are the proposed canonical vocabulary (§4). ★ = same slot, different file name. ✂ = one slot
split across files in this adapter. ⧉ = holds non-vendor logic duplicated elsewhere (§3).

### Claude (`main/runtime/claude/`)

| File | Lines | Slot | Notes |
|---|---|---|---|
| `index.js` | 154 | index | `requiredShape` declared INLINE here (codex has a file) |
| `loader.js` | 398 | **client** ★✂⧉ | grab-bag: SDK import (`› getSdk`/`› peekSdk`) = client; `› bundledClaude`/`› claudeRuntime`/`› resolveClaudeExecutable` = resolve-bin; `› buildMcpServers`/`› withSessionStamp`/`› withToolProfileStamp`/`› withToolSetStamp`/`› doplBearer`/`› clientTimeoutMs` = **mcp** (codex/cursor keep these in `mcp.js`); `› buildSecretPathDenyRules` = **tools** (cursor keeps it in `tools.js`); `› buildScrubbedEnv` = env |
| `tools.js` | 344 | tools | Axis-A vocabulary + containment table |
| `axis-b.js` | 173 | axis-b | also `› makeAgentOpsServer` (in-process agent-ops server) |
| `approval.js` | 66 | approval | answer shape + approval descriptor |
| `launch-spec.js` | 146 | launch-spec | handle = SDK `Query` wrapped by `fold.js › observeQuery` |
| `normalize.js` | 181 | normalize | auth via core `session-auth-detect.js` |
| `models.js` | 184 | models ✂ | also `› buildIdentity` (= **identity** slot, codex has a file) and `› shape` (= **shape** slot, codex has a file) |
| `roster.js` | 241 | models (live read) | turn-free `supportedModels()` probe; `› observeShape` |
| `model-table.js` | 34 | **usage** ★ | misnamed: header says "NO MODEL DATA (2026-10-08)"; holds `› promptTokens`/`› sessionTokens` only |
| `mcp.js` | 57 | mcp ✂ | only host registration (`registerMcp`/`probeMcp`); the session entry is in `loader.js` |
| `credential.js` | 87 | credential | the interactive flow itself is in CORE (`main/claude-auth.js`, `claude-token.js` — `core-vocabulary` DEFERRED rows) |
| `packaging.js` | 42 | packaging | |
| `update-source.js` | 69 | update-source | |
| `launch-contract.js` | 136 | launch-verify | per-launch `system/init` readback |
| `semantics.js` | 241 | build-verify | updater's live gate/deny probe |
| `cost-rates.js` | 68 | vendor extra | cheapest-model learning for the semantics probe |
| `fold.js` | 97 | vendor extra | mid-turn steer fold |
| `operator-tools.js` | 70 | operator-tools | |
| `skill-install.js` | 186 | vendor extra | installs Dopl skills into `~/.claude/skills` |
| `skills/…` | — | assets | `SKILL.md` + `.sh` — the only non-`.js` files in the tree (§6 item 7) |

### Codex (`main/runtime/codex/`)

| File | Lines | Slot | Notes |
|---|---|---|---|
| `index.js` | 173 | index | `modelArg` inlined here (claude: `models.js`) |
| `client.js` | 267 | client ⧉ | `› connect` = generic JSON-RPC/stdio; `› probe`/`› probeAt` = version probe + download retry/reject ⧉ |
| `launch-handle.js` | 84 | launch-handle ⧉ | `› makeFrameQueue`, `› boundedInterrupt` are pure, vendor-free |
| `protocol.js` | 34 | protocol | `REQUIRED_METHODS` release-gate list |
| `tools.js` | 131 | tools | |
| `policy.js` | 192 | policy | native `approval_policy` placement + echo check |
| `axis-b.js` | 27 | axis-b | |
| `server-requests.js` | 198 | **approval** ★ | server→client request routing + reply shapes + approval descriptor |
| `launch-spec.js` | 424 | launch-spec ⧉ | `› start` (~200 lines) holds the usage carry (`lastTotal`) and frame pump; 76 lines under the cap |
| `normalize.js` | 230 | normalize ⧉ | `› tokensFrom`, `AUTH_SHAPED_RE` |
| `models.js` | 195 | models | live roster read inline (`› fetchRoster`) |
| `identity.js` | 77 | identity | |
| `required-shape.js` | 75 | required-shape | |
| `shape.js` | 209 | shape | `generate-json-schema` → shared Shape |
| `mcp.js` | 143 | mcp ⧉ | session entry + `RUNTIME_HEADERS` + `› doplBearer`/`› clientTimeoutSec` |
| `mcp-ready.js` | 116 | vendor extra | first turn waits for Dopl's MCP |
| `credential.js` | 42 | credential | |
| `login.js` | 216 | login | |
| `config-home.js` | 147 | config-home ⧉ | private `0700` home, `0600` auth install (generic) + `CODEX_HOME`/trust-table rules (vendor) |
| `resolve-bin.js` | 260 | resolve-bin ⧉ | candidate inspection/writable-by-others/order policy is generic |
| `packaging.js` | 20 | packaging | |
| `update-source.js` | 39 | update-source | |
| `proc-config.js` | 125 | **launch-verify** ★ | argv restrictions + `config/read` readback |
| `fence-verify.js` | 105 | build-verify ★ | `features list` check |
| `skills-fence.js` | 76 | vendor fence | |
| `catalog.js` | 99 | vendor fence | delegation fence via model catalog; name collides with `../model-catalog.js` |
| `operator-tools.js` | 68 | operator-tools | |

### Cursor (`main/runtime/cursor/`)

| File | Lines | Slot | Notes |
|---|---|---|---|
| `index.js` | 140 | index | `modelArg` inlined; `buildIdentity` inline `null`; no `shape` |
| `client.js` | 80 | client | in-process SDK loader + `› probe` |
| `tools.js` | 188 | tools | includes `› buildSecretPathDenyRules` (claude: in `loader.js`) |
| `axis-b.js` | 207 | axis-b ⧉ | `› makeGate` = `held-gate.js › makeHeldGate` + close latch + no-dispatch deny |
| `approval.js` | 67 | approval | |
| `launch-spec.js` | 171 | launch-spec | run handle built inline in `› start` (codex: `launch-handle.js`) |
| `normalize.js` | 172 | normalize ⧉ | `› tokensFrom`, `AUTH_SHAPED_RE` |
| `models.js` | 106 | models | |
| `mcp.js` | 226 | mcp ⧉ | an HTTP MCP client (`› rpc`/`› handshake`) + headers + `› doplBearer`/`› clientTimeoutMs` |
| `credential.js` | 90 | credential | |
| `packaging.js` | 28 | packaging | |

### Shared today (`main/runtime/*.js`, `updates/`)

Core-facing: `index.js` (registry), `contract.js`, `capability.js`, `events.js`, `permission-level.js`,
`selection-vocabulary.js`, `launch-default.js`, `model-catalog.js` (+`catalog-readers.js`,
`catalog-status.js`), `model-preferences.js`, `connectivity.js`, `roster-key.js`, `live-store.js`,
`runtime-copy.js`, `sdk-shape.js`, `updates/`. Adapter-only helpers: `cli-spawn.js`
(`› scrubbedEnv`, `› rewriteAsarUnpacked`, `INHERITED_CREDENTIAL_ENV`), `held-gate.js`
(`› makeHeldGate`, `› settledVerdict`). There is no folder that says "this is the kit an adapter builds
from" — the kit is scattered among core-facing modules.

---

## 2. `index.js` — same contract, different assembly

All three export `{ descriptor, runtime }`, all three lazy-require `launch-spec` / `normalize` / the platform
module behind arrows (the electron-free-at-load contract), all three derive containment with the same
one-liner `const profileEntry = (p) => profileEntryFrom(tools.buildSessionToolConfig(p))`.

Differences (structural, not behavioural):

1. **Descriptor key order differs.** Claude: `id, label, session, axisB, approval, toolMode, containment,
   models, requiredShape, mcp, credential, prose, packaging`. Codex: `id, label, requiredShape, session, …`.
   Cursor: no `requiredShape`. Harmless at runtime (keys are read by name) but it is the first thing a reader
   compares.
2. **Where a block's data comes from differs.** `requiredShape`: inline in `claude/index.js`, imported from
   `codex/required-shape.js`. `toolMode.windowlessFloor`: literal `'auto'` in Claude, `tools.WINDOWLESS_FLOOR`
   in Codex/Cursor. `toolMode.options`: an inline table in every `index.js`, while each `tools.js` keeps its
   own `TOOL_MODES` array of the same words — **two lists of one vocabulary per adapter, and no test asserts
   they are equal** (`adapter-parity` checks the options exist, not that they match `TOOL_MODES`).
3. **`toolMode` shape varies by optional keys**: Codex adds `reviewer`; `secondaryAxis` is `null` (Claude) vs
   an object (Codex, Cursor). Fine — that is the declared-difference design.
4. **Runtime object order matches** (available → buildLaunchSpec/start/resume/normalize → approval/axis-B →
   tools → models/identity/shape/modelArg → mcp → credential). But:
   - `modelArg`: delegated in Claude (`models.resolveLaunchModel`), **inlined identically** in Codex and
     Cursor (`pickOf` pass-through).
   - `buildIdentity`: Claude → `models.js`, Codex → `identity.js`, Cursor → inline `null`.
   - `shape`: Claude → `models.js › shape`, Codex → inline closure calling `resolve-bin` + `shape.js`,
     Cursor absent.
   - Parameter names drift: `axisBTools(session)` vs Cursor `axisBTools(request)`; `stampOutbound(result, tag)`
     vs Cursor `(input, tag)` vs Codex `(_input, _tag)`.
5. **Optional methods are undeclared.** `shape` (arity checked only inside `sdk-shape.js ›
   requiredShapeProblems`), `signInFull`, `cancelSignIn`, `hasFullLogin` are called by core with `typeof`
   probes (`main/runtime-credentials.js › cancelSignIn`) but listed nowhere in `contract.js`. A new adapter
   cannot learn they exist from the contract.

---

## 3. Duplicated generic machinery → shared kit

Proposed home: **`main/runtime/kit/`** — adapter-only helpers, never required by core, named for the job not
the vendor (precedent: `updates/` is already a shared subdirectory). Because `test/core-vocabulary.test.mjs`
exempts the WHOLE `main/runtime/` tree (`coreFiles` filters `RUNTIME_DIR`), kit files are not scanned for
vendor words today; the kit gets its own vendor-word scan (the `runtime-copy.test.mjs` pattern) in the same
change that creates it.

| # | Kit module | Extracted from (path › symbol) | API | Adopters | Risk |
|---|---|---|---|---|---|
| K1 | `kit/stdio-rpc.js` | `codex/client.js › connect`, `› makeLineReader`, `OVERLOADED_CODE` retry, `CLOSE_GRACE_MS` close-vs-exit, `-32603` refusal | `connect({ command, args, env, cwd, label, onNotification, onServerRequest, onExit, log })` → `{ child, request, notify, close, isClosed }`; `makeLineReader(onLine)` | codex (wrapper keeps today's signature: prepends `app-server` + `AUTH_STORE_ARGS`), **muse**, grok | MED — transport semantics are pinned (CX-01/10/14/25). Gate: `codex-client-transport`, `codex-launch-lifecycle`, `codex-app-server-contract`. Pure move + parameterised label/argv. |
| K2 | `kit/frame-queue.js` | `codex/launch-handle.js › makeFrameQueue`, `› boundedInterrupt`, `INTERRUPT_TIMEOUT_MS` | unchanged | codex, muse, grok; cursor optional (its `start` uses an async generator) | LOW — pure, no requires. `codex/launch-spec.js` keeps its re-exports for tests. |
| K3 | `kit/run-handle.js` | `codex/launch-handle.js › handleFor` (generic half) and cursor's inline handle in `cursor/launch-spec.js › start` | `runHandle({ frames, interrupt: () => Promise, close: () => void })` → async-iterable `{ next, interrupt, close }` | codex, cursor, muse | LOW-MED — codex's interrupt policy (mcp-ready wait, no-turn no-request) stays in the adapter as the `interrupt` callback. |
| K4 | `kit/usage.js` | `sdk-shape.js › readCount` (misplaced in the shape layer); `codex/normalize.js › tokensFrom` ≈ `cursor/normalize.js › tokensFrom` (cursor adds cached-input keys); the `lastTotal` carry in `codex/launch-spec.js › start` (CX-02) | `readCount(obj, …path)`; `tokensFrom(usage, { input, cached, output, total })` (key lists per adapter) → `{ prompt, session }`; `makeUsageCarry()` → `{ observe(total), forTurn(latest) }` | codex, cursor, muse; claude's `model-table.js` readers optional | LOW-MED — the null-not-0 rule (§11.0a, CX-02/P4-04) must survive. Gate: `runtime-meter-truth`, `codex-normalize`, `cursor-normalize`, `codex-context-forward`. |
| K5 | `kit/auth-shape.js` | `codex/normalize.js › AUTH_SHAPED_RE`/`› isAuthShaped` vs `cursor/normalize.js` (identical regex + `CURSOR_API_KEY`) | `authShaped(text, extraRe?)` | codex, cursor, muse | LOW — the adapter still decides (P4-03 trusts the adapter's verdict); the kit only holds the spelling. Claude keeps `session-auth-detect.js`. |
| K6 | `kit/dopl-mcp.js` | `claude/loader.js › doplBearer`/`› clientTimeoutMs`, `cursor/mcp.js › doplBearer`/`› clientTimeoutMs`, `codex/mcp.js › doplBearer`/`› clientTimeoutSec`; the custody/vendor/profile/session header set in all three | `doplBearer()`, `clientTimeoutMs()`, `doplHeaders({ vendor, workspaceId, slot, profile, toolSet })`, `CUSTODY_WORD`, `TOOL_PROFILE_HEADER`, `SESSION_HEADER` | all four. Wire placement stays per adapter (Claude: header object; Codex: env-var NAMES via `env_http_headers`; Cursor: fetch headers) | MED — `runtime-stamp-literals.test.mjs` pins the literals across a join; the bearer-never-on-argv rule (§11.0d) is Codex's placement and stays there. Note: Claude's `clientTimeoutMs` has NO try/catch, Cursor/Codex fall back to 60s — pick one deliberately. |
| K7 | `held-gate.js` (extend, don't move) | `cursor/axis-b.js › makeGate` = `makeHeldGate` + `isClosed` latch + "no dispatch ⇒ deny" | `makeHeldGate(s, dispatch, log, { isClosed?, denyWithoutDispatch? })` | cursor (claude/codex pass no options → identical) | MED — options must default to today's Claude/Codex behaviour. Gate: `session-held-gate-approval`, `cursor-axis-b`, `cursor-gate`, `codex-gate`. |
| K8 | `kit/private-home.js` | `codex/config-home.js › ownerOnlyDir`, `› privateHome`, `› installAuth`, `› removeAuth`, `› hasAmbientConfig` (the generic halves) | `privateHome(base, name)`, `ownerOnlyDir(dir)`, `installFile(src, dest, mode)`, `removeFile`, `hasAny(home, names)` | codex, **muse** (isolated home is smoke M2), grok | MED — security-relevant (§11.0d ambient-config fence, `0600`/`0700`, symlink removal). Vendor parts (`CODEX_HOME`, trust-table regex, `AUTH_STORE_ARGS`) stay in `codex/config-home.js`. Gate: `codex-config-home`, `codex-hostile-config`, `codex-project-trust`, `codex-signin`. |
| K9 | `kit/bin-resolve.js` | `codex/resolve-bin.js › inspectCandidate`, `› writableByOthers`, `› expandHome`, `› nodeNeighbours`, `› resolveWith` (order policy), hit-cache + `› forget` | `makeResolver({ binName, overrideEnv, wellKnown, bundledCandidate, launcherVendor?, updateSource })` → `{ resolve(), resolveWith(io), forget() }` | codex, **muse** (`delivery:'path'` + download), grok; claude optional (`loader.js › claudeRuntime` is a narrower bundle-or-download pick) | MED-HIGH — the most security-sensitive code in the tree (§11.0d "A FILE NAMED `codex` IS NOT A REASON TO RUN IT"). Move verbatim; `codex/resolve-bin.js` becomes config + `› launcherVendor` + `› bundledCandidate`. Gate: `codex-resolve-bin`, `runtime-updates`, `runtime-updates-risks`. |
| K10 | `kit/probe-bin.js` | `codex/client.js › probe`/`› probeAt` (version probe, `DOWNLOAD_RETRY_TIMEOUT_MS` retry, `updates.reject` loop); the same constant duplicated in `claude/models.js › DOWNLOAD_RETRY_TIMEOUT_MS` | `probeBinary({ resolve, versionGate, onReadable, updateSource, timeoutMs, retryMs })` → `{ ok, reason, version, path, source }` | codex, muse, grok | MED — "an update can never turn into no runtime" (§11.0) depends on the reject loop. |
| K11 | `contract.js` (extend) | the undeclared optional methods (§2.5); the `profileEntry` one-liner in every `index.js` | `OPTIONAL_METHODS = { shape: 0, signInFull: 0, cancelSignIn: 0, hasFullLogin: 0 }` arity-checked when present; `containmentFrom(tools, profileNames)` | all | LOW — every shipped adapter already satisfies it; `sealAdapter` gains a check, no runtime path changes. Gate: `runtime-contract`, `adapter-parity`. |

Not worth extracting (vendor-shaped or one-liners): `nativePair` (Codex and Cursor share a NAME, not logic);
`shortDoplName` (identical 1-line body in all three `tools.js` — could move to `main/mcp-tool-names.js`, which
all three already require); `buildSecretPathDenyRules` (same cross-product loop, different grammar — relocate
Claude's to `tools.js`, don't share); `const appVersion = () => require('../../app-version').appVersion()`
(three copies, one line); `registerMcp`/`probeMcp` refusals (sentences, per vendor).

Env scrub is ALREADY shared (`cli-spawn.js › scrubbedEnv`); each adapter's `buildScrubbedEnv` is a one-line
call with its own prefix/knob regexes (`claude/loader.js`, `codex/launch-spec.js`). The one structural smell:
`cli-spawn.js › INHERITED_CREDENTIAL_ENV` is a CENTRAL list of every vendor's env names, so Muse's
`META_API_KEY` goes into a shared file rather than the Muse directory. Proposal: each `credential.js` exports
`INHERITED_ENV` and `cli-spawn.js` unions them via the registry lazily — or accept the central list and make
"add your vendor's env names" a checklist line (§5). Recommend the checklist; the union adds a load-order edge
for little gain.

---

## 4. The canonical scaffold

### 4.1 Layout — `main/runtime/<id>/`

Every file is `.js`, ≤500 lines. **REQUIRED** = every adapter has this file under this name. **IF** = exists
exactly when the named capability is declared; absent otherwise (absent means absent, like `null`).
**EXTRA** = vendor-only, allowed freely, but listed in the scaffold test's per-adapter census (§4.3).

| File | Req | One-line responsibility | Exports (contract-facing) |
|---|---|---|---|
| `index.js` | REQUIRED | Assemble `{ descriptor, runtime }` in the canonical key order; delegation only, no logic | `descriptor`, `runtime` |
| `client.js` | REQUIRED | The ONLY module that loads the vendor SDK or spawns/speaks to the vendor process; `probe()` backs `available()` | `probe`, + transport (`connect` / `loadSdk` …) |
| `tools.js` | REQUIRED | Axis-A vocabulary in the vendor's words (`TOOL_MODES`, `TOOL_MODE_OPTIONS`, `WINDOWLESS_FLOOR`, taxonomy) + per-profile containment table | `buildSessionToolConfig`, `axisAAllows`, `normalizeToolMode` |
| `axis-b.js` | REQUIRED | Axis-B enforcement point + its descriptor | `axisBTools`, `descriptor` |
| `approval.js` | REQUIRED | Dopl's verdict → this vendor's approval reply; approval descriptor | `answerApproval`, `stampOutbound`, `descriptor` |
| `launch-spec.js` | REQUIRED | The one assembly point for every spawn shape; `start` is synchronous | `buildLaunchSpec`, `start`, `resume` |
| `normalize.js` | REQUIRED | One raw frame → `CoreEvent[]`, pure; owns auth, render, usage | `normalize` |
| `models.js` | REQUIRED | Live roster + model-pick vocabulary | `models`, `modelArg`, `descriptor` |
| `mcp.js` | REQUIRED | Dopl's MCP session entry for this vendor + host registration | `registerMcp`, `probeMcp`, `descriptor` |
| `credential.js` | REQUIRED | Is Dopl's own credential present; sign-in/out entry points | `credentialState`, `signIn`, `signOut`, `descriptor` |
| `packaging.js` | REQUIRED | How the binary reaches the Mac (descriptor data) | `packaging` |
| `identity.js` | IF `buildIdentity` non-null | `{ path, version, account? }` of the build new launches run | `buildIdentity` |
| `required-shape.js` | IF `descriptor.requiredShape` | What Dopl reads from the vendor protocol, tiered | (frozen data) |
| `shape.js` | IF `descriptor.requiredShape` | The build's own description of itself | `describe` → `runtime.shape()` |
| `protocol.js` | IF RPC transport | `REQUIRED_METHODS` release-gate list | `REQUIRED_METHODS` |
| `launch-handle.js` | IF `start` builds its own handle | run handle over `kit/run-handle` + `kit/frame-queue` | `handleFor` |
| `resolve-bin.js` | IF it spawns an executable | config for `kit/bin-resolve` + vendor launcher mapping | `resolve…Bin` |
| `config-home.js` | IF the vendor reads ambient config from a home dir | isolated home on `kit/private-home` | `isolatedEnv` |
| `login.js` | IF `credential.interactiveSignIn` | the in-app sign-in flow | `signIn`, `cancel` |
| `update-source.js` | IF in `runtime/index.js › UPDATE_SOURCES` | self-update source | (source object) |
| `policy.js` | IF a native approval policy is sent per thread | placement + echo check | |
| `launch-verify.js` | IF a per-launch restriction readback exists | asked-vs-running check before the first turn | |
| `operator-tools.js` | IF "Use my tools" is supported | operator's own servers/skills, explicitly passed | |
| `usage.js` | optional | usage readers when `normalize.js` would exceed the cap | |
| EXTRA files | vendor | `fold.js`, `cost-rates.js`, `semantics.js`, `roster.js`, `skill-install.js`, `skills/`, `mcp-ready.js`, `fence-verify.js`, `skills-fence.js`, `delegation-fence.js` … | |

Canonical descriptor key order: `id, label, session, axisB, approval, toolMode, containment, models,
requiredShape?, mcp, credential, prose, packaging`. Canonical runtime method order = `RUNTIME_METHODS` order,
then optional methods.

### 4.2 Side-by-side: how each SDK maps onto each slot

`→` = proposed move. `—` = absent by declaration.

| Slot | Claude (SDK + CLI stream-json) | Codex (`codex app-server`, JSON-RPC/stdio) | Cursor (`@cursor/sdk`, in-process) | Muse (planned, `muse serve` MSP, JSON-RPC/stdio) |
|---|---|---|---|---|
| index | `index.js` (requiredShape inline → out) | `index.js` (modelArg inline → `models.js`) | `index.js` (modelArg inline → `models.js`) | `index.js` |
| client | `loader.js` → `client.js` (SDK import only, after MCP/bin/secret moves) | `client.js` (→ thin wrapper on `kit/stdio-rpc`, `kit/probe-bin`) | `client.js` | `client.js` on `kit/stdio-rpc` + `kit/probe-bin` |
| protocol | — | `protocol.js` | — | `protocol.js` (`initialize`, `session/start`, `session/resume`, `turn/start`, `turn/steer`, `turn/interrupt`, `approval/decide`, `session/setModel`…) |
| tools | `tools.js` (+ `buildSecretPathDenyRules` from `loader.js`) | `tools.js` | `tools.js` | `tools.js` (Muse approval-mode words — smoke) |
| axis-b | `axis-b.js` held callback (`canUseTool`) | `axis-b.js` held callback (elicitation) | `axis-b.js` in-process `customTools` | `axis-b.js` held callback (`approval/requested`) |
| approval | `approval.js` | `server-requests.js` → `approval.js` | `approval.js` (`heldCallback: false`) | `approval.js` (`approval/requested` → `approval/decide`) |
| policy | — (permission mode pinned in `launch-spec.js`) | `policy.js` | — (`nativePair` in `launch-spec.js`) | `policy.js` (`setApprovalMode` + echo) |
| launch-spec | `launch-spec.js` | `launch-spec.js` (frame pump/usage carry → kit) | `launch-spec.js` | `launch-spec.js` |
| launch-handle | — (SDK `Query` + `fold.js`) | `launch-handle.js` (→ kit) | inline → kit `run-handle` | `launch-handle.js` on kit |
| normalize | `normalize.js` | `normalize.js` (→ `kit/usage`, `kit/auth-shape`) | `normalize.js` (→ kit) | `normalize.js` (`item/completed`, `session/tokenUsage`) |
| usage | `model-table.js` → `usage.js` | in `normalize.js` | in `normalize.js` | in `normalize.js` |
| models | `models.js` + `roster.js` | `models.js` | `models.js` | `models.js` (roster source — smoke) |
| identity | `models.js › buildIdentity` → `identity.js` | `identity.js` | — (`null`) | `identity.js` |
| required-shape / shape | inline + `models.js › shape` → `required-shape.js` + `shape.js` | `required-shape.js` + `shape.js` | — | `required-shape.js` + `shape.js` (`muse schema`) |
| mcp | `mcp.js` + entry builders in `loader.js` → all in `mcp.js` | `mcp.js` (+ `mcp-ready.js`) | `mcp.js` (HTTP MCP client) | `mcp.js` (MSP session MCP config — smoke) |
| credential | `credential.js` (+ core `claude-auth.js`/`claude-token.js`, DEFERRED) | `credential.js` | `credential.js` | `credential.js` (`META_API_KEY` / sign-in — smoke) |
| login | core `main/claude-auth.js` (DEFERRED row) | `login.js` | — | `login.js` if browser sign-in is used |
| config-home | — (`settingSources: []` + credential store dir) | `config-home.js` | — (no isolation possible) | `config-home.js` on `kit/private-home` (smoke M2) |
| resolve-bin | in `loader.js` → `resolve-bin.js` | `resolve-bin.js` (→ kit) | — (SDK) | `resolve-bin.js` on `kit/bin-resolve` |
| packaging | `bundled` | `bundled` | `path` | `path` + download (licence unpublished) |
| update-source | `update-source.js` | `update-source.js` | — | — until licence allows a pinned download |
| launch-verify | `launch-contract.js` | `proc-config.js` + `policy.js › assertThreadTook` | — | TBD by smoke (does MSP echo config?) |
| build-verify | `semantics.js` (+ `cost-rates.js`) | `fence-verify.js` | — | TBD |
| operator-tools | `operator-tools.js` | `operator-tools.js` | — | later |
| vendor fences | `launch-spec.js` pins | `skills-fence.js`, `catalog.js` → `delegation-fence.js` | `tools.js` deny strings | skills-dir preference (spec: reads `~/.claude/skills`, `~/.codex/skills`) |
| vendor extras | `fold.js`, `skill-install.js`, `skills/` | `mcp-ready.js` | close latch in `axis-b.js` | — |
| shared kit used | `held-gate`, `cli-spawn`, `kit/dopl-mcp` | `held-gate`, `cli-spawn`, K1–K10 | `held-gate`(+opts), `kit/dopl-mcp`, `kit/usage`, `kit/auth-shape`, `kit/run-handle` | `held-gate`, `cli-spawn`, K1–K10 |

### 4.3 Making it real: a scaffold test, not a template directory

- **`test/runtime-scaffold.test.mjs`** (new, in the existing `node --test` suite — not a new CI step, so the
  gate count does not move). Loops every registered adapter and asserts: (a) every REQUIRED file exists;
  (b) each IF file exists **iff** its capability is declared (`required-shape.js` ⇔ `descriptor.requiredShape`,
  `update-source.js` ⇔ listed in `UPDATE_SOURCES`, `login.js` ⇔ `credential.interactiveSignIn === true`,
  `identity.js` ⇔ `buildIdentity` is not the inline-null form, `protocol.js` ⇔ JSON-RPC transport);
  (c) every other file is named in a dated per-adapter `EXTRA` census whose rows must still exist (the
  `core-vocabulary` DEFERRED pattern: it shrinks, never grows quietly); (d) `descriptor.toolMode.options`
  values equal `tools.TOOL_MODES`. Exceptions during migration ride a dated `PENDING` census that empties as
  steps land (precedent: `adapter-parity.test.mjs`'s `PENDING_UNTIL_CURSOR`).
- **No `_template/` directory.** Stub `.js` files under `main/runtime/` are linted, capped and walked by the
  conformance suites but never registered, so they rot silently. The conformance suite + the scaffold test +
  the checklist below ARE the template: a new adapter fails loudly on every missing method, field and file.
- **No generator.** We will write 2–3 more adapters, ever; each is mostly vendor judgement (measurements,
  fences, wording) that a generator cannot produce. The checklist is cheaper and cannot drift from code
  because the scaffold test enforces it.
- **Where the doc lives.** NOT `main/runtime/README.md`: INVARIANTS §11.0 says every file under
  `main/runtime/**` is `.js` (§6 item 7 — the tree already violates it with `claude/skills/`, but a README
  would be a deliberate second violation). The RULE (layout table §4.1, one paragraph) goes into INVARIANTS as
  a new §11.0i; the PROCEDURE stays in this spec as the checklist below. Code > INVARIANTS > this file.

### 4.4 New-adapter checklist (procedure)

1. Smoke packet first (fixtures committed; spec `new-runtimes-grok-muse-opencode.md` §6).
2. Create `main/runtime/<id>/` with the REQUIRED files; add IF files only for declared capabilities.
3. `register(require('./<id>'))` in `main/runtime/index.js` (order is load-bearing: append); add to
   `UPDATE_SOURCES` only with an `update-source.js`.
4. Vendor env names → `cli-spawn.js › INHERITED_CREDENTIAL_ENV`.
5. Cross-tree vocab: `test/runtime-vocab-cross-tree.test.mjs › RUNTIMES`, tool-mode words in
   `src/features/channels/schema-launch-modes.ts`, `packages/contracts/src/directives.ts`,
   `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`, a migration widening the
   `applied_tool_mode` CHECK; vendor word in `src/shared/auth/runtime-header.ts` + the hand copy in
   `packages/mcp-server/src/tools/identity.ts › toolLoaderFor`.
6. Per-adapter fixture suites: `<id>-normalize`, `<id>-gate`, `<id>-client-transport` (if RPC).
7. Scaffold test census row; INVARIANTS §11.0 subsection for what the adapter declares it cannot do.

---

## 5. Migration plan — smallest risk first

Every step is behaviour-preserving, lands alone, and passes its gate before the next starts. Gate commands run
from `dopl-desktop-app/`, serialized: `lockf /tmp/dopl-gate.lock node --test test/<file>.test.mjs …`. EVERY
step also runs: `node --test test/runtime-contract.test.mjs test/adapter-parity.test.mjs
test/core-vocabulary.test.mjs test/main-require-paths.test.mjs test/main-exports-defined.test.mjs
test/module-split-identity.test.mjs`, `npm run lint` (desktop — the 500-line cap), and from the repo root
`node scripts/check-doc-refs.mjs`. Any step that moves a file the SPA harness loads also runs
`npx vitest run src/features/channels/lib/runtime-capability.test.ts`. Find every reference before a move:
`grep -rn '<adapter>/<file>' dopl-desktop-app src scripts packages docs CLAUDE.md` (doc anchors on
`claude/loader.js` alone: 39 @ 2026-10-13; `codex/client.js` 15; `codex/identity.js` 14).

**Phase 0 — enforcement before movement**
- 0.1 Add `test/runtime-scaffold.test.mjs` with today's layout as the `PENDING` census (passes on the current
  tree). Gate: the new test.
- 0.2 `contract.js › OPTIONAL_METHODS` (K11). Gate: `runtime-contract`, `runtime-credentials`,
  `claude-shape`, `codex-shape-contract`, `sdk-shape`.
- 0.3 Fix the INVARIANTS drift in §6 (doc-only, separate commit).

**Phase 1 — pure renames / moves inside adapters (no logic change)**
- 1.1 Claude: `requiredShape` out of `index.js` → `claude/required-shape.js`; `models.js › shape` →
  `claude/shape.js`. Gate: `claude-shape`, `sdk-shape`, `runtime-updates`, `claude-sdk-contract`.
- 1.2 Claude: `models.js › buildIdentity` → `claude/identity.js`. Gate: `runtime-model-catalog`,
  `claude-live-roster`, `runtime-catalog-recovery`.
- 1.3 Claude: `model-table.js` → `usage.js` (and its `BEGIN CLAUDE-MODEL-TABLE` extraction marker — the test
  slices by marker). Gate: `claude-model-table` (rename with it), `runtime-meter-truth`.
- 1.4 Claude: MCP entry builders (`buildMcpServers`, `withSessionStamp`, `withToolProfileStamp`,
  `withToolSetStamp`, `doplBearer`, `clientTimeoutMs`) `loader.js` → `mcp.js`. ⚠ `mcp.js` is required
  eagerly by `claude/index.js`; the moved code must keep its lazy `mcp-config` / electron requires or the
  registry stops being electron-free at load. Gate: `mcp-server-tools-policy`, `runtime-stamp-literals`,
  `claude-runtime-start`, `codex-launch-stamps` (header parity).
- 1.5 Claude: `bundledClaude`/`claudeRuntime`/`resolveClaudeExecutable` → `claude/resolve-bin.js`;
  `buildSecretPathDenyRules` → `claude/tools.js` taking `userDataDir` like Cursor's (tools.js must stay
  electron-free — `session-profiles.js` evaluates it standalone). Gate: `runtime-updates`,
  `claude-token-subprocess-env`, `session-builtin-bound`, `launch-max-turns` (it reads the `claude/` dir).
- 1.6 Claude: what is left of `loader.js` → `client.js`; update the lazy `platform` arrow. **Samuel decides**
  (rename vs keep `loader.js` as a documented alias) — highest anchor churn of any step.
- 1.7 Codex: `server-requests.js` → `approval.js`. **Samuel decides**: INVARIANTS §11.0d narrates
  "`approval.js` is deleted (CX-05)" as a deliberate removal of a SECOND translator; this rename re-uses the
  name for the ONE translator, and the bullet must be rewritten in the same change. Gate:
  `codex-server-requests`, `codex-gate`, `dopl-write-op-gating`.
- 1.8 Codex: `catalog.js` → `delegation-fence.js`; `proc-config.js` → `launch-verify.js` (optional; names
  only). Gate: `codex-parity-fences`, `codex-proc-config`, `codex-launch-fences`.
- 1.9 Codex + Cursor: inline `modelArg` → `models.js › modelArg`. Gate: `runtime-launch-default`,
  `launch-runtime-order`.
- 1.10 All three `index.js`: canonical descriptor key order; `toolMode.options` sourced from
  `tools.TOOL_MODE_OPTIONS`; Claude's `windowlessFloor` from `tools.WINDOWLESS_FLOOR`. Gate:
  `adapter-parity`, `settings-agent-posture` (SPA, vitest), `posture-runtime-keyed`.

**Phase 2 — extractions to `kit/` (one module per step, in this order)**
- 2.1 K4 `kit/usage.js` + K5 `kit/auth-shape.js` + the kit vendor-word scan. Gate: `codex-normalize`,
  `cursor-normalize`, `runtime-meter-truth`, `codex-context-forward`.
- 2.2 K2 `kit/frame-queue.js`. Gate: `codex-launch-lifecycle`, `codex-followups`.
- 2.3 K3 `kit/run-handle.js` (codex, then cursor). Gate: `codex-launch-lifecycle`, `cursor-gate`.
- 2.4 K1 `kit/stdio-rpc.js`. Gate: `codex-client-transport`, `codex-app-server-contract`, `codex-signin`,
  `codex-model-list`.
- 2.5 K6 `kit/dopl-mcp.js`. Gate: `runtime-stamp-literals`, `codex-launch-stamps`, `codex-mcp-surface`,
  `mcp-server-tools-policy`.
- 2.6 K7 `held-gate.js` options. Gate: `session-held-gate-approval`, `cursor-axis-b`, `cursor-gate`,
  `codex-gate`.
- 2.7 K8 `kit/private-home.js`. Gate: `codex-config-home`, `codex-hostile-config`, `codex-project-trust`,
  `codex-signin`.
- 2.8 K9 + K10 `kit/bin-resolve.js`, `kit/probe-bin.js`. Gate: `codex-resolve-bin`, `runtime-updates`,
  `runtime-updates-risks`, `codex-app-server-contract`.

**Phase 3 — Muse** on the scaffold (separate wave, after its smoke packet).

**Phase 4 (optional, not needed for Muse)** — close the `core-vocabulary` DEFERRED step-6 rows by moving
`main/claude-auth.js` → `claude/login.js` and `claude-token.js` under `claude/credential.js`.

**What must NOT change**
- `contract.js › RUNTIME_METHODS` names and arities; `LAUNCH_BLOCKING`; `sealAdapter`'s refusals; the
  `mirrorProblems` derivation (`profileEntryFrom`).
- Registration order in `runtime/index.js` (`DEFAULT_ID` = first registered).
- The electron-free-at-load property of `runtime/index.js` (Claude's three lazy requires; every moved module
  keeps its lazy requires).
- `start()` returns synchronously (two-children bug); `normalize` stays pure; `result.sessionTokens` is `null`
  for an unmeasured turn, never `0`.
- Core never requires anything under `main/runtime/<id>/` or `main/runtime/kit/`; core's vendor-word scan stays
  as is; the kit gets its own scan.
- Every file under `main/runtime/` is `.js` and ≤500 lines; no shims or re-export files left behind after a
  move (Samuel's "delete, don't disarm") — except where a test imports a symbol by its old path, which is
  updated in the same step.
- Wire literals: `X-Dopl-Runtime: desktop-session`, each `X-Dopl-Vendor` word, `DOPL_MCP_TOKEN`,
  `shell_environment_policy`, `AUTH_STORE_ARGS`.

---

## 6. Code vs INVARIANTS.md — disagreements found (listed, not fixed)

Per CLAUDE.md precedence (code > INVARIANTS). Items 1–6 read as INVARIANTS being stale (fix the doc);
item 7 is a "cannot tell" → finding.

1. **§11.0 "`RUNTIME_METHODS` (SEVENTEEN @ 2026-09-23, since `rosterKey` and `modelArg` joined)".** Code:
   18 methods, no `rosterKey`; `buildIdentity` and `signOut` are present
   (`node -e "console.log(Object.keys(require('./main/runtime/contract').RUNTIME_METHODS))"`). The
   `core-vocabulary.test.mjs` header says "sixteen"; `new-runtimes-grok-muse-opencode.md` §2 says "19".
2. **§11.0 "THE BUNDLED CLIs SELF-UPDATE" — "`update-source.js` (… vendor Apple team, `compatible`)" and the
   COMPATIBILITY sub-bullet ("Claude: the same `major.minor` …; Codex: `protocol.js › SUPPORTED_CLI` floor").**
   Code: compatibility is the shape gate (`updates/index.js › shapeGate` over each source's `probeShape`);
   `claude/update-source.js` says the `compatible` lockstep rule "is deleted".
3. **§11.0d "THE MEASURED CLI FLOOR IS ENFORCED AT `available()` (CX-06)" — "below `SUPPORTED_CLI.min`
   (`0.155.1`) … refused".** Code: `codex/protocol.js › SUPPORTED_CLI` is `{ measuredFrom }` ("A RECORD, NOT A
   GATE (2026-10-08)"); `› versionGate` only refuses an unreadable version.
4. **§11.0 table row "the Claude model table (`MODEL_IDS`, aliases, context windows, `LAUNCH_MODEL_FALLBACK`) →
   `runtime/claude/model-table.js`"** (and the `MODEL_IDS` list later in §11). Code: `model-table.js` holds
   only `› promptTokens` / `› sessionTokens`; its header says the table is deleted (2026-10-08).
5. **§11.0e "Claude declares `models.launchDefault` (`claude-sonnet-5`) … its adapter still spends it itself
   (`resolveLaunchModel('')`)".** Code: `claude/models.js › descriptor.launchDefault` is `null`; a no-pick
   launch sends no `--model` (`› resolveLaunchModel` returns `arg: ''`).
6. **§11.0e catalog bullets: "`runtime.rosterKey()` is SYNC" and "Without Dopl's token no probe runs … and
   the build's table answers, `stale`".** Code: adapters answer `buildIdentity()` and `roster-key.js ›
   rosterKeyFor` builds the key; signed out, `claude/models.js › models` THROWS ("not signed in to Dopl"), and
   there is no table — which the adjacent bullet ("NO FROZEN TABLE (DELETED 2026-10-08)") already says, so §11.0e
   contradicts itself.
7. **§11.0 "Every file under `main/runtime/**` must be `.js` … (`test/eslint-config-coverage.test.mjs` walks
   it)".** The tree holds `claude/skills/dopl-channels-wait/SKILL.md`, `…/dopl-channel-wait.sh` and
   `model-preferences.seed.json`; and `core-vocabulary.test.mjs`'s ".js only" loop is vacuous because its
   `walk` already filters to `.js`. Either the rule means "every CODE file" (doc fix) or the assets belong
   elsewhere (code fix) — cannot tell which; file as a finding (allocate the `F-` id from the highest on any
   live branch).

Also noted (not INVARIANTS): the task framing "vendor words forbidden outside `main/runtime/<id>/`" is
stricter than the code — `core-vocabulary` exempts all of `main/runtime/`, which is why `cli-spawn.js` may name
`ANTHROPIC_API_KEY` / `CODEX_API_KEY`. The kit scan in §3 closes that gap for new shared code only.

---

## 7. Open questions for Samuel

Answered 2026-10-13: 1 = rename (D1, done); 2 = yes, with the bullet rewritten (D2, done); 3 = `main/runtime/kit/` (D3);
4 = Phase 0 → 1 first (done). Kept below as asked.


1. Rename Claude's `loader.js` → `client.js` (39 doc anchors move) or keep `loader.js` as the one documented
   alias? Recommend: rename, after steps 1.4–1.5 shrink it.
2. Rename Codex's `server-requests.js` → `approval.js`, re-using a name INVARIANTS records as deliberately
   deleted? Recommend: yes, with the §11.0d bullet rewritten in the same commit.
3. Kit location: new `main/runtime/kit/` (recommended) or flat files beside `cli-spawn.js` / `held-gate.js`?
4. Order: do Phase 0–1 before Muse and Phase 2 alongside Muse (Muse is the second consumer that justifies
   K1–K3, K8–K10), or all of Phase 2 first? Recommend: 0 → 1 → 2.1–2.4 → Muse → rest of 2.
