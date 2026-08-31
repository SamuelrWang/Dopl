// THE IPC OP INVENTORY — every `ipcMain.handle` across `channel-dir-ipc.js` +
// `session-ipc-ops.js`, with the payload each is driven with and the value a REFUSED call must
// return.
//
// ⚠ SPLIT OUT OF `channel-ipc-sender.test.mjs` ON 2026-08-27, at the 500-line cap. That file was
// sitting at EXACTLY 500 — the state its own subject's header (`main/session-ipc-ops.js`) names
// as the reason a split is taken: *"a file at the cap does not just stop growing; it stops being
// correctable."* This one had a sharper version of that problem, because **it is an INVENTORY:
// it is REQUIRED to grow whenever an op is added**, so at the cap the desktop could not gain an
// IPC op at all without vandalising the prose already here to make room.
//
// THE SEAM IS REASON-TO-CHANGE (§1). This module is the TABLE, which moves whenever the bridge
// gains or loses an op. `channel-ipc-sender.test.mjs` keeps the CASES — the sender binding, the
// fail-closed guard, the indistinguishable-refusal property — which move when the SECURITY MODEL
// moves, and have not in months.
//
// ⚠ IT IS DATA, NOT A TEST, and carries no `test()` of its own — hence the `_` prefix that keeps
// it out of `node --test 'test/**/*.mjs'`'s own reckoning, the same convention `_ipc-harness.mjs`
// and `_session-summary-harness.mjs` follow.
//
// ⚠ THE REVIEW RULE COMES WITH IT: adding a row here means the op's main-process handler was
// checked to exist and to be `appWindowOnly`-wrapped. `test/preload-parity.test.mjs` pins the
// other end (the preload's surface); this pins that every registered handler is sender-bound.

// ⚠ THE FIXTURES STAY IN THE HARNESS. This module is the TABLE; `CH` / `PRESET` /
// `POPOUT_PAYLOAD` are boot machinery both IPC suites share, and a second copy here is how
// two suites come to drive two different programs — the very drift the harness exists to stop.
import { CH, PRESET, POPOUT_PAYLOAD } from "./_ipc-harness.mjs";

// name -> [payload, the value a REFUSED call must return]
export const OPS = [
  ["channels:getFolderLabel", CH, null],
  ["channels:chooseFolder", CH, null],
  ["channels:clearFolder", CH, null],
  // ⚠ TWO ROWS STOOD HERE AND ARE DELETED WITH THE ARM (2026-08-20, Samuel's ruling):
  //   ["channels:getPermissionPreset", CH, null]
  //   ["channels:setPermissionPreset", { channelId: CH, preset: PRESET }, { ok: false }]
  // They were the SINGLE-USE permission arm — the pair an operator picked on an inbound
  // consent card before clicking Allow. The op that H3's header calls the worst in this file
  // is therefore no longer here; `channels:setLaunchPosture` below inherits that title, and
  // it is driven from every surface in exactly the same five ways. Deleted rather than
  // repointed because the handlers are gone from `channel-dir-ipc.js` outright: a row for an
  // unregistered op fails `every privileged op in the file is registered` on the first case.
  // ⚠ TWO JOINED HERE 2026-08-20 (the auto-send posture): the durable per-channel
  // send setting, boolean-only, same sender binding + UUID gate as every op above.
  ["channels:getAutoSend", CH, false],
  ["channels:setAutoSend", { channelId: CH, on: true }, { ok: false }],
  // ⚠ TWO JOINED HERE 2026-08-31 (Samuel's agent-chaining ruling): the durable per-channel
  // setting that lifts the one-generation launch bound. Boolean-only, same sender binding and
  // UUID gate as every op above, and the same refusal SHAPES — a refused `get` answers plain
  // `false`, which is also the fail-closed value, so a hostile page cannot tell a rejected
  // sender from a channel with chaining off.
  ["channels:getAgentChain", CH, false],
  ["channels:setAgentChain", { channelId: CH, on: true }, { ok: false }],
  // ⚠ TWO MORE JOINED 2026-08-20 (then the arm's half of that split was deleted the same
  // day): the DURABLE launch posture, the same two axes the arm carried, same sender
  // binding + UUID gate — and now the most privileged write in the file. A refused `get`
  // must not disclose the posture and a refused `set` must not write one; both are
  // asserted by the shared loops below, from all five surfaces.
  ["channels:getLaunchPosture", CH, null],
  ["channels:setLaunchPosture", { channelId: CH, preset: PRESET }, { ok: false }],
  // ⚠ TWO JOINED 2026-08-22 (Samuel's launch-over-MCP ruling): the MACHINE-WIDE standing
  // consent for the `channel_launch_directives` lane. They are the FIRST ops in this file whose
  // subject is not a channel — there is no id to UUID-gate, the payload is a bare boolean, and
  // the sender binding is therefore the ONLY guard on them, which is exactly why they belong in
  // this census. A refused `get` must not disclose whether the lane is armed and a refused `set`
  // must not arm it; both fall out of the shared loops below, from all five surfaces.
  // ⚠ AND THE REFUSAL SHAPES ARE THE HONEST "off" — `{enabled:false}` / `{ok:false}` are what a
  // machine that never enabled the lane answers too, so the difference discloses nothing.
  ["orchestrator:getLaunchEnabled", undefined, { enabled: false }],
  ["orchestrator:setLaunchEnabled", { enabled: true }, { ok: false }],
  // 2026-08-31: the PRIVATE DIRECT LANE's own consent — the same machine-wide, no-id shape as
  // the launch pair above, and a SEPARATE grant (directing reaches a running agent's private
  // lane; launching buys a process). Both refusals are indistinguishable from a genuine "off".
  ["orchestrator:getDirectEnabled", undefined, { enabled: false }],
  ["orchestrator:setDirectEnabled", { enabled: true }, { ok: false }],
  // ⚠ JOINED 2026-08-22 (Samuel's ended-agent ruling): the desktop half of the thread-delete
  // cascade. Main cannot see the SERVER's cascade, so an ended agent's frozen 7-day history
  // would outlive the thread it worked. It drops LOCAL stores only — never a `channel_message`,
  // and never a LIVE session (the SPA ends those first over `sessions:end`). Same sender
  // binding and UUID gate as every op here, which is what this list asserts by COUNT as well
  // as by name.
  ["agents:forgetThread", { channelId: CH, taskId: "t1" }, { ok: false }],
  // ⚠ JOINED 2026-08-25: the IN-APP CLAUDE CODE SIGN-IN — the ONE entry into the auth recovery
  // flow (`main/claude-signin-op.js`). It is the THIRD op in this census whose subject is the
  // MACHINE rather than a channel, after the two `orchestrator:*LaunchEnabled` members: it takes
  // no payload at all, so there is no id-shaped rejection for the refusal to be indistinguishable
  // FROM, and THE SENDER BINDING IS THE ONLY GUARD ON IT. That is why it is named here and listed
  // in NO_BAD_PAYLOAD below rather than quietly passing the shared loop.
  // ⚠ IT STARTS NO TURN AND GRANTS NOTHING. It drives an OAuth flow the operator completes in
  // their own browser — no credential is typed into a Dopl surface and none crosses the bridge —
  // and then RELEASES sessions this machine already holds, each the operator's own and contained
  // by the profile and posture it launched under. The failure direction of a forged call is a
  // native dialog the operator did not ask for, which they cancel; the assertion that matters is
  // the one below, that a refused call reaches no flow at all.
  ["claude:signIn", undefined, { ok: false }],
  ["sessions:reopen", { channelId: CH, taskId: "t1" }, { ok: false }],
  // ⚠ TWO JOINED HERE 2026-08-18 (wiring plan Phase 5): the Agents tab's controls on the
  // operator's OWN agent. They are STOP verbs — `interrupt` (the session window's pause
  // morph) and `end` ("End session") — dispatched through main's own reducer, so neither can
  // start a query, wake a parked shell, grant a tool or post anything. They sit under the
  // same sender binding and the same UUID gate as every op above, which is the whole
  // reason this list is asserted by COUNT as well as by name.
  ["sessions:pause", { channelId: CH, taskId: "t1" }, { ok: false }],
  ["sessions:end", { channelId: CH, taskId: "t1" }, { ok: false }],
  // ⚠ JOINED 2026-08-25 (Samuel's delete ruling): `sessions:end` PLUS A LOCAL ERASE — a live
  // agent stops through the SAME reducer event (one stop path, never two) and then every local
  // store keyed to it is dropped. It starts no query, grants no tool, posts nothing, and reaches
  // no `channel_messages`. Same binding + UUID gate; the review is in `preload-parity`.
  ["sessions:delete", { channelId: CH, taskId: "t1", agentId: "abcdefgh" }, { ok: false }],
  // ⚠ JOINED 2026-08-20: the Agents tab's launch — the one START verb, own-thread
  // only, UUID-gated on BOTH ids, posture owned by main (see preload-parity).
  ["sessions:launch", { channelId: CH, taskId: "t1" }, { ok: false }],
  // ⚠ JOINED 2026-08-25 (Samuel's rename ruling): what the operator CALLS one agent. Like
  // `approveTemplate` its subject is not a channel, so it carries the fourth tuple slot with
  // its own bad payload — there is no `channelId` to probe with. It moves no session, starts
  // nothing and grants nothing; it writes a DISPLAY string keyed by the instance address, and
  // nothing resolves an agent by it.
  ["sessions:rename", { agentId: "abcdefgh", name: "Research" }, { ok: false }, { agentId: "" }],
  // ⚠ TWO JOINED 2026-08-27 (Samuel's launch-panel ruling). `sessions:describe` is
  // `sessions:rename`'s twin in every respect this file cares about — subject is an agent, not a
  // channel (hence the fourth slot), moves no session, starts nothing, grants nothing.
  // `sessions:mintAgentId` takes NO payload (hence NO_BAD_PAYLOAD below), starts and reserves
  // nothing — a CSPRNG draw from `main/agent-id.js` whose PRESENCE is also the SPA's capability
  // gate for the pre-assigned launch id (see `test/preload-parity.test.mjs`).
  ["sessions:describe", { agentId: "abcdefgh", description: "Reviews the docs" }, { ok: false }, { agentId: "" }],
  ["sessions:mintAgentId", undefined, { ok: false }],
  // ⚠ JOINED 2026-08-22 (OQ-3, agent templates): the machine-local FIRST-USE APPROVAL of
  // ANOTHER member's template. It is the SECOND op in this file whose subject is not a
  // channel, so it is the second one with no `channelId` to probe with — hence the FOURTH
  // tuple slot below, which names the bad payload explicitly instead of letting the shared
  // loop assume every op is channel-gated.
  // ⚠ IT GRANTS NOTHING AND STARTS NOTHING. No query, no window, no tool, no post: it
  // decides only whether a foreign template's TEXT may become an agent's role on this Mac,
  // and a launch from an approved template is contained exactly like any other. The sender
  // binding matters anyway, because a forged call skips a question the operator should have
  // been asked.
  ["sessions:approveTemplate", { templateId: CH }, { ok: false }, { templateId: "not-a-uuid" }],
  // ⚠ AND ONE MORE 2026-08-18 (wiring plan Phase 10): the pop-out thread window. It is the
  // only op here that can MINT a window, which is exactly why it lives under the same
  // binding — and why its own guards (UUID channel, isSafeSegment on the other two, the
  // version floor, the window budget) all answer in this same `{ ok: false }` shape.
  ["threads:openWindow", POPOUT_PAYLOAD, { ok: false }],
  // ⚠ THREE JOINED 2026-08-20 (F-212's closure — the AGENT WINDOW). Reviewed
  // SEPARATELY, because they are not the same shape as each other:
  //   `sessions:openAgentWindow` — `threads:openWindow`'s twin: the second op here
  //     that can MINT a window, under the same binding, the same UUID + two
  //     `isSafeSegment` checks, the same version floor and the same budget, all
  //     answering in this one `{ ok: false }` shape.
  //   `sessions:message` — ⚠ THE ONLY OP IN THIS FILE THAT STARTS A TURN on an
  //     existing session. Everything else here reads, stops, stores a preference,
  //     or opens a window; `sessions:launch` starts one but MAKES the session it
  //     starts. Its bounds live at this boundary (UUID gate, `MESSAGE_CAP`,
  //     empty-after-trim refused, version floor) and its argument lives with the
  //     code that executes it (`main/session-reopen.js › messageByTask`).
  //   `sessions:narration` — read-only, and the one op here whose refusal shape is
  //     NOT `{ ok: false }`: it answers `{ entries: [] }`, because its caller
  //     renders a list and a refusal must look like "nothing to show", not throw.
  //     ⚠ That makes it the ONE row whose refusal value differs, which is the
  //     reason this table pairs every op with its own expected refusal rather
  //     than assuming one.
  ["sessions:openAgentWindow", { segment: "acme-a1b2", channelId: CH, taskId: "t1" }, { ok: false }],
  ["sessions:message", { channelId: CH, taskId: "t1", text: "hello" }, { ok: false }],
  // ⚠ JOINED 2026-08-20: the agent view's LIVE permission controls. Same binding, same UUID
  // gate; the axis is restricted to two literals here and the mode is re-validated against
  // `session-profiles.js`'s frozen enums before it reaches the reducer, which coerces again.
  // ⚠ It widens SUPERVISION (is the operator asked?), never CONTAINMENT (what is reachable
  // at all) — the profile is checked first and no posture can widen it. `preload-parity`
  // carries the full review.
  ["sessions:setMode", { channelId: CH, taskId: "t1", axis: "tools", mode: "bypass" }, { ok: false }],
  // ⚠ JOINED 2026-08-22 (Samuel's model-selection ruling): the LIVE model switch. Same binding,
  // same UUID gate; the value is coerced against `session-model.js`'s frozen ID list here and
  // converted to the argv-safe alias inside, so a forged string CLEARS the override rather than
  // reaching a child process. It grants nothing and reaches no gate — the failure direction of a
  // forged call is that the operator's own agent answers on a different model.
  ["sessions:setModel", { channelId: CH, taskId: "t1", model: "claude-opus-5" }, { ok: false }],
  ["sessions:narration", { channelId: CH, taskId: "t1" }, { entries: [] }],
];

// ⚠ THE TWO MACHINE-WIDE OPS HAVE NO BAD PAYLOAD TO REJECT, WHICH IS WHY THEY ARE LISTED HERE
// RATHER THAN QUIETLY PASSING (2026-08-22). `orchestrator:get/setLaunchEnabled` take no id: the
// subject is the machine, so `get` has no argument at all and `set`'s is a bare boolean that
// `=== true` coerces rather than refuses. There is therefore no id-shaped rejection for the
// refusal to be indistinguishable FROM, and the sender binding is the ONLY guard on them —
// which is the point of naming them, not an exemption from scrutiny. The bad-SENDER half of the
// loop below still runs for both, and it is the half that matters for these two.
// ⚠ AND `claude:signIn` JOINED THEM ON 2026-08-25 for the same structural reason: its subject is
// the MACHINE's Claude Code credential, so it takes no argument whatsoever. There is nothing to
// corrupt, and corrupting a key it does not read would have driven a VALID call through the
// bad-payload arm — which for THIS op means popping a real native dialog inside the suite. The
// bad-SENDER half of the loop still runs for it, and the case below proves a refused call reaches
// no sign-in flow at all.
export const NO_BAD_PAYLOAD = new Set([
  "orchestrator:getLaunchEnabled",
  "orchestrator:setLaunchEnabled",
  "orchestrator:getDirectEnabled",
  "orchestrator:setDirectEnabled",
  "claude:signIn",
  // ⚠ IT READS NO PAYLOAD AT ALL (2026-08-27), so there is no bad one to build: it answers
  // eight CSPRNG characters to any bound caller and the sender binding is the entire gate.
  // Listed here rather than given a fourth-slot payload, because a "corrupted" call to this op
  // SUCCEEDS — which would have asserted the refusal shape of a call that really worked.
  "sessions:mintAgentId",
]);
