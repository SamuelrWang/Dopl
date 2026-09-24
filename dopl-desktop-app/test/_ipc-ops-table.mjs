// THE IPC OP INVENTORY — every `ipcMain.handle` across `channel-dir-ipc.js` +
// `session-ipc-ops.js`, with the payload each is driven with and the value a REFUSED call must
// return. Split out of `channel-ipc-sender.test.mjs` on 2026-08-27 at the 500-line cap: this
// module is the TABLE, which moves whenever the bridge gains or loses an op, and that file keeps
// the CASES, which move when the SECURITY MODEL moves.
//
// It is DATA, not a test, and carries no `test()`; the runner collects `*.test.mjs` only.
//
// THE REVIEW RULE COMES WITH IT: adding a row here means the op's main-process handler was checked
// to exist and to be `appWindowOnly`-wrapped. `test/preload-parity.test.mjs` pins the other end
// (the preload's surface); this pins that every registered handler is sender-bound.

// The fixtures stay in the harness: a second copy of `CH` / `PRESET` / `POPOUT_PAYLOAD` here is how
// two suites come to drive two different programs.
import { CH, PRESET, POPOUT_PAYLOAD } from "./_ipc-harness.mjs";

// 2026-09-07: the two turn-cap constants, both turn-cap ops and the test that pinned them are
// deleted with the caps — see `main/session-state.js`'s header.

// name -> [payload, the value a REFUSED call must return]
export const OPS = [
  ["channels:getFolderLabel", CH, null],
  ["channels:chooseFolder", CH, null],
  ["channels:clearFolder", CH, null],
  // 2026-08-20: the two `channels:*PermissionPreset` rows left with the ARM, and 2026-09-06: the
  // two auto-send rows left with item 8. Both sets of handlers are gone from `channel-dir-ipc.js`,
  // and a row for an unregistered op fails `every privileged op in the file is registered` on the
  // first case. The axis auto-send covered is the launch posture's `messages`, whose rows are here.
  // 2026-08-31 (agent-chaining ruling): the durable per-channel setting that lifts the
  // one-generation launch bound. Boolean-only, same binding and UUID gate, and a refused `get`
  // answers plain `false` — also the fail-closed value, so a hostile page cannot tell a rejected
  // sender from a channel with chaining off.
  ["channels:getAgentChain", CH, false],
  ["channels:setAgentChain", { channelId: CH, on: true }, { ok: false }],
  // 2026-09-18 (default-agent-settings ruling): the machine-user's DEFAULTS record, plus the seed
  // that copies it into a channel at CREATION. `get` / `set` take NO channel id — their subject is
  // the machine-user, like the two orchestrator ops below — so the sender binding is the only
  // guard and that is exactly why they belong in this census. `apply` is UUID-gated; its refusal
  // is `{ ok: false, seeded: false }`, byte-identical to its own bad-payload rejection.
  ["channels:getAgentDefaults", undefined, null],
  // ⚠ THE FOURTH SLOT: `setAgentDefaults` reads `defaults` and no `channelId`, so the shared
  // loop's "corrupt the channelId" bad payload would have driven a VALID call through the
  // bad-payload arm and asserted the refusal shape of a write that really landed.
  ["channels:setAgentDefaults", { defaults: PRESET }, { ok: false }, { defaults: "not-an-object" }],
  ["channels:applyAgentDefaults", { channelId: CH }, { ok: false, seeded: false }],
  // 2026-08-20: the DURABLE launch posture, same binding and UUID gate, and now the most privileged
  // write in the file. A refused `get` must not disclose the posture and a refused `set` must not
  // write one; both are asserted by the shared loops below, from all five surfaces.
  ["channels:getLaunchPosture", CH, null],
  ["channels:setLaunchPosture", { channelId: CH, preset: PRESET }, { ok: false }],
  // 2026-08-22 (launch-over-MCP ruling): the MACHINE-WIDE standing consent for the
  // `channel_launch_directives` lane. The FIRST ops here whose subject is not a channel — no id to
  // UUID-gate, a bare boolean payload, so the sender binding is the ONLY guard, which is why they
  // belong in this census. The refusal shapes are the honest "off", so they disclose nothing.
  ["orchestrator:getLaunchEnabled", undefined, { enabled: false }],
  ["orchestrator:setLaunchEnabled", { enabled: true }, { ok: false }],
  // 2026-08-31: the PRIVATE DIRECT lane's own consent — same machine-wide no-id shape, and a
  // SEPARATE grant (directing reaches a running agent; launching buys a process).
  ["orchestrator:getDirectEnabled", undefined, { enabled: false }],
  ["orchestrator:setDirectEnabled", { enabled: true }, { ok: false }],
  // 2026-09-07: `settings:getTurnCap` / `settings:setTurnCap` are deleted and UNREGISTERED, so
  // there is no row to census.
  // 2026-08-22 (ended-agent ruling): the desktop half of the thread-delete cascade. Main cannot see
  // the SERVER's cascade, so an ended agent's frozen 7-day history would outlive the thread it
  // worked. LOCAL stores only — never a `channel_message`, never a LIVE session.
  ["agents:forgetThread", { channelId: CH, taskId: "t1" }, { ok: false }],
  // 2026-09-23: the IN-APP SIGN-IN, runtime-scoped (was `claude:signIn`, 2026-08-25). Its subject is
  // the MACHINE's credential for one runtime; the payload is only that id, so the fourth slot is a
  // malformed id, refused at the boundary before any flow module loads. It starts no turn: the OAuth
  // flow is completed in the operator's own browser, and success RELEASES that runtime's held sessions.
  ["runtime:signIn", { runtimeId: "codex" }, { ok: false }, { runtimeId: "../codex" }],
  // Every in-app-sign-in runtime's status (no payload) and one runtime's prompt dismissal: states and
  // a flag, never a credential. A refused read is the empty list.
  ["runtime:credentialStatus", undefined, { runtimes: [] }],
  ["runtime:dismissSignInPrompt", { runtimeId: "codex" }, { ok: false }, { runtimeId: "../codex" }],
  ["sessions:reopen", { channelId: CH, taskId: "t1" }, { ok: false }],
  // 2026-08-18 (wiring plan Phase 5): the Agents tab's controls on the operator's OWN agent. STOP
  // verbs — `interrupt` and `end` — dispatched through main's own reducer, under the same sender
  // binding and UUID gate as every op above, which is why this list is asserted by COUNT as well
  // as by name.
  ["sessions:pause", { channelId: CH, taskId: "t1" }, { ok: false }],
  ["sessions:end", { channelId: CH, taskId: "t1" }, { ok: false }],
  // 2026-09-17 (inline-approval ruling): the operator answering ONE tool call this machine is
  // HOLDING at the gate — the one op here that carries a DECISION rather than a control. It widens
  // nothing: ALLOW-ONCE mints no standing grant, neither axis moves, no turn starts, and a `deny`
  // VERDICT parks no resolver. `{ok:false}` is also the honest answer for an ordinary miss, so a
  // refused call and a real miss are indistinguishable here too.
  ["sessions:answerPermission", { channelId: CH, taskId: "t1", requestId: "r1", allow: true }, { ok: false }],
  // 2026-08-25 (delete ruling): `sessions:end` PLUS a local erase — one stop path, never two, then
  // every local store keyed to the agent is dropped. It reaches no `channel_messages`. Same binding
  // and UUID gate; the review is in `preload-parity`.
  ["sessions:delete", { channelId: CH, taskId: "t1", agentId: "abcdefgh" }, { ok: false }],
  // 2026-08-20: the Agents tab's launch — the one START verb, own-thread only, UUID-gated on BOTH
  // ids, posture owned by main (see preload-parity).
  ["sessions:launch", { channelId: CH, taskId: "t1" }, { ok: false }],
  // 2026-08-25 (rename ruling): its subject is an agent, not a channel, so it carries the fourth
  // tuple slot with its own bad payload — there is no `channelId` to probe with. It writes a
  // DISPLAY string keyed by the instance address, and nothing resolves an agent by it.
  ["sessions:rename", { agentId: "abcdefgh", name: "Research" }, { ok: false }, { agentId: "" }],
  // 2026-08-27 (launch-panel ruling): `sessions:describe` is `sessions:rename`'s twin in every
  // respect this file cares about — subject is an agent, hence the fourth slot. `sessions:mintAgentId`
  // takes NO payload (hence NO_BAD_PAYLOAD below) and reserves nothing; its PRESENCE is also the
  // SPA's capability gate for the pre-assigned launch id (see `test/preload-parity.test.mjs`).
  ["sessions:describe", { agentId: "abcdefgh", description: "Reviews the docs" }, { ok: false }, { agentId: "" }],
  ["sessions:mintAgentId", undefined, { ok: false }],
  // 2026-08-22 (OQ-3): the machine-local FIRST-USE APPROVAL of ANOTHER member's identity. Its
  // subject is not a channel, so it is the second op here with no `channelId` to probe with — hence
  // the FOURTH tuple slot, which names the bad payload instead of letting the shared loop assume
  // every op is channel-gated. It decides only whether a foreign identity's TEXT may become an
  // agent's role on this Mac.
  ["sessions:approveIdentity", { identityId: CH }, { ok: false }, { identityId: "not-a-uuid" }],
  // 2026-08-18 (wiring plan Phase 10): the pop-out thread window — the only op here that can MINT
  // one, which is why it lives under the same binding and why its own guards (UUID channel,
  // isSafeSegment, the version floor, the window budget) all answer in this `{ ok: false }` shape.
  ["threads:openWindow", POPOUT_PAYLOAD, { ok: false }],
  // 2026-08-20 (F-212's closure — the AGENT WINDOW). Reviewed SEPARATELY, because they are not the
  // same shape as each other:
  //   `sessions:openAgentWindow` — `threads:openWindow`'s twin: the second op here that can MINT a
  //     window, under the same binding, guards, version floor and budget.
  //   `sessions:message` — THE ONLY OP IN THIS FILE THAT STARTS A TURN on an existing session. Its
  //     bounds live at this boundary (UUID gate, `MESSAGE_CAP`, empty-after-trim refused, version
  //     floor) and its argument lives with `main/session-reopen.js › messageByTask`.
  //   `sessions:narration` — read-only, and the ONE row whose refusal shape is not `{ ok: false }`:
  //     it answers `{ entries: [] }`, because its caller renders a list and a refusal must look
  //     like "nothing to show". That is why this table pairs every op with its own refusal.
  ["sessions:openAgentWindow", { segment: "acme-a1b2", channelId: CH, taskId: "t1" }, { ok: false }],
  ["sessions:message", { channelId: CH, taskId: "t1", text: "hello" }, { ok: false }],
  // 2026-08-20: the agent view's LIVE permission controls. Same binding and UUID gate; the axis is
  // two literals here and the mode is re-validated against `session-profiles.js`'s frozen enums
  // before the reducer coerces again. It widens SUPERVISION (is the operator asked?), never
  // CONTAINMENT (what is reachable at all); `preload-parity` carries the full review.
  ["sessions:setMode", { channelId: CH, taskId: "t1", axis: "tools", mode: "bypass" }, { ok: false }],
  // 2026-08-22 (model-selection ruling): the LIVE model switch. The value is coerced against
  // `session-model.js`'s frozen ID list here and converted to the argv-safe alias inside, so a
  // forged string CLEARS the override rather than reaching a child process.
  ["sessions:setModel", { channelId: CH, taskId: "t1", model: "claude-opus-5" }, { ok: false }],
  ["sessions:narration", { channelId: CH, taskId: "t1" }, { entries: [] }],
];

// THE MACHINE-WIDE OPS HAVE NO BAD PAYLOAD TO REJECT, WHICH IS WHY THEY ARE LISTED HERE RATHER
// THAN QUIETLY PASSING. `orchestrator:get/set*Enabled` take no id — `get` has no argument and
// `set`'s bare boolean is coerced, not refused — so there is no id-shaped rejection for the refusal
// to be indistinguishable FROM, and the sender binding is the only guard on them. The bad-SENDER half of the loop still runs for all of them, and it is the half that matters.
export const NO_BAD_PAYLOAD = new Set([
  "orchestrator:getLaunchEnabled",
  "orchestrator:setLaunchEnabled",
  "orchestrator:getDirectEnabled",
  "orchestrator:setDirectEnabled",
  // `claude:signIn` left 2026-09-23: `runtime:signIn` carries a runtime id and has a real bad payload.
  // `runtime:credentialStatus` reads no payload, so a "corrupted" call to it SUCCEEDS.
  "runtime:credentialStatus",
  // 2026-09-18: `channels:getAgentDefaults` reads NO payload at all — its subject is the
  // machine-user — so there is no bad one to build, and a "corrupted" call to it SUCCEEDS.
  // ⚠ `channels:setAgentDefaults` is NOT exempt and must not become so: it reads `defaults`, and a
  // garbage payload must still come back `{ ok: false }` with nothing stored.
  "channels:getAgentDefaults",
  // 2026-09-07: the turn-cap pair was exempted here too. Deleted with the caps.
  // `sessions:mintAgentId` reads no payload at all (2026-08-27), so there is no bad one to build:
  // a "corrupted" call to it SUCCEEDS, which would have asserted the refusal shape of a call that
  // really worked.
  "sessions:mintAgentId",
]);
