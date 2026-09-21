---
title: Codex Runtime Parity and Launch Reliability
type: fix
status: active
date: 2026-09-21
deepened: 2026-09-21
---

# Codex Runtime Parity and Launch Reliability

## Summary

Make Codex a real, first-class Dopl runtime across New Agent, profile defaults, channel settings, MCP-directed launches, credentials, permissions, model selection, and the full session lifecycle. The work keeps Dopl's existing runtime-adapter architecture, replaces Claude-shaped shared state with runtime-aware contracts, and updates the Codex adapter to the installed `codex app-server` protocol before any UI claims Codex is connected or launchable.

The recommended permissions UX uses stable Dopl category labels—`Tool use`, `Messaging`, `Sandbox`, `Model`—while each selected runtime supplies its own option labels, descriptions, ordering, and validation. Codex-only dimensions such as sandbox, granular approval categories, and reasoning effort appear only when Codex declares and actually supports them; Dopl does not invent false Claude-to-Codex synonyms.

---

## Master Ticket Sheet

This table is the implementation index. Every row is independently assignable once its dependencies are complete; the detailed acceptance criteria live in the matching implementation unit.

| ID | Ticket | Objective | Depends on | Exit signal |
|---|---|---|---|---|
| U1 | Freeze the live Codex protocol contract | Replace speculative fixtures with generated-schema and live-process evidence | None | Compatibility suite fails against old Dopl shapes and passes against supported Codex CLI |
| U2 | Resolve Codex binary and credentials per runtime | Make Finder-launched Dopl locate Codex and gate on Codex login, not Claude login | U1 | Connected/launchable state is correct with normal, missing, and signed-out Codex installs |
| U3 | Modernize the Codex app-server client | Fix start, turn, steer, interrupt, usage, and lifecycle handling | U1, U2 | A real Codex turn launches, streams, completes, steers, and interrupts through Dopl |
| U4 | Prove security isolation and Dopl MCP approvals | Replace the removed config-isolation flag without widening permissions | U1, U3 | Ambient config cannot silently widen a Dopl session; a Dopl MCP call is observed and gated end-to-end |
| U5 | Introduce runtime-neutral launch settings | Remove Claude enums and model coercion from shared session/default state | U1 | Shared state carries Dopl semantics plus runtime-keyed native settings without cross-runtime coercion |
| U6 | Deliver runtime-scoped model catalogs | Expose live Codex models, defaults, reasoning effort, and per-runtime remembered picks | U2, U5 | Switching runtime immediately shows a valid roster and preserves each runtime's prior choice |
| U7 | Finish the New Agent dialog | Make runtime drive model, permission, default, template, and refusal behavior | U5, U6 | Codex selection never shows or submits a Claude model or Claude-only term |
| U8 | Finish profile and channel settings | Make default runtime/model/permissions editable and persistent at both scopes | U5, U6 | New channels inherit the chosen runtime-aware profile defaults; existing channels remain unchanged |
| U9 | Add runtime to MCP launch directives | Allow an MCP caller to deliberately launch Claude or Codex | U5 | `manage launch` with `runtime: codex` produces a Codex session and records the applied runtime |
| U10 | Make lifecycle, telemetry, and refusals runtime-honest | Fix usage, active-turn state, resume, errors, and user-visible copy | U3, U5 | No Codex failure is reported as a Claude sign-in or generic SDK problem |
| U11 | Run the release matrix and update the contract docs | Prove packaged desktop behavior and Claude regression safety | U2-U10 | All automated, live, packaging, UI, and MCP checks pass on a clean supported machine |

---

## Problem Frame

Dopl presents Codex as a selectable runtime, but multiple shared paths still assume that a model and tool mode belong to Claude. A live MCP test demonstrated the user-visible consequence: a launch request carrying `model: "codex"` was accepted but actually started a Claude Sonnet agent because the MCP contract has no runtime field and an unknown model falls through to the default Claude adapter.

The true Codex adapter is also incompatible with the installed Codex CLI. It always supplies a removed `--ignore-user-config` flag, extracts the thread ID from an obsolete response location, sends turn input as a string instead of a sequence, omits the active turn ID from steer/interrupt operations, and reads usage from an event that no longer contains it. Existing tests all pass because they pin the old flag and use synthetic protocol fixtures rather than exercising a current app-server.

The UI is partially wired: New Agent, channel settings, and profile defaults already display runtime choices. However, their model source, durable model validation, permission storage, credential preflight, and several refusal messages remain Claude-specific. As a result, the visible runtime selector and the actual launched runtime are not yet one coherent contract.

---

## Requirements

- R1. Selecting Codex in New Agent must launch Codex and must immediately replace the Claude/Fable model choices with models reported by the connected Codex runtime.
- R2. Profile Settings → Agents must allow a default runtime, a runtime-valid default model, and runtime-appropriate supervision settings; a newly created channel inherits that complete selection exactly once.
- R3. Per-channel agent settings must allow the same runtime-aware configuration without changing already-running sessions or silently discarding a saved choice.
- R4. Shared product language must not expose Claude-only terms as if they were universal. Dopl must preserve a stable cross-runtime meaning while still exposing native controls where semantics cannot be mapped exactly.
- R5. An MCP launch request must be able to name `runtime: codex`; omission must retain a documented default/fallback rule, and the result must report the runtime actually applied.
- R6. The Codex adapter must work with a supported current `codex app-server` protocol for start, resume, turn start, steer, interrupt, approvals, MCP tool calls, streamed content, completion, and token usage.
- R7. Codex availability and sign-in checks must be adapter-owned. A valid Codex launch cannot be blocked by Claude credential state, and a signed-out Codex installation cannot be reported as launchable.
- R8. Dopl-launched Codex sessions must not inherit ambient user configuration in a way that widens permissions, MCP servers, hooks, filesystem access, network access, or agent chaining.
- R9. Runtime/model/supervision selections must survive application restart and version migration without applying a Claude model or native permission word to Codex, or vice versa.
- R10. Existing Claude launch, permission, template, resume, MCP, and settings behavior must remain covered and unchanged except for the new vendor-neutral display vocabulary.
- R11. Unsupported/missing/signed-out Codex states and protocol drift must produce specific Codex-facing diagnostics and safe refusals rather than silent Claude fallback.
- R12. Completion requires automated contract tests plus a packaged-desktop smoke test; passing synthetic unit fixtures alone is insufficient.

---

## Scope Boundaries

- Keep `codex app-server` as the desktop integration boundary because Dopl needs held approvals, streamed events, and explicit lifecycle control. Do not replace it with the Codex SDK unless implementation research proves equivalent approval and event control.
- Do not redesign Dopl's general messaging axis, agent-chain limit, tool profiles, or multiplayer authorization. They remain runtime-neutral inputs to this work.
- Do not add Cursor parity as part of this plan. Shared abstractions must not break Cursor, but Cursor-specific unfinished capabilities remain separate work.
- Do not silently bundle or depend on the private executable inside another application bundle. Packaging may choose a bundled/signed Codex binary or a documented external installation, but that product/distribution choice must be explicit and tested.
- Do not enable unrestricted permissions as a migration fallback. Unknown, stale, or partially migrated values resolve to the narrowest supported behavior and surface a recoverable configuration state.
- Do not change a running session's runtime. Runtime, model, native policy, and conversation handle are stamped at spawn; setting changes apply to later launches.

---

## Context & Research

### Confirmed Current-State Failures

| Surface | Current behavior | Evidence | Required correction |
|---|---|---|---|
| MCP launch | `model` is accepted but there is no runtime selector; default adapter wins | `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`, `packages/mcp-server/src/tools/channel-ops-launch.ts`, `dopl-desktop-app/main/launch-directive-spawn.js` | Carry a separately validated runtime through the complete directive and report the applied value |
| Actual Codex process | App-server exits before initialize | `dopl-desktop-app/main/runtime/codex/launch-spec.js`, `dopl-desktop-app/main/runtime/codex/models.js`; installed CLI rejects `--ignore-user-config` | Replace the removed flag with a supported isolation design and compatibility check |
| Thread creation | Dopl looks for a top-level thread ID | Current response carries the ID at `thread.id` | Parse the supported response and treat a missing ID as a protocol error |
| Turn input | Dopl sends a string | Current `turn/start` and `turn/steer` require a sequence of input items | Adapt Dopl prompt strings to current user-input items |
| Steer/interrupt | Dopl does not track/send the current turn ID | Current requests require `expectedTurnId` or `turnId` | Track active turn state and clear it only on terminal events |
| Usage | Dopl expects usage on turn completion | Current usage arrives on `thread/tokenUsage/updated` | Normalize incremental and cumulative usage from the dedicated notification |
| Model core | Every session goes through Claude's `session-model` normalizer | `dopl-desktop-app/main/session-engine.js`, `dopl-desktop-app/main/session-model.js` | Move validation and launch conversion behind the selected runtime adapter |
| Model UI | Frozen Claude list is shared by every runtime | `src/features/channels/lib/agent-models.ts`, `src/features/channels/components/launch-agent-dialog.tsx` | Supply a runtime-keyed model catalog over the desktop bridge |
| Profile/channel storage | Model and tools fields validate against Claude-only enums | `dopl-desktop-app/main/agent-defaults.js`, `dopl-desktop-app/main/channel-prefs.js` | Persist model and native policy choices in runtime-keyed records |
| Credentials | Every runtime passes through Claude credential preflight | `dopl-desktop-app/main/session-engine.js`, `dopl-desktop-app/main/session-auth.js` | Delegate availability and credentials to the selected adapter |
| Binary discovery | Codex is spawned only as `codex` from inherited PATH | `dopl-desktop-app/main/runtime/codex/client.js`, `dopl-desktop-app/main/runtime/codex/credential.js` | Add deterministic GUI-safe discovery and a supportable packaging policy |
| Permissions UI | Runtime-native options render, but non-Claude writes are rejected; Codex sandbox/category rows are read-only | `src/features/channels/components/settings-agent-launch-rows.tsx` documents F-390 | Replace the mismatched display/storage contract rather than relaxing the Claude enum |
| Tests | 94 targeted tests pass against stale assumptions | `dopl-desktop-app/test/codex-gate.test.mjs`, `dopl-desktop-app/test/codex-normalize.test.mjs` | Add generated-schema and live-process characterization coverage |

### Relevant Code and Patterns

- Runtime registry and adapter contract: `dopl-desktop-app/main/runtime/index.js`, `dopl-desktop-app/main/runtime/contract.js`, `dopl-desktop-app/main/runtime/capability.js`.
- Codex adapter: `dopl-desktop-app/main/runtime/codex/`.
- Session launch and lifecycle: `dopl-desktop-app/main/session-launch.js`, `dopl-desktop-app/main/session-engine.js`, `dopl-desktop-app/main/session-query.js`, `dopl-desktop-app/main/session-reopen.js`.
- Durable defaults and channel posture: `dopl-desktop-app/main/agent-defaults.js`, `dopl-desktop-app/main/channel-prefs.js`, `dopl-desktop-app/main/channel-runtime.js`, `dopl-desktop-app/main/channel-dir-ipc.js`.
- New Agent and settings surfaces: `src/features/channels/components/launch-agent-dialog.tsx`, `src/features/channels/components/settings-agent-launch-rows.tsx`, `src/features/channels/components/agent-defaults-settings.tsx`.
- Existing capability-probe pattern: `src/features/channels/lib/runtime-capability.ts`, `src/features/channels/hooks/use-channel-launch-posture.ts`, `src/features/channels/hooks/use-agent-defaults.ts`.
- MCP and directive wire: `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`, `packages/mcp-server/src/tools/channel-ops-launch.ts`, `packages/dopl-client/src/launch-types.ts`, `src/features/channels/schema-launch.ts`, `src/features/channels/types-launch.ts`, `dopl-desktop-app/main/launch-directive-wire.js`, `dopl-desktop-app/main/launch-directive-spawn.js`.

### Institutional Learnings

- `docs/INVARIANTS.md` requires unknown capability to remain different from an empty value, runtime to be stamped at spawn, controls that write nowhere to remain absent, and process-boundary inputs to be revalidated in main.
- `docs/REFACTOR-FINDINGS.md` F-390 already records the permission display/storage mismatch. This plan closes it by changing the shared contract, not by weakening validation.
- Existing comments require profile defaults to seed new channels once and never become an ambient launch-time fallback. That behavior stays intact.
- The documented `--ignore-user-config` assumption is stale relative to the installed CLI. Documentation and tests must be updated together with the replacement isolation mechanism.

### External References

- OpenAI's official [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk) distinguishes the SDK's local-thread API from app-server use cases that need custom clients, approvals, streamed events, and conversation history.
- The installed CLI's generated app-server JSON schema is the authoritative protocol fixture for the supported binary. Generate it during test setup with the CLI rather than copying remembered request shapes into tests.

---

## Key Technical Decisions

### 1. Keep category language agnostic and option language runtime-native

The stable product vocabulary should name concepts Dopl actually owns: `Runtime`, `Model`, `Tool use`, `Messaging`, `Sandbox`, and `Working folder`. The options inside runtime-owned concepts should change with the selected runtime:

| Selected runtime | Tool-use options | Additional runtime controls |
|---|---|---|
| Claude Code | Claude's native `Ask each time`, `Accept edits`, `Auto`, and `Bypass` choices, with the existing reviewed descriptions | No Codex sandbox/category rows |
| Codex | Codex approval-policy choices using their native labels and descriptions | `Sandbox`; structured granular approval categories when supported; reasoning effort beside Model |

Messaging remains Dopl-owned and keeps one vocabulary because Dopl, rather than either vendor, gates channel delivery. Runtime-native choices must be ordered narrowest-to-widest by the adapter descriptor, and an unknown value fails closed to the narrowest member.

This is preferred over both alternatives the user raised:

- Do not map the options one by one. `Accept edits` is not equivalent to a single Codex approval mode because Codex separates approval policy from sandbox containment, and `granular` has no Claude equivalent.
- Do not make every label vendor-specific. Stable category names let the page remain coherent while runtime switching changes only the controls whose underlying platform semantics genuinely differ.

Persist each runtime's native settings in a runtime-keyed record. Switching Claude → Codex → Claude restores both sets rather than translating, clearing, or reinterpreting them. A compact native summary can still show the effective combination, for example `on-request approvals · workspace-write sandbox`, but it is a report of actual values rather than a synthetic cross-runtime preset.

### 2. Store runtime-scoped model choices and advanced settings

A Claude model and a Codex model are not members of one global enum. Default and per-channel records should retain a model choice per runtime, with the selected runtime deciding which choice is active. Switching away and back restores that runtime's prior model rather than clearing it or coercing it through another adapter.

Codex model discovery must preserve the server's display name, model ID, `isDefault`, supported reasoning efforts, and default reasoning effort. Hidden models remain out of ordinary pickers. If discovery fails, the UI shows the runtime's platform-default state plus a specific roster error; it must not substitute Fable or a cached Claude list.

### 3. Keep native policy conversion inside adapters

Shared launch state carries Dopl-owned messaging plus runtime-keyed model and native policy settings. The selected adapter validates and converts its own record into launch arguments/config. Core session code must not normalize model IDs, permission words, credentials, or error strings through the Claude adapter.

### 4. Runtime is a first-class field, never inferred from model

`runtime: codex` chooses the adapter. `model: gpt-6-astra` chooses a model within that adapter. A model name must never double as a runtime selector. UI launches always send the selected runtime; MCP launches may omit it only to invoke the documented channel/default chain.

### 5. Retain app-server, but version and characterize it

The app-server is the correct integration surface for Dopl's approval and event needs. Dopl should establish a supported CLI/protocol range, verify required methods and response shapes at startup, and refuse with an actionable upgrade/downgrade message when incompatible. Generated schema fixtures and a bounded live handshake prevent synthetic tests from becoming the sole source of truth again.

### 6. Isolation is a release gate, not a flag deletion

Removing `--ignore-user-config` without a replacement would fix startup while weakening security. U4 must identify a supported isolation boundary—such as an app-owned config root plus explicit thread policy—and prove that user MCP servers, hooks, approval policy, sandbox, and other ambient configuration cannot widen Dopl's chosen settings. Authentication may be shared only through a deliberately scoped mechanism.

---

## Open Questions

### Resolved During Planning

- **Agnostic terms or runtime-switched terms?** Use agnostic category/row names and runtime-native inputs. Claude shows Claude choices; Codex shows Codex approval policy plus its separate sandbox/categories.
- **Map permissions one by one?** No. The platforms expose different dimensions, so one-to-one translation would be misleading. Preserve each runtime's prior native choices independently.
- **SDK or app-server?** Retain app-server because Dopl requires approvals and streamed lifecycle control that the current architecture already models.
- **Should runtime be inferred from a Codex model?** No. Runtime and model remain separate validated fields.

### Deferred to Implementation

- **Codex distribution strategy:** Decide whether Dopl bundles/signs a supported binary or locates a separately installed one after confirming license, update, code-signing, and support implications. U2 cannot be considered complete without this decision.
- **Supported CLI range:** Establish from live schema/handshake testing rather than guessing from the current version string.
- **Codex's exact structured granular-policy shape:** Capture and validate it from the supported app-server schema and live approval flow during U4/U5.
- **Authentication/config separation mechanism:** Validate with the installed CLI. The desired security properties are fixed; the supported mechanism may vary by CLI version.
- **Usage on resume:** Measure whether token totals reset or remain cumulative before enabling Codex resume, because the cost/context deltas depend on that answer.

---

## High-Level Technical Design

```mermaid
flowchart LR
    UI[New Agent / Profile Defaults / Channel Settings] --> C[Canonical launch selection]
    MCP[MCP manage launch] --> C
    C --> R{Selected runtime}
    R -->|Claude| CA[Claude adapter]
    R -->|Codex| CX[Codex adapter]
    CA --> CP[Claude model + native policy]
    CX --> XP[Live Codex catalog + approval/sandbox/reasoning]
    CP --> S[Spawn-stamped session]
    XP --> S
    S --> E[Normalized Dopl lifecycle events]
    E --> O[UI, telemetry, MCP result, persisted resume record]
```

The shared selection contains runtime, Dopl messaging policy, and runtime-keyed model/native settings. The adapter is the only layer that turns its runtime record into native process arguments and protocol requests. The session record stores both the runtime and the exact effective native choices used at spawn so a resume cannot cross runtimes or silently inherit newer defaults.

---

## Implementation Units

### U1. Characterize and Gate the Current Codex Protocol

**Goal:** Establish a repeatable compatibility contract against the real installed app-server before changing production behavior.

**Requirements:** R6, R11, R12

**Dependencies:** None

**Files:**
- Modify: `dopl-desktop-app/test/codex-gate.test.mjs`
- Modify: `dopl-desktop-app/test/codex-normalize.test.mjs`
- Create: `dopl-desktop-app/test/codex-app-server-contract.test.mjs`
- Create or modify: a focused test helper under `dopl-desktop-app/test/` for bounded app-server handshakes and captured fixtures
- Modify: `dopl-desktop-app/main/runtime/codex/client.js`

**Approach:**
- Generate the supported CLI's app-server schema during a deliberate compatibility-update workflow and check in only the minimal normalized fixture needed by tests, including the CLI version and generation command.
- Capture a safe read-only live transcript covering initialize, model list, thread start, turn start, token usage, turn completion, and shutdown. Add separate bounded probes for steer and interrupt.
- Add a capability/version gate that verifies required methods and critical fields before reporting Codex as connected.
- Delete assertions that require the removed `--ignore-user-config` flag. Replace them with assertions for the security mechanism chosen in U4.
- Make live tests opt-in for ordinary unit runs but mandatory in the release verification command and CI environment that provisions Codex.

**Execution note:** Characterization-first. Commit failing tests that reproduce the current request/response drift before changing the adapter.

**Test scenarios:**
- Happy path: supported CLI completes initialize and returns a model catalog with a single declared default.
- Error path: missing method/required field returns an `unsupported-protocol` diagnostic and does not mark Codex connected.
- Edge case: schema contains additional fields or methods; Dopl ignores them without treating unknown as empty.
- Error path: handshake times out; child process is terminated and no picker hangs.
- Integration: current installed CLI rejects the old Dopl request shapes and accepts the new normalized shapes.

**Verification:** A reviewer can update the compatibility fixture from a real CLI using one documented command, and the suite detects each confirmed drift listed in the research table.

### U2. Codex Binary Discovery, Packaging, and Credential Ownership

**Goal:** Make the exact Codex executable and authentication state deterministic for a packaged macOS desktop app.

**Requirements:** R7, R11, R12

**Dependencies:** U1

**Files:**
- Modify: `dopl-desktop-app/main/runtime/codex/client.js`
- Modify: `dopl-desktop-app/main/runtime/codex/credential.js`
- Modify: `dopl-desktop-app/main/runtime/codex/packaging.js`
- Modify: `dopl-desktop-app/main/runtime/connectivity.js`
- Modify: `dopl-desktop-app/main/session-launch.js`
- Modify: `dopl-desktop-app/main/session-auth.js`
- Test: `dopl-desktop-app/test/codex-gate.test.mjs`
- Test: `dopl-desktop-app/test/runtime-contract.test.mjs`
- Create or modify: packaged-app smoke scripts under the existing desktop build/test structure

**Approach:**
- Create one Codex executable resolver used by probe, credential status, model discovery, and session launch.
- Make GUI-safe discovery explicit: selected path or bundled path first, then supported install locations/login-shell discovery if the packaging decision allows it.
- Return structured states for missing binary, incompatible binary, signed out, probe timeout, and ready; cache only where existing connectivity semantics permit.
- Move launch credential preflight behind the selected runtime adapter. Claude continues to use Claude credential checks; Codex uses `codex login status` or the supported equivalent.
- Ensure diagnostics may report the resolved executable version/source but never tokens or auth material.

**Test scenarios:**
- Happy path: a packaged/Finder-launched app with a valid supported Codex binary reports connected and launches it.
- Edge case: shell PATH lacks Codex but an explicitly supported installation is found.
- Error path: Codex exists but is signed out; UI offers the runtime with a `Sign in to Codex` action and launch safely refuses.
- Error path: Claude is signed out while Codex is ready; Codex launch succeeds.
- Error path: Codex is missing/incompatible; Claude launch remains unaffected.
- Security: resolver never executes a writable/untrusted path merely because its filename is `codex`.

**Verification:** Probe, roster, login status, and launch all report the same resolved binary/version in diagnostics, including from a signed packaged app started outside a terminal.

### U3. Modernize the Codex App-Server Session State Machine

**Goal:** Bring the adapter's process and JSON-RPC lifecycle into agreement with the supported current protocol.

**Requirements:** R6, R11, R12

**Dependencies:** U1, U2

**Files:**
- Modify: `dopl-desktop-app/main/runtime/codex/client.js`
- Modify: `dopl-desktop-app/main/runtime/codex/launch-spec.js`
- Modify: `dopl-desktop-app/main/runtime/codex/normalize.js`
- Modify: `dopl-desktop-app/main/runtime/codex/approval.js`
- Modify: `dopl-desktop-app/main/runtime/codex/index.js`
- Test: `dopl-desktop-app/test/codex-normalize.test.mjs`
- Test: `dopl-desktop-app/test/codex-gate.test.mjs`
- Test: `dopl-desktop-app/test/runtime-contract.test.mjs`

**Approach:**
- Parse thread start from the current nested thread object and record the model the server actually selected.
- Encode each Dopl prompt as current app-server user-input items; preserve room framing as text without exposing protocol shapes to shared core.
- Track active turn ID from turn start through completion/error. Use it for steer and interrupt, and reject stale commands instead of targeting the wrong turn.
- Normalize current item/content deltas into existing Dopl events without leaking native event shapes into session core.
- Consume `thread/tokenUsage/updated`, keep last/total usage semantics explicit, and carry the reported context window.
- Make completion, error, child exit, timeout, and cancellation converge on one terminal cleanup path so resolvers, child processes, and active-turn state cannot leak.
- Re-measure resume and fork before changing their `unverified` capability flags.

**Test scenarios:**
- Happy path: cold launch yields one launched event, streamed text, token/context updates, and one terminal result.
- Happy path: steer targets the current turn and is rejected after that turn completes.
- Happy path: interrupt targets the active turn and Dopl receives a terminal interrupted state.
- Error path: thread start returns no usable thread ID; launch fails immediately and kills the child.
- Error path: app-server rejects a turn; the session becomes failed once with the native reason safely summarized.
- Edge case: late notifications arrive after completion; they do not revive the session or double-count usage.
- Integration: crash/restart never resumes a Codex conversation through the Claude adapter.

**Verification:** A real, safe Codex session can be launched, prompted, steered, interrupted, and completed from Dopl with no orphan app-server process and accurate visible model/token state.

### U4. Security Isolation, Approval Capture, and Dopl MCP Proof

**Goal:** Preserve Dopl's containment and approval guarantees after removing the obsolete config-isolation flag.

**Requirements:** R4, R6, R8, R12

**Dependencies:** U1, U3

**Files:**
- Modify: `dopl-desktop-app/main/runtime/codex/launch-spec.js`
- Modify: `dopl-desktop-app/main/runtime/codex/mcp.js`
- Modify: `dopl-desktop-app/main/runtime/codex/approval.js`
- Modify: `dopl-desktop-app/main/runtime/codex/axis-b.js`
- Modify: `dopl-desktop-app/main/runtime/codex/tools.js`
- Modify: `dopl-desktop-app/main/runtime/codex/packaging.js`
- Test: `dopl-desktop-app/test/codex-gate.test.mjs`
- Create: a Codex security/isolation integration test under `dopl-desktop-app/test/`

**Approach:**
- Define the supported isolated config/auth arrangement and write its threat model into the adapter docs/tests.
- Explicitly set approval policy, sandbox, workspace, Dopl MCP entry, and any required hook/tag configuration for every launch; do not assume user defaults.
- Launch against a hostile test config containing a wider sandbox, `never` approvals, extra MCP server, and hook. Prove none are inherited unless deliberately allowed.
- Capture real approval request payloads for built-in commands, file changes, and the Dopl MCP tool. Update classification and decision responses from measured fields rather than the current generic empty input.
- Verify Dopl's hard deny, profile deny list, outbound message gate, thread tagging/self-filter, and agent-chain bound still apply when Codex uses native approval words.
- Fail launch if the Dopl MCP server is required for the selected profile but not actually connected.

**Test scenarios:**
- Security: hostile ambient config cannot widen sandbox, approvals, network access, MCP servers, or hooks.
- Happy path: a safe Dopl channel read/post tool call reaches the expected held approval callback and produces the correct audit trail.
- Error path: Dopl MCP connection is absent; launch refuses before the agent can claim channel capability.
- Security: `never` approval mode does not bypass Dopl universal hard denies or outbound consent.
- Edge case: approval payload lacks a classifiable target; decision is restrictive and the UI names why.

**Verification:** Security tests prove the effective runtime policy, rather than only inspecting assembled arguments, and a real Dopl MCP call is observed end-to-end through Codex.

### U5. Runtime-Neutral Launch Settings and Migration

**Goal:** Replace Claude-shaped shared model/tool fields with runtime-keyed records that adapters validate and interpret themselves.

**Requirements:** R2, R3, R4, R7, R9, R10

**Dependencies:** U1

**Files:**
- Modify: `dopl-desktop-app/main/channel-prefs.js`
- Modify: `dopl-desktop-app/main/agent-defaults.js`
- Modify: `dopl-desktop-app/main/channel-runtime.js`
- Modify: `dopl-desktop-app/main/session-engine.js`
- Modify: `dopl-desktop-app/main/session-launch.js`
- Modify: `dopl-desktop-app/main/session-profiles-runtime.js`
- Modify: `dopl-desktop-app/main/runtime/contract.js`
- Modify: `dopl-desktop-app/main/runtime/capability.js`
- Modify: adapter descriptors under `dopl-desktop-app/main/runtime/claude/` and `dopl-desktop-app/main/runtime/codex/`
- Test: `dopl-desktop-app/test/agent-defaults.test.mjs`
- Test: `dopl-desktop-app/test/channel-runtime.test.mjs`
- Test: `dopl-desktop-app/test/session-model.test.mjs`
- Test: `dopl-desktop-app/test/runtime-contract.test.mjs`

**Approach:**
- Add a versioned stored launch-selection shape containing the selected runtime, Dopl messaging mode, and a runtime-keyed record for model and native tool/containment settings.
- Migrate an existing global model and tool mode into Claude's runtime record without translating their meaning. Preserve the write-once new-channel seed rule.
- Keep legacy readers during one compatibility window if required by preload/renderer version skew; writes use the new shape and replies carry explicit capability/version fields.
- Make the selected adapter validate and map supervision/model/native settings. Shared core stores and stamps effective values but does not reinterpret vendor IDs.
- Define fail-closed behavior for unknown record versions, missing runtime descriptors, stale model IDs, and unknown native settings.
- Preserve existing running-session fan-out rules: live supervision may narrow/widen only where current invariants allow; runtime/model/sandbox changes wait for a new spawn.

**Test scenarios:**
- Migration: existing Claude channel/default records retain equivalent behavior and model after first read/write.
- Happy path: a Codex record accepts Codex model IDs and native advanced settings without passing through Claude enums.
- Edge case: switch Claude → Codex → Claude restores both remembered model choices.
- Error path: malformed or future-version record resolves to restrictive supervision and surfaces `needs review`; it never becomes unrestricted.
- Regression: new profile defaults seed only newly created channels; existing channels are not repointed.
- Regression: version-skewed renderer cannot smuggle unknown runtime or native policy values across main validation.

**Verification:** No shared storage or session-core path imports Claude's model/tool enums to validate a Codex launch, and table-driven tests prove each adapter rejects unknown native values toward its narrowest behavior.

### U6. Runtime Model Catalog, Defaults, and Reasoning Effort

**Goal:** Provide the renderer with an authoritative, runtime-keyed model catalog and persist valid runtime-specific selections.

**Requirements:** R1, R2, R3, R9, R11

**Dependencies:** U2, U5

**Files:**
- Modify: `dopl-desktop-app/main/runtime/codex/models.js`
- Modify: `dopl-desktop-app/main/runtime/claude/models.js`
- Modify: `dopl-desktop-app/main/channel-dir-ipc.js`
- Modify: `dopl-desktop-app/renderer/app-preload.js` only if the existing bridge record cannot carry the catalog additively
- Replace or refactor: `src/features/channels/lib/agent-models.ts`
- Modify: `src/features/channels/lib/runtime-capability.ts`
- Modify: `src/features/channels/hooks/use-channel-launch-posture.ts`
- Modify: `src/features/channels/hooks/use-agent-defaults.ts`
- Test: `dopl-desktop-app/test/session-model.test.mjs`
- Test: `src/features/channels/hooks/use-channel-launch-posture.test.tsx`
- Create or modify: focused model-catalog hook tests in `src/features/channels/`

**Approach:**
- Extend runtime descriptors/replies with normalized model catalog data, catalog status, and optional dimensions rather than introducing another hardcoded renderer table.
- Preserve Codex `displayName`, `id`, `isDefault`, `supportedReasoningEfforts`, and `defaultReasoningEffort`; paginate model discovery if the server returns a cursor.
- Keep catalogs cached by resolved binary/version and invalidate on reconnect/version change. Expose loading, ready, unavailable, and stale states distinctly.
- Treat omission as the platform default. In a picker, display the server-declared default model without persisting a model until the operator picks one, matching the existing display-versus-wire discipline.
- Store reasoning effort per Codex model or normalize it when the selected model does not support the previous effort.
- Keep unknown effective models visible as raw IDs on historical session cards, while preventing a stale/unavailable ID from being newly selected.

**Test scenarios:**
- Happy path: Codex catalog orders visible models from the response and marks exactly the reported default.
- Happy path: reasoning effort options change with the selected Codex model and default correctly.
- Error path: catalog fetch fails; UI shows platform default/unavailable state and never shows Claude models.
- Edge case: a model disappears after upgrade; historical sessions still show its raw ID and a new launch asks for a current choice or uses platform default.
- Regression: Claude roster and labels remain unchanged and are delivered through the same normalized contract.

**Verification:** There is one runtime-aware source of model choice data for New Agent, profile defaults, channel settings, and agent summaries; none can render Fable while Codex is selected.

### U7. New Agent Runtime-Driven UX

**Goal:** Make the New Agent dialog's displayed and submitted configuration derive from the same selected runtime.

**Requirements:** R1, R4, R9, R11

**Dependencies:** U5, U6

**Files:**
- Modify: `src/features/channels/components/launch-agent-dialog.tsx`
- Modify: `src/features/channels/components/launch-agent-dialog-runtime.ts`
- Modify: `src/features/channels/hooks/use-agent-launch.ts`
- Modify: `src/features/channels/hooks/use-agent-launch-run.ts`
- Modify: relevant template resolution in `src/features/agent-templates/`
- Test: `src/features/channels/components/launch-agent-dialog.test.tsx`
- Test: `src/features/channels/components/launch-agent-dialog-runtime.test.tsx`
- Test: `src/features/channels/components/launch-agent-prefill.test.tsx`

**Approach:**
- Runtime selection becomes the input to model catalog, supervision summary, native advanced settings, connection/refusal copy, and payload assembly.
- Preselect the operator's explicit per-launch value, then the channel runtime if connected, then the configured default runtime; retain the existing rule that every reported runtime remains visible even when disconnected.
- When runtime changes, display that runtime's remembered model or its reported platform default. Never submit a template/channel model that belongs to another runtime.
- Give templates an explicit runtime affinity/default model or treat a template model as applicable only to its runtime. Surface incompatibility instead of silently translating model IDs.
- Always send the selected runtime on a UI launch. Send model/reasoning/native overrides only when valid for that runtime.
- Replace generic/Claude refusal messages with descriptor-provided runtime-specific actions.

**Test scenarios:**
- Happy path: open dialog on Claude → Fable is shown; select Codex → current Codex models appear and the launch payload contains `runtime: codex`.
- Happy path: change back to Claude → prior Claude choice returns; change again → prior Codex choice returns.
- Edge case: selected template contains a Claude model while runtime is Codex; the model is not submitted and the UI explains the template mismatch.
- Error path: Codex is signed out; it remains listed, shows `Not connected`, and launch routes to Codex sign-in rather than Claude sign-in.
- Regression: untouched model still follows the selected runtime's default rather than becoming a frozen per-spawn override.

**Verification:** Component tests assert both what the user sees and the exact semantic payload consumed by main for every runtime switch path.

### U8. Profile Defaults and Per-Channel Settings

**Goal:** Let users set default and channel-scoped runtime/model/supervision choices with honest runtime-specific controls.

**Requirements:** R2, R3, R4, R9, R10

**Dependencies:** U5, U6

**Files:**
- Modify: `src/features/channels/components/agent-defaults-settings.tsx`
- Modify: `src/features/channels/components/settings-agent-launch-rows.tsx`
- Modify: `src/features/channels/hooks/use-agent-defaults.ts`
- Modify: `src/features/channels/hooks/use-channel-launch-posture.ts`
- Modify: `src/features/channels/lib/permission-modes.ts`
- Modify: `src/features/channels/lib/runtime-capability.ts`
- Test: `src/features/channels/components/settings-agent-runtime.test.tsx`
- Test: `src/features/channels/hooks/use-channel-launch-posture.test.tsx`
- Create or modify: profile defaults component/hook tests

**Approach:**
- Render rows in dependency order: runtime, model, reasoning effort when supported, runtime-native tool use, runtime-specific containment/categories, messaging, and agent chaining.
- Use the same reusable rows and catalog data at profile-default and channel scope while preserving their different persistence semantics.
- Allow Codex sandbox, granular categories, and other declared native dimensions to become real controls only after U5 provides a validated write path; remove the current display-only illusion.
- Use Dopl-owned row labels with runtime-native option labels/descriptions generated from the selected adapter's descriptor.
- Mark dangerous choices clearly and retain existing warning/confirmation behavior for combinations that widen both automation and messaging.
- Do not mutate existing channels when profile defaults change; use the existing create-time seed.

**Test scenarios:**
- Happy path: set profile default runtime Codex, select a Codex model/effort, create a channel, and observe the complete selection seeded once.
- Happy path: change one existing channel to Codex without changing neighboring channels or the profile defaults.
- Happy path: choose Codex approval, sandbox, and granular-category values; reload preserves the exact structured native values.
- Error path: desktop refuses an invalid native setting; UI re-adopts stored values and does not echo the rejected request.
- Migration: old `accept_edits` remains the selected Claude tool-use value and is never shown on Codex.
- Regression: Claude permission options and behavior remain equivalent under the stable `Tool use` row label.

**Verification:** Reload, restart, and new-channel creation tests prove persistence boundaries, and every rendered control has an exercised write/read path.

### U9. MCP Launch Runtime Field End to End

**Goal:** Let Dopl's remote MCP surface deliberately request Codex without overloading the model field.

**Requirements:** R5, R9, R11, R12

**Dependencies:** U5

**Files:**
- Modify: `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`
- Modify: `packages/mcp-server/src/tools/channel-ops-launch.ts`
- Modify: `packages/dopl-client/src/launch-types.ts`
- Modify: `src/features/channels/schema-launch.ts`
- Modify: `src/features/channels/types-launch.ts`
- Modify: `src/app/api/channels/launch-directives/agent/route.ts`
- Modify: `dopl-desktop-app/main/launch-directive-wire.js`
- Modify: `dopl-desktop-app/main/launch-directive-spawn.js`
- Modify: launch-directive persistence migration under `supabase/migrations/`
- Test: `dopl-desktop-app/test/_launch-directive-harness.mjs`
- Test: relevant MCP/server launch tests under `packages/mcp-server/` and `src/app/api/`

**Approach:**
- Add an optional validated runtime to the public MCP launch schema and client/server/domain types.
- Persist requested runtime separately from resolved/applied runtime so audit records can explain fallback or refusal.
- Carry runtime through realtime/directive parsing without treating a missing value as Codex or inferring it from model.
- Resolve precedence consistently: explicit directive runtime, then channel runtime/default, then registry default. If an explicit runtime is unavailable, refuse rather than silently launch another vendor.
- Validate model within the resolved runtime. Return requested and applied runtime/model in the launch result and channel status message.
- Keep older directive rows readable; absence follows the documented default path.

**Test scenarios:**
- Happy path: MCP `manage launch` with `runtime: codex` and a valid Codex model creates a session stamped `codex`.
- Happy path: `runtime: claude` continues to launch Claude.
- Backward compatibility: omitted runtime follows the channel/default rule and reports what was applied.
- Error path: explicit Codex request on a machine without ready Codex refuses; it never falls back to Claude.
- Error path: Codex runtime plus Claude model is rejected or ignored with a clear model-resolution result; it never changes runtime.
- Idempotency: retrying the same launch directive does not create one agent per runtime.

**Verification:** Repeating the original live MCP experiment creates a genuine Codex session, and Dopl's visible/audit result names Codex as both requested and applied.

### U10. Runtime-Honest Lifecycle, Telemetry, Resume, and Copy

**Goal:** Ensure every post-launch behavior and user-facing state remains tied to the runtime that owns the session.

**Requirements:** R6, R7, R9, R11

**Dependencies:** U3, U5

**Files:**
- Modify: `dopl-desktop-app/main/session-summary.js`
- Modify: `dopl-desktop-app/main/session-detail.js`
- Modify: `dopl-desktop-app/main/session-io.js`
- Modify: `dopl-desktop-app/main/session-reopen.js`
- Modify: `dopl-desktop-app/main/session-boot.js`
- Modify: `src/features/channels/hooks/use-agents-panel.ts`
- Modify: runtime refusal/capability UI helpers under `src/features/channels/`
- Test: `dopl-desktop-app/test/session-park.test.mjs`
- Test: `dopl-desktop-app/test/session-engine-slot.test.mjs`
- Test: `src/features/channels/components/runtime-refusals.test.tsx`

**Approach:**
- Persist runtime ID, effective model, native policy summary, conversation handle, and usage-baseline semantics in resume records.
- Enable Codex resume/fork only after measuring usage continuity and current request shapes; otherwise present a specific capability refusal.
- Surface structured runtime error codes through session summaries and map them to descriptor-owned copy/actions.
- Replace `No Claude runtime` and `Sign in to Claude` strings on shared paths with selected-runtime labels and actions.
- Keep telemetry vendor-neutral at the shared level while attaching runtime/version/protocol metadata to local diagnostics.
- Ensure a failed Codex launch cannot leave a visible launching pill, occupied slot, pending approval, or orphan process.

**Test scenarios:**
- Happy path: Codex session summary shows actual model, usage, and runtime after a complete turn.
- Restart: persisted Codex session either resumes through Codex with correct deltas or explicitly refuses with measured reason.
- Error path: binary exits during initialize/turn; slot and process cleanup occur once.
- Error path: signed-out Codex action says `Sign in to Codex`; Claude path still says Claude.
- Regression: Claude metrics and resume records remain readable across the storage migration.

**Verification:** Search of shared UI/core paths finds no hardcoded Claude error copy except inside Claude-owned adapter/sign-in surfaces, and lifecycle suites leave zero leaked resources.

### U11. End-to-End Release Matrix, Packaging Smoke, and Documentation

**Goal:** Prove the integrated product on real runtime combinations and make the supported contract maintainable.

**Requirements:** R1-R12

**Dependencies:** U2-U10

**Files:**
- Modify: `docs/INVARIANTS.md`
- Modify: `docs/ENGINEERING.md`
- Modify: `docs/REFACTOR-FINDINGS.md`
- Modify: Codex research/design notes referenced by `dopl-desktop-app/main/runtime/codex/`
- Modify: desktop release/check scripts and CI configuration
- Test: all affected desktop, renderer, API, MCP server, and package suites

**Approach:**
- Add one documented release command that runs unit/contract suites, provisions a supported Codex binary, executes the bounded live app-server tests, and fails on process leaks.
- Smoke a signed packaged app launched from Finder with minimal PATH, not only a development shell.
- Exercise a clean matrix: Claude only, Codex only, both ready, Codex signed out, Codex missing, unsupported Codex version, model catalog unavailable, and version-skewed renderer/main.
- Repeat UI and MCP launches in one channel to prove runtime isolation and session stamps.
- Update stale invariants about `--ignore-user-config`, Codex usage events, resume state, model selection, and F-390.
- Record supported Codex versions, discovery rules, sign-in steps, diagnostic locations, and compatibility-update procedure.

**Test scenarios:**
- End to end: New Agent Codex launch posts a response through Dopl and appears as a Codex session.
- End to end: profile Codex default seeds a new channel; an existing channel remains Claude.
- End to end: MCP starts one Claude and one Codex agent in the same channel and each reports the correct runtime/model.
- Security: packaged hostile-config test preserves Dopl's chosen containment.
- Regression: full Claude release suite passes with equivalent permissions and unchanged launch results.
- Operations: unsupported Codex version yields a supportable diagnostic with detected and supported versions.

**Verification:** The Definition of Done below is checked from a clean packaged build by someone other than the implementer.

---

## Phased Delivery

### Phase 1 — Make reality testable

- U1 protocol characterization.
- U2 binary/credential resolution.
- Do not expose a launchable Codex state until both are green.

### Phase 2 — Make the runtime genuinely work

- U3 app-server lifecycle.
- U4 security/MCP approval proof.
- A hidden/internal Codex launch may be used for verification; broad UI enablement remains gated.

### Phase 3 — Replace Claude-shaped shared contracts

- U5 runtime-neutral settings/migration.
- U6 model catalog and reasoning dimensions.

### Phase 4 — Finish every user entry point

- U7 New Agent.
- U8 profile and channel settings.
- U9 MCP launch directives.
- U10 lifecycle/copy/telemetry.

### Phase 5 — Release proof

- U11 packaged matrix, regression, documentation, and compatibility runbook.

---

## System-Wide Impact

- **Interaction graph:** UI/profile/channel/MCP choices converge on a shared semantic launch record, then branch by selected adapter. Session summaries, resume records, and diagnostics must carry the spawn-stamped runtime back outward.
- **Error propagation:** Adapter probe/auth/protocol errors become structured shared errors with runtime-owned labels/actions. Explicit runtime requests never convert to another vendor as error recovery.
- **State lifecycle risks:** Versioned preference migration, model-catalog cache invalidation, active-turn cleanup, child-process cleanup, and create-time channel seeding need atomic or idempotent behavior.
- **API surface parity:** UI IPC, MCP schemas, Dopl client types, API validation, database directive records, realtime wire parsing, and desktop launch assembly must change together.
- **Integration coverage:** Only live app-server and packaged-app tests can prove binary discovery, authentication, protocol shape, approvals, ambient-config isolation, and process cleanup.
- **Unchanged invariants:** Runtime remains spawn-stamped; defaults seed new channels once; unknown capability is not empty; main revalidates all process-boundary values; Dopl hard denies/outbound gate/agent-chain bounds remain authoritative.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Codex app-server changes again | High | High | Generated-schema compatibility workflow, supported version range, bounded live handshake, structured refusal |
| Removing obsolete isolation flag widens ambient config | Medium | Critical | U4 hostile-config integration proof is a release gate; no UI enablement before it passes |
| Shared UI hides meaningful native differences | Medium | High | Stable category labels, adapter-native options/descriptions, runtime-specific controls, effective native summary |
| Migration changes existing Claude behavior | Medium | High | Versioned migration, table-driven equivalence tests, full Claude regression matrix |
| Runtime switch submits stale model/template values | High | High | Runtime-keyed model state, adapter validation, UI payload assertions, template affinity rules |
| Finder-launched app cannot find Codex | High | High | Single GUI-safe resolver and packaged smoke test; explicit distribution decision |
| Live roster outage makes settings unusable | Medium | Medium | Distinct loading/unavailable state, platform-default fallback, bounded cache, no cross-runtime fallback |
| Usage semantics break caps after resume | Medium | High | Keep resume disabled until measured; record baseline semantics and test restart deltas |
| MCP old clients omit runtime | High | Medium | Optional additive field, documented fallback, requested/applied audit fields |
| File-size invariants are exceeded by cross-cutting edits | Medium | Medium | Preserve existing seams; extract model-catalog and semantic-policy modules by reason to change rather than appending to capped files |

---

## Definition of Done Checklist

### Runtime and protocol

- [ ] Supported Codex binary can be found from a signed app launched outside a shell.
- [ ] Missing, signed-out, incompatible, and ready states are distinct and actionable.
- [ ] No Codex launch uses `--ignore-user-config`.
- [ ] Current thread ID, input item, steer, interrupt, completion, and token-usage shapes are covered by fixtures generated/captured from a real supported CLI.
- [ ] App-server child exits cleanly on success, refusal, timeout, crash, interrupt, and app shutdown.

### Security and MCP

- [ ] Hostile ambient config cannot widen Dopl's sandbox, approvals, MCP servers, hooks, network, or chaining policy.
- [ ] A real Codex Dopl-MCP read/post call is captured, classified, approved/denied, and audited through Dopl.
- [ ] Dopl universal hard denies, tool-profile deny lists, outbound messaging gate, and launch-depth bound pass on Codex.
- [ ] Explicit `runtime: codex` never silently falls back to Claude.

### Models

- [ ] Codex picker uses live `model/list` IDs/display names and respects `isDefault`.
- [ ] Hidden models are not ordinarily offered.
- [ ] Reasoning efforts come from the selected model's supported/default values.
- [ ] Claude and Codex model choices are stored separately and restored on runtime switch.
- [ ] A Codex surface never displays or submits Fable/Opus/Sonnet/Haiku unless it is showing historical raw data explicitly labeled as incompatible.
- [ ] Catalog failure never substitutes another runtime's models.

### Permissions

- [ ] Primary UI uses stable Dopl category labels and never presents Claude-native choices as Codex choices.
- [ ] Claude and Codex options come from their respective adapter descriptors and are tested narrowest-to-widest.
- [ ] Effective native approval/sandbox summary is visible where multiple controls compose the result.
- [ ] Codex sandbox/granular/category controls persist and affect launch, or remain absent; none are display-only pseudo-controls.
- [ ] Structured granular/native combinations reload without translation or data loss.
- [ ] Unrestricted choices retain warnings and never become a migration fallback.

### UI and defaults

- [ ] New Agent runtime selection updates model and native setting choices immediately.
- [ ] New Agent always sends the displayed runtime; payload tests prove display and launch agree.
- [ ] Profile Agents tab edits default runtime, model, reasoning, and supervision.
- [ ] New channels inherit profile defaults exactly once; existing channels do not change.
- [ ] Per-channel settings persist independently.
- [ ] Templates cannot apply a model across incompatible runtimes without an explicit compatibility rule.
- [ ] Runtime-specific refusals/actions name Codex when Codex is selected.

### MCP and auditability

- [ ] MCP schema/documentation exposes optional runtime separately from model.
- [ ] Directive persistence records requested and applied runtime/model.
- [ ] Original reproduction—`model: codex` without runtime—cannot masquerade as a successful Codex selection.
- [ ] Live MCP launch with `runtime: codex` creates a session whose runtime, process, model, and result are all Codex.
- [ ] Retries remain idempotent.

### Regression and operations

- [ ] Existing Claude unit/integration/end-to-end tests pass.
- [ ] Mixed Claude + Codex agents can run in one channel without crossing conversation handles, approvals, model state, or message authorship.
- [ ] Release compatibility command passes against the supported CLI and fails clearly against an unsupported one.
- [ ] `docs/INVARIANTS.md`, engineering docs, F-390, and Codex protocol notes match the shipped behavior.
- [ ] Support runbook documents installation/discovery, sign-in, supported versions, diagnostics, and compatibility updates.

---

## Documentation / Operational Notes

- Update `docs/INVARIANTS.md` only after behavior/tests land; specifically remove the obsolete isolation-flag claim and document runtime-scoped model/policy state.
- Close or rewrite F-390 in `docs/REFACTOR-FINDINGS.md` when the settings wire accepts the new semantic/native shape.
- Add a Codex compatibility runbook to `docs/ENGINEERING.md` with schema generation, live probe, supported-version update, and packaged smoke instructions.
- Log runtime ID, resolved binary version/source, protocol compatibility result, thread/turn IDs in truncated form, effective model, and terminal reason locally. Never log tokens, prompts, approval payload contents containing secrets, or full filesystem paths unless existing redaction policy permits them.
- Roll out behind a Codex readiness gate derived from U1-U4. A visible runtime option may remain discoverable while launch is refused with a setup action; it must not be labeled connected until the full gate passes.

---

## Implementation Log

> ⚠ **THIS SECTION IS WRITTEN BY IMPLEMENTERS, NOT BY THE PLANNER.** Each entry names who did the
> work, what landed, the commit, and what a reviewer should re-check. An entry is a claim about the
> tree at its date — verify it against the code rather than inheriting it.

### 2026-09-21 — Claude (Opus 5), session working ahead of the plan's completion

Samuel asked for the items that were straightforward and immediately actionable while this document
was still being drafted. Two kinds of work landed: a **verification pass** over the research table's
code-side claims, and **one implementation unit** (part of U2).

#### A. Machine fact that changes U2's framing

> 🔒 ⚠ **CORRECTED LATER THE SAME DAY — READ THE CORRECTION BELOW BEFORE ACTING ON THIS PARAGRAPH.**

🔒 **There is no `codex` CLI on this machine's `PATH`.** `which codex` fails, and none of
`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.bun/bin` or an nvm prefix holds one.
Only `~/.codex/` exists (config + `.codex-global-state.json`), written by the ChatGPT desktop app's
Codex, which is not the CLI this adapter spawns.

**CORRECTION (2026-09-21, later, from the U1 work):** the original claim above was written as *"no
`codex` CLI on this machine at all"*, and **that was wrong** — it was true of `PATH` and false of
the machine. There is a `codex-cli 0.155.0-alpha.9.2` at
`/Applications/ChatGPT.app/Contents/Resources/codex`, and it was running an app-server at the time.

⚠ **IT IS NOT A SUPPORTED SOURCE AND NOTHING MEASURED FROM IT MAY BE COMMITTED AS THE CONTRACT.**
The plan's Scope Boundaries exclude depending on *"the private executable inside another
application bundle"*, and a private alpha's protocol may differ from the public CLI's — a fixture
captured from it that later reads as measured truth is the same failure as the synthetic fixtures,
in a different costume. It is usable only to PROVE tooling runs, which is what U1 used it for.

Consequences for the plan:
- **U1, U3 and U4 cannot be characterized from this machine.** Every "current protocol" correction
  in the research table is still *unverified against a live app-server here*. The plan's
  characterization-first rule stands; nothing below guesses at a wire shape.
- The operator's successful `codex mcp add dopl --url …` (2026-09-21, OAuth, confirmed enabled) was
  performed in the **ChatGPT app's Codex**, not a local CLI. It proves Dopl's MCP server speaks
  OAuth to a Codex client; it does **not** prove anything about `codex app-server`.
- ⚠ **`codex/mcp.js › registerMcp` returns a refusal whose stated reason is now partly answered**:
  `codex mcp add <name> --url <url>` is a real verb and Dopl's server is discovered over OAuth with
  no header or token flag. U2/U4 should re-read that refusal text before re-deriving it.

#### B. Verification of the "Confirmed Current-State Failures" table (code side only)

Each row below was checked against the tree at this date. **Every code-side claim in the plan is
accurate**; the wire-side claims are marked as still needing a live CLI.

| Claim | Verdict | Evidence in tree |
|---|---|---|
| MCP launch has no runtime field | ✅ CONFIRMED | `grep runtime` finds **nothing** in `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`, `packages/dopl-client/src/launch-types.ts` or `src/features/channels/schema-launch.ts`. `main/launch-directive-spawn.js` only ever reads the CHANNEL's runtime (`channel-runtime.getChannelRuntime`) |
| `--ignore-user-config` is always sent | ✅ CONFIRMED | `codex/launch-spec.js` (argv head) **and** `codex/models.js` — ⚠ the roster read passes it too, which the plan's file list does not mention; U3/U4 must change both or the picker breaks independently of launch |
| Thread ID parsed from the wrong place | ⚠ PARTLY | `launch-spec.js` reads `thread.threadId \|\| thread.thread_id \|\| thread.id`, so a **top-level** `id` already works; what it cannot read is a **nested** `{ thread: { id } }`. `normalize.js › THREAD_STARTED` reads only `params.threadId \|\| params.thread_id`. The exact shape still needs the live schema |
| Turn input sent as a string | ✅ CONFIRMED (code) | `launch-spec.js`: `conn.request('turn/start', { threadId, input: text })` and the same for `turn/steer`, where `text` is `String(...)` |
| Steer/interrupt carry no turn ID | ✅ CONFIRMED (code) | Neither request includes `turnId`/`expectedTurnId`; `turn/interrupt` sends `{ threadId }` only. No active-turn state is tracked anywhere in the adapter |
| Usage read from the wrong event | ⏳ NEEDS LIVE CLI | No `thread/tokenUsage/updated` handler exists in `normalize.js`; whether the current server still reports usage on completion is unverified here |

#### C. IMPLEMENTED — U2, binary discovery half only

**Commit:** see `git log -- dopl-desktop-app/main/runtime/codex/resolve-bin.js`.

**What landed:** one GUI-safe Codex executable resolver, used by every caller that previously
reached for the bare name.

- **Created `dopl-desktop-app/main/runtime/codex/resolve-bin.js`** — resolves in order: the
  `DOPL_CODEX_BIN` override, then `PATH`, then the well-known macOS prefixes
  (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.bun/bin`, `~/.volta/bin`,
  `~/.npm-global/bin`). Returns `{ ok, path, source, reason, rejected }`, cached per process with
  `forget()`.
- **Security (the plan's U2 scenario, "never executes a writable/untrusted path merely because its
  filename is `codex`"):** a candidate must be a regular file, executable by this user, and
  **neither it nor its directory may be group- or world-writable**. A refused candidate is reported
  with its reason, so *"found but Dopl will not run it"* never reads as *"not installed"*.
- **An override that does not resolve is an error, not a fallback** — naming a file and silently
  running a different one is how a diagnostic measures the wrong binary.
- **Rewired call sites:** `codex/client.js › probe()` (resolver answers first; its refusal replaces
  the old "not on this Mac's PATH" errno message), `codex/client.js › connect()` (spawns the
  resolved path and throws a readable error when nothing resolved), and
  `codex/credential.js › runStatus()` (execs the resolved path; an unresolvable binary stays
  fails-open UNKNOWN, because *"is there a codex"* is `available()`'s question, not its own).
  `models.js` reaches the binary through `client.connect`, so it is covered without an edit.
- **Test:** `dopl-desktop-app/test/codex-resolve-bin.test.mjs`, 9 cases over a fake filesystem —
  including the Finder-PATH case stated as a test, the writable-file and writable-directory
  refusals, refused-vs-absent messages being different, and a source scan pinning that no caller
  spawns the bare name.

**What is NOT done in U2** (unchanged, still open): the packaging/distribution decision
(bundled vs. external), `connectivity.js` and `session-launch.js` / `session-auth.js` credential
delegation, the structured `missing | incompatible | signed-out | timeout | ready` state set, and
the packaged-Finder smoke test. The resolver is the seam those should build on — it already returns
`source` and `path` for diagnostics.

**Verification for Codex:** `cd dopl-desktop-app && node --test test/codex-resolve-bin.test.mjs`
(9/9). Full desktop suite at this commit: **3379 tests, 0 failures.**

⚠ **Unrelated pre-existing failure found while running the gates, NOT caused by this work:**
`dopl-desktop-app/test/session-preset-start.test.mjs` is **527 lines against the 500-line cap**, so
`npm run lint` in `dopl-desktop-app` exits with 1 error. It arrived with the unpushed commit
`a1a4e1da` (default agent settings). Desktop CI's lint step runs bare `npm run lint`, where an
error fails the job — this will go red on push unless the file is split first.

⚠ **THREE MORE 500-CAP LINT ERRORS FOUND SINCE, ALSO NOT FROM THIS PLAN'S WORK** (re-derive before
acting — this is a count, and the tree is moving): `dopl-desktop-app/main/listener-io.js` (532,
from `de12cf89`) on the DESKTOP lint, and `src/features/channels/components/message-pane.tsx` (501)
plus `src/features/channels/server/repository-launch.ts` (554) on the ROOT lint, which runs
`--max-warnings 0`. **Four files, two lint jobs, both red on push.**

#### D. U1 — IMPLEMENTED (contract harness, gate, and generator)

**Commits:** `9556b777`, `94a3d0fe`. Nothing pushed.

**What landed:**
- `dopl-desktop-app/test/_codex-app-server.mjs` — bounded handshake helper. Resolves through
  `resolve-bin.js`, spawns through `client.connect` (so `client.js` stays the only module touching a
  child process), hard timeout, and one `finally` that closes → waits → `SIGKILL` → records any pid
  still answering `kill(pid, 0)`.
- `dopl-desktop-app/test/codex-app-server-contract.test.mjs` — 29 tests in TWO TIERS. Tier 1 always
  runs and measures *Dopl*; **tier 2 (`CODEX_APP_SERVER_LIVE=1`) is the only tier allowed to say
  what the protocol IS.**
- `dopl-desktop-app/scripts/codex-app-server-schema.js` + `test/fixtures/codex-app-server.json` —
  `npm run codex:schema`. Captures method NAMES and value TYPES only; never prompts or tokens.
  Ships as `UNVERIFIED-PLACEHOLDER` with every measured slot `null`.
- `dopl-desktop-app/scripts/codex-compat.js` — `npm run test:codex-compat`; exits 2 (no Codex),
  1 (suites failed), 3 (a leaked app-server outlived the run).
- `main/runtime/codex/client.js › checkProtocol()` — the capability/version gate. **Additive and
  NOT yet wired into the connected-state path** (that seam is U2/U3's).

🔒 **SKIPPING IS LOUD, IN THREE LAYERS**, because a skip that reads as a pass is this tier's whole
failure mode: a banner at import, a `t.diagnostic("SKIPPED, NOT PASSED — …")` per test, and two
separately reported gates ("flag unset" vs "flag set, no binary"). **The skip is itself tested.**

🔒 **`SUPPORTED_CLI` IS DELIBERATELY UNPINNED** (`{ min: null, max: null }`), so `versionGate`
refuses nothing. A range written without a measured *public* CLI is a guess in a measurement's
costume. `npm run codex:schema` prints the line to paste once one is measured.
🔒 **Unknown ≠ empty:** `methods: null` → `unverified-protocol`; `methods: []` →
`unsupported-protocol`. Four states (`missing`, `signed-out`, `unsupported-protocol`,
`unverified-protocol`) are four different operator actions and must not be collapsed.

**Measured against the ChatGPT-bundled alpha — TOOLING PROOF ONLY, NO FIXTURE COMMITTED:**
- ⚠ **`codex app-server generate-json-schema --out <dir>` exists** (marked `[experimental]`). Its
  `ClientRequest.json` is a `oneOf` of **101 `method` consts** — the CLI's own enumeration — and
  **all seven methods this adapter sends are present**.
- ⚠ **`initialize` DECLARES NO METHODS.** It answers `{ codexHome, platformFamily, platformOs,
  userAgent }`. **That is why the SCHEMA, not the handshake, must be the method source.**
- **`model/list` returns `{ data, nextCursor }`** with `id`, `displayName`, `isDefault`, `hidden`,
  `defaultReasoningEffort`, and `supportedReasoningEfforts` as `{reasoningEffort, description}`
  objects — **confirming U6's field list**; one default across five models.
- 🔒 ⚠ **`app-server --help` SHOWS NO `--ignore-user-config` FLAG.** What it does show:
  `-c key=value`, `--enable/--disable <FEATURE>`, and **`--strict-config`**. **U4 now has real
  evidence for the replacement isolation mechanism**, and ⚠ **both `launch-spec.js` AND `models.js`
  pass the dead flag — the model picker breaks independently of launch.** Per instruction, the
  existing `codex-gate.test.mjs` assertions were left alone; they are U4's to change.

**Results:** the contract suite is **24 pass / 5 loud skips / 0 fail** with no CLI, and **29/29 with
no skips** when armed. The live tier was proven non-vacuous: against a binary that never answers it
fails on the timeout, and against the placeholder fixture it fails naming `npm run codex:schema`.

⚠ **DO NOT READ THE DESKTOP SUITE'S TOTALS AS A VERDICT ON THIS WORK** — three other agents were
mid-flight in the tree during it (totals moved 3380 → 3336 → 3409 across the session). Read
`node --test test/codex-app-server-contract.test.mjs`.

**Still needs a SUPPORTED (public) CLI:** pin `SUPPORTED_CLI`; commit a measured fixture; every
wire-shape row in the research table (thread-id location, `input` as a sequence,
`expectedTurnId`/`turnId`, `thread/tokenUsage/updated`) — the run confirms those methods EXIST, and
says nothing about their params, because none were sent; the steer/interrupt bounded probes, which
need a live turn.

**CI:** `.github/**` untouched. A runner that provisions Codex should call
`npm run test:codex-compat` — ⚠ **not bare `npm test`, which lets the live tier skip and report
green.**

#### E. U9 — IMPLEMENTED (runtime on a launch directive, end to end)

**Commit:** `7964ea17` (45 files, +2478/−311). Not pushed.

**The precedence, as built** (`main/launch-directive-spawn.js › resolveRuntime`):
1. **explicit directive `runtime`** → membership test against `registry.ids()`, THEN `acquire()`.
   Either miss ⇒ **`{refused:'no-sdk'}`**, nothing launched, the runtime named in the diag.
2. channel runtime — unchanged, fails open.
3. registry default.

🔒 ⚠ **THE ASYMMETRY IS THE POINT, AND SO IS THE ORDER.** Links 2–3 fail OPEN (a downgrade must not
strand a room); link 1 fails CLOSED (Decision #4, R5). ⚠ **The `ids()` check MUST stay before
`acquire()`** — `runtime/index.js › resolve` fails open, so `acquire('nonsense')` would SUCCEED by
acquiring Claude, which is the exact bug U9 exists to close. There is a named test pinning that
ordering; do not "simplify" it away.

**No 11th refusal word:** the vocabulary is closed in four places (desktop vocab,
`schema-launch-modes.ts`, the column CHECK, the MCP retry-advice map). `no-sdk` already means
"there is no such agent runtime on this Mac" and already advises `no` retry.

**`runtime` is a string, not an enum, on the MCP wire** — deliberately: the roster is the operator's
desktop registry and moves with a DESKTOP release, so a closed set in a pushed schema would refuse a
runtime a newer machine already ships. Grammar (`LAUNCH_RUNTIME_ID_RE`) is checked in four places
and pinned to agree, including against the migration's CHECK.

**Requested vs applied:** `runtime` / `model` are what was ASKED; `applied_runtime` /
`applied_model` are what the desktop REPORTS it used; `null` means *not reported*, never a guessed
vendor. 🔒 **There is deliberately NO `resolved_runtime`** — the server holds no roster, so a third
group would be a fabricated resolution, and a test fails if one appears.

**Model within the resolved runtime:** the Claude chain (chain → template → channel-prefs) is now
scoped to the DEFAULT adapter only. Any other runtime gets its own roster, or no model argument at
all. A cross-vendor model is DROPPED and diag'd — **it never changes the runtime**.

**Migration — WRITTEN, NOT APPLIED:**
`supabase/migrations/20261017120000_channel_launch_directives_runtime.sql` — three nullable `TEXT`
columns with grammar CHECKs and launch-only kind fences. No `NOT NULL`, no backfill, no value enum;
every existing row reads `NULL`, which is correct. ⚠ **Applying it is Samuel's, against the target
project.** Nothing was run anywhere.

**Tests:** 24 desktop cases + 13 MCP + 13 schema + 11 service, covering precedence, all four
refusals, the roster-outage path, the requested/applied audit, idempotent retry (including a retry
that asks for a DIFFERENT runtime converging on the stored row), and rows written before the
columns existed. All 8 launch-directive suites pass, 156/156.

⚠ **KNOWN GAP, AND IT IS U5's SEAM — READ THIS BEFORE CALLING U9 DONE.** `applied_model` is what the
DIRECTIVE lane applied, not yet what the SESSION runs on a non-default runtime:
`session-engine.js › startSession` still re-coerces `spec.model` through Claude's `session-model.js`
table, so a roster-valid Codex id is coerced to `'default'` downstream and the session runs the
platform default. That file belongs to U5 and was owned by another agent at the time. The gap is
marked in a block comment at the return site with an explicit *do not re-implement the coercion
here*. **When U5 moves model validation behind the selected adapter, the two agree by construction —
verify that they do.**

⚠ **NOT LIVE-VERIFIED.** U9's own verification line ("repeating the original live MCP experiment
creates a genuine Codex session") is UNPROVEN: no supported CLI here. Everything is proven against
the real modules with stubbed leaves.

**Bug found and fixed in passing:** the decide route never forwarded `appliedAgentName`, though
every other layer was built — filed as **F-752** (RESOLVED), the same shape as F-708 on the other
end of the same lane.

⚠ **FIVE MCP BUDGET RATCHETS WERE RAISED** for the new field (schema, two tool ceilings, two
doctrine ceilings). The trim came first and the remainder is RECORDED, NOT FUNDED. If Samuel wants
it funded, the sanctioned move already owed on that constant is `kind`'s chooser and `artifact`'s
definition → `channel-doctrine.ts › FIELDS`, which would put the pushed number back under where it
started.

#### F. U5 — IMPLEMENTED (runtime-neutral launch settings and migration)

**Commit:** `683d4fe6`. Desktop suite green at 3507. Not pushed.

**The shape** (`main/launch-selection.js`, store keys `channelLaunchSelection` per channel and
`agentDefaults` per machine-user):

```
{ v: 2, runtime, messages, byRuntime: { '<runtimeId>': { tools?, model?, native? } } }
```

`v` is read BEFORE any other field. `messages` stays Dopl-owned and runtime-neutral — **Dopl gates
channel delivery, not a vendor**. Everything a runtime owns sits under `byRuntime`, one record per
runtime, SIDE BY SIDE — which is what makes Decisions #1/#2 true: **Claude → Codex → Claude restores
both remembered models and both native sets, with no translation.** Absent fields are OMITTED,
never `''`/`null`/`{}`.

**Migration happens ON READ AND NEVER WRITES**, so a machine that only launches keeps its legacy
records intact and downgrades losslessly; every WRITE re-stamps the legacy keys as a downgrade
mirror, which are never read while the new record parses. Legacy `tools`/`model` land in
`byRuntime[DEFAULT_ID]` **whatever runtime is selected** — that is the only vocabulary the old
validators could store, and filing them under the SELECTED runtime would assert that `accept_edits`
"is" some Codex approval mode.

**Adapter-owned vocabulary** (`main/runtime/selection-vocabulary.js`, split out of `capability.js`
at the 500 cap): descriptors now declare `models.pick` (`closed` for Claude — stored ids, aliases,
canonical id→alias; `open` for Codex/Cursor — a shape check over a live roster),
`models.dimensions` + `dimensionOptions`, and `toolMode.secondaryAxis`. 🔒 **No storage or
session-core path imports another runtime's enums any more** — `channel-prefs.js`,
`agent-defaults.js`, `session-engine.js` and `trigger.js` all dropped `require('./session-model')`,
and a test asserts the pure block contains no vendor vocabulary at all. **That was U5's verification
bar and it is met.**

🔒 **READS FLOOR, WRITES REJECT.** Unknown record version → only the runtime pick survives (picking
a runtime widens nothing). Stored tool mode the adapter does not offer → that adapter's NARROWEST.
Unknown containment value → narrowest declared option, **never the widest and never the platform
default**. Unknown model dimension → dropped to platform default. Unregistered runtime id → reads as
default, **is not repaired**, and its record is kept verbatim and never read. Every floor surfaces a
`needsReview` sentence. **Nothing anywhere resolves to unrestricted** (Scope Boundaries).

⚠ **`sandbox_mode` AND REASONING EFFORT NOW REACH THE LAUNCH** (`codex/launch-spec.js` reads
`state.native`) — they were the display-only illusion F-390 records, and **F-390 can be closed once
U8 wires the controls**. ⚠ **Codex's GRANULAR APPROVAL CATEGORIES are deliberately NOT declared
configurable** — the structured write shape is unmeasured, and `runtime-contract.test.mjs` now
asserts no adapter claims otherwise. That flips when U4 measures it.

⚠ **`setChannelRuntime` WAS DELETED** — zero callers, and a second writer of a one-writer record.
⚠ **The 2026-09-06 rule that a runtime switch CLEARS the channel's model stamp is REVERSED** by
Decisions #1/#2: the whole point is that the other runtime's pick survives.

**Additive bridge:** `channels:getLaunchPosture` now carries `selectionVersion`, `selection` and
`needsReview` beside the three legacy own-keys older renderers feature-probe.

**Orchestrator follow-up, DONE:** `launch-directive-spawn.js` still read the channel model as
`aliasForModelId(getLaunchModel(...))` — the default runtime's record through Claude's alias table —
so a Codex channel's stored pick contributed nothing to the chain. Fixed in `51f6f410` with
`getLaunchModelLink`. ⚠ **The same pattern is latent in `session-ipc-ops.js`, `session-boot.js`,
`session-reopen.js` and `template-resolve.js`** — Claude-only paths today, so not yet wrong.

#### G. U10 — IMPLEMENTED (runtime-honest lifecycle, telemetry, resume, copy)

**Commit:** `dac1e8d6` (35 files). Desktop suite 3507, 0 fail. Not pushed.

**Copy.** `main/runtime/runtime-copy.js` + its web mirror `src/features/channels/lib/runtime-copy.ts`
template every sentence over `descriptor.label`, with **no per-runtime branch anywhere** — a fourth
adapter gets correct copy by registering. `No Claude runtime on this Mac` → `No Codex runtime…`;
`Sign in to Claude to start an agent` → **`Sign in to Codex to start an agent`**; the held-tool
denial, the resume nudge and the auth diag all follow the session's own descriptor. 🔒 **The ACTION
is a capability, not a string**: `signInAction` answers `null` when the descriptor declares no
in-app flow (Codex, Cursor), so the sentence is still said and **the button is hidden** rather than
offering a flow that does not exist. Each sentence carries its own UNNAMED form, so an unknown
descriptor never renders "the agent runtime runtime".
⚠ **THE FIVE CLAUDE-OWNED MODULES KEEP THEIR NAMES ON PURPOSE** — INVARIANTS §11.0a fences
`claude-auth.js`, `claude-token.js`, `claude-resolve.js`, `claude-signin-op.js`, `claude-runtime.js`
plus the IPC channel and its two test pins as ONE later de-naming step; splitting it leaves the pin
and the op disagreeing.

**Structured error codes.** A closed set (`runtime-missing`, `runtime-signed-out`,
`runtime-incompatible`, `runtime-start-failed`, `runtime-crashed`, `runtime-interrupted`,
`mcp-unreachable`, `resume-refused`), produced in `session-query.js › consume` (start-failure vs
crash, split on whether a conversation handle existed) and `mcp-connect-guard.js`, frozen through
allowlists in `settle` / `durableHistory`, and **re-rendered at READ time** from the record's own
`runtimeId` — so the sentence follows the runtime, not the build that wrote it. All local-only;
`reportRow` picks columns by name, so nothing widens `channel_sessions`.
⚠ **`runtime-missing` and `runtime-incompatible` HAVE NO PRODUCER YET** — the codes exist; U1's
handshake and U2's unfinished state set are what would stamp them.

**Resume records** (`main/session-runtime-truth.js`) add `effectiveModel` (the runtime's own
reported id — never `'default'`, never coerced through any model table), `nativePolicy` (a REPORT of
the adapter's own option labels, never a synthetic cross-runtime word), and `usageBaseline`
(`resets` / `continues` / `unverified`). 🔒 **`usageBaseline` is PERSISTED, NOT RE-DERIVED**, so a
later build that flips `usageResetsOnResume` cannot re-interpret a finished run.

🔒 **CODEX RESUME IS STILL REFUSED AND WAS NOT WEAKENED.** The refusal now names the MEASUREMENT
(*usage accounting on resume is unverified*), the delta baselines are not zeroed, nothing is
acquired or consumed, and a test asserts `declared === 'unverified'` — **so answering the plan's
"Usage on resume" question turns that test red until someone measures it.** That is the intended
trip-wire.

**Failed-launch cleanup** is proven in three layers (`test/session-launch-cleanup.test.mjs`): the
adapter returns a closeable handle rather than throwing into the funnel with the slot already taken;
`consume` emits exactly one crash and never overwrites an existing code; `settle` sweeps once —
registry entry deleted, pending approval denied fail-closed, iterator closed, controller aborted,
one history row — and a second and third `settle` change nothing. A source-shape pin holds
`if (s.settled) return` ahead of the flag, because **a late flag is not a guard**.

**Bug fixed in passing:** `session-reopen.js › setModelByTask` recorded a model switch that never
happened on any runtime without a live-switch verb — filed as **F-753** (RESOLVED).

⚠ **PLAN CORRECTIONS FROM THIS UNIT:** U10's file list says
`src/features/channels/hooks/use-agents-panel.ts`; the file is at
`src/features/channels/components/use-agents-panel.ts` and there is no hooks copy. And
`session-engine-slot.test.mjs` sits at **499/500** with no headroom, so the cleanup cases live in
`test/session-launch-cleanup.test.mjs` and `session-park.test.mjs` had to be split.

⚠ **TREE-SHARING INCIDENT, RECORDED SO IT IS NOT REPEATED.** Four agents shared one worktree during
this wave. Three of U10's edits were swept into U5's commits (`683d4fe6`, `51f6f410`) — they are on
master and green, but they are under the wrong sha. Worse, U10 ran `git stash` / `git stash pop`
ACROSS THE WHOLE TREE to get a clean baseline, which briefly held all four agents' uncommitted work;
it restored cleanly and was not repeated. 🔒 **This is exactly what Samuel's one-worktree-per-team
rule exists to prevent: a stash is tree-wide, so it is never a safe way to get a baseline in a
shared checkout.** Future waves get a worktree each.

---

## Sources & References

- Related code: `dopl-desktop-app/main/runtime/codex/`
- Runtime architecture: `dopl-desktop-app/main/runtime/contract.js`, `dopl-desktop-app/main/runtime/index.js`
- Settings and launch UI: `src/features/channels/components/launch-agent-dialog.tsx`, `src/features/channels/components/settings-agent-launch-rows.tsx`, `src/features/channels/components/agent-defaults-settings.tsx`
- MCP launch path: `packages/mcp-server/src/tools/channel-ops-launch.ts`, `dopl-desktop-app/main/launch-directive-spawn.js`
- Standing constraints: `docs/INVARIANTS.md`
- Known settings gap: `docs/REFACTOR-FINDINGS.md` F-390
- External: [OpenAI Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)
