/**
 * THE PINNED `window.dopl` OP SURFACE, split out of `preload-parity.test.mjs` on 2026-09-05 for
 * the 500-line cap (ENGINEERING.md §2). It is a LIST, not logic: the assertions, the loader and
 * the reasoning stay in the test; only the inventory moved, so the file that argues about the
 * surface is readable again.
 *
 * ⚠ ORDER IS PART OF THE ASSERTION — `opPaths` walks the exposed object and the test compares
 * deep-equal, so a reordering here reads as a changed surface. Add an op where it actually sits.
 */
export const APP_OPS = [
  "apiRequest",
  "avatarDataUri",
  "beginSignIn",
  "channels.chooseFolder",
  "channels.clearFolder",
  // ⚠ TWO OPS JOINED HERE ON 2026-08-20 (the auto-send posture): the pin failed on the
  // ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `channels:getAutoSend` / `channels:setAutoSend`, both `appWindowOnly`,
  //     both UUID-gating `channelId`, storage in `main/channel-prefs.js › get/setAutoSend`
  //     (durable, default OFF, boolean-only writes).
  //   • THEY WIDEN LITTLE, AND IN THE STATED DIRECTION: the setting governs whether the
  //     operator's OWN agent's drafted reply posts without a Send click. A forged `set`
  //     from an app window can flip a channel to auto-send — the same authority the
  //     Settings tab hands the operator — and never grants a tool, reads a secret, or
  //     reaches another member's machine.
  // ⚠ TWO OPS JOINED HERE ON 2026-08-31 (Samuel's agent-chaining ruling): the pin failed on
  // the ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `channels:getAgentChain` / `channels:setAgentChain`, both `appWindowOnly`,
  //     both UUID-gating `channelId`, storage in `main/channel-prefs.js › get/setAgentChain`
  //     (durable, per channel, default OFF, boolean-only writes, off deletes the key).
  //   • THEY WIDEN LITTLE, AND IN THE STATED DIRECTION: the setting lifts a DEPTH bound —
  //     whether an agent launched in this channel may launch further agents — and grants
  //     nothing else. A forged `set` from an app window can turn chaining on for one channel,
  //     the same authority the Settings tab hands the operator, and a chained launch still
  //     needs `bypass`, the outbound half, the machine-wide orchestrator toggle, a free slot
  //     against `MAX_CONCURRENT_SESSIONS` and the rolling budget in `main/launch-budget.js`.
  //   • ⚠ IT REACHES NO RUNNING SESSION. The flag is a SPAWN-TIME stamp, so a forged flip
  //     cannot widen an agent that is already working — the asymmetry with
  //     `setLaunchPosture` below, which fans out live, and it is deliberate: that one widens
  //     SUPERVISION, this one is CONTAINMENT.
  "channels.getAgentChain",
  "channels.getAutoSend",
  "channels.getFolderLabel",
  // ⚠ TWO MORE JOINED HERE ON 2026-08-20 (the arm-vs-durable-posture split): the pin failed
  // on the ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `channels:getLaunchPosture` / `channels:setLaunchPosture`, both
  //     `appWindowOnly`, both UUID-gating `channelId`, with BOTH axes re-validated against
  //     the frozen enums in `main/channel-prefs.js › normalizePreset` (a half-valid pair is
  //     rejected whole and writes nothing).
  //   • THEY WIDEN THE SAME AUTHORITY THE SETTINGS TAB ALREADY HANDS THE OPERATOR, on a
  //     record with exactly ONE consumer: `sessions:launch`, the operator's own Launch
  //     button. It is SUPERVISION, not containment — a forged `set` to `bypass` cannot
  //     escape the channel's tool profile or `session-profiles.js › SESSION_HARD_DENY`, and
  //     Axis B still refuses to let any tool posture send a message.
  //   • ⚠ AND SINCE LATER THE SAME DAY THEY ARE THE ONLY POSTURE OPS ON THIS BRIDGE. The
  //     entry above used to end "IT IS NOT THE ARM — `channels.get/setPermissionPreset` stays
  //     single-use, 30-minute, consent-only (H2), and wiring either pair to the other's
  //     consumer re-opens the failure H2 exists to prevent". Both arm ops are DELETED
  //     (Samuel's ruling), together with their main-process handlers and the whole
  //     `channelPermissionPresets` record. The warning still applies to THIS pair and is
  //     what the one-consumer census in `test/session-preset-start.test.mjs` enforces:
  //     `channels.setLaunchPosture` writes a record read by `sessions:launch` and by nothing
  //     else, and a second reader is H2 re-opened whether or not an arm exists to contrast it
  //     with.
  "channels.getLaunchPosture",
  // ⚠ TWO OPS WERE REMOVED FROM THIS LIST ON 2026-08-20, and a REMOVAL is exactly what this
  // file exists to catch — so it is stated rather than absorbed. `channels.getPermissionPreset`
  // and `channels.setPermissionPreset` sat between the two entries above and below. The pin's
  // premise is "a removed op is a silently missing feature", and the check that premise
  // demands was made: the feature was ALREADY missing. The arm's web controls lived in
  // `launch-panel.tsx`'s INBOUND branch, which stopped rendering at the 2026-08-18 consent
  // rewrite (the panel's one consumer is the outbound send box, so `kind === "inbound"` was
  // never true in production — measured, F-233). Nothing feature-detected these two, because
  // nothing could reach them. The main-process handlers are gone with them, so leaving them
  // pinned would assert a bridge to nowhere.
  "channels.setAgentChain", // 2026-08-31 — the review is on `channels.getAgentChain` above
  "channels.setAutoSend",
  "channels.setLaunchPosture",
  // ⚠ ONE JOINED HERE ON 2026-08-25: `claude.signIn`, the ONE entry into the Claude Code auth
  // recovery flow. The pin failed on the ADD, which is the review this comment records:
  //   • The main-process handler EXISTS and was checked first — `main/session-ipc-ops.js`
  //     registers `claude:signIn` under the same `appWindowOnly()` sender binding as every op
  //     above, delegating to `main/claude-signin-op.js › signIn`. It takes NO PAYLOAD: the
  //     subject is the MACHINE, so there is no id to UUID-gate and the sender binding is the
  //     ONLY guard — the third op in this family with that shape, after the two
  //     `orchestratorLaunch` members, and enumerated in `channel-ipc-sender.test.mjs` for it.
  //   • ⚠ IT EXISTS BECAUSE THE DETECTION HAD NO REMEDY. `session-auth.js` has HELD sessions on
  //     a missing Claude Code credential since Q6 and the channels surface has said so out loud,
  //     but `claude-auth.js › startSignInFlow` and `session-auth.js › resumeAfterSignIn` had
  //     ZERO production callers — so re-posting into a held agent was refused with `auth-hold`
  //     forever and no dialog could ever appear. This is exactly the failure THIS FILE exists to
  //     catch, arrived at from the other end: the bridge op was never written at all.
  //   • NO CREDENTIAL CROSSES IT IN EITHER DIRECTION. Main opens the OAuth page in the SYSTEM
  //     BROWSER and collects the pasted code in its own local window (`main/claude-auth.js`);
  //     nothing is typed into a Dopl surface and the answer is a bare `{ ok }` — no token, no
  //     path, no reason string a probe could read.
  //   • IT STARTS NO TURN AND GRANTS NOTHING. On success it RELEASES sessions this machine is
  //     already holding, each of them the operator's own and contained by the profile and
  //     posture it launched under. The failure direction of a forged call is a native dialog
  //     the operator did not ask for, which they cancel.
  "claude.signIn",
  "getAuthState",
  "onAuthState",
  "onNavigate",
  "onSyncEvent",
  "openExternal",
  // ⚠ TWO OPS JOINED HERE ON 2026-08-22 (Samuel's launch-over-MCP ruling): `orchestratorLaunch
  // .get` / `.set`, the MACHINE-WIDE standing consent for the `channel_launch_directives` lane.
  // The pin failed on the ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `orchestrator:getLaunchEnabled` / `orchestrator:setLaunchEnabled`, both
  //     `appWindowOnly`. There is NO id to UUID-gate: the subject is the machine, so the payload
  //     is a bare boolean and `=== true` is the whole validation. Storage is
  //     `main/channel-prefs.js › get/setOrchestratorLaunch` — durable, default OFF, boolean-only
  //     writes, unreadable store reads as false.
  //   • ⚠ THIS PAIR IS MATERIALLY DIFFERENT FROM EVERY OTHER OP ON THIS LIST, AND THE REVIEW IS
  //     THE POINT OF IT. Enabled, it lets a DIRECTIVE — a row another agent wrote with this
  //     operator's own credential — cause this machine to spawn a session with no click. That is
  //     `sessions.launch`'s authority, exercised by a program. So the toggle IS the consent
  //     (Samuel's ruling, replacing "the click IS that human" for this lane), and everything
  //     about where it lives follows from that: **it is deliberately not reachable by any Dopl
  //     credential.** No route, no MCP op, no `workspace_settings` column — because a spawned
  //     session has `Bash` and the device token is on disk (§6), so a server-side flag could be
  //     flipped by the very agents it governs, on every machine the operator owns.
  //   • ⚠ IT WIDENS WHO MAY PRESS, NEVER WHAT IS ALLOWED. A directive-driven launch is exactly
  //     as contained as a button launch: the channel's own tool profile, the same durable
  //     posture, `session-profiles.js › SESSION_HARD_DENY`, the windowless message floor. A
  //     forged `set` from an app-window top frame buys the same thing the Settings row hands
  //     the operator and reaches no other machine.
  //   • Both are feature-probed by the SPA; an older main has no toggle, which reads OFF.
  // ⚠ TWO JOINED HERE ON 2026-08-31: `orchestratorDirect`, the PRIVATE DIRECT LANE's standing
  // consent. The pin failed on the ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `orchestrator:getDirectEnabled` / `orchestrator:setDirectEnabled` under the
  //     same `appWindowOnly()` sender binding as every op above. They take NO id: the subject
  //     is the MACHINE, so there is nothing to UUID-gate and `=== true` on a bare boolean is
  //     the whole validation — the same shape the two `orchestratorLaunch` members have, and
  //     enumerated in `channel-ipc-sender.test.mjs` beside them.
  //   • WHAT IT WIDENS, AND IN WHICH DIRECTION: it lets the operator's OWN external agent
  //     deliver a private message into one of the operator's OWN running agents. Default OFF,
  //     so the lane does nothing until a human turns it on at this machine.
  //   • FORGED FROM AN APP-WINDOW TOP FRAME, the worst case is that the operator's direction
  //     lane is armed or disarmed. It starts no turn by itself, grants no tool, widens no
  //     posture, reads no secret and reaches no other machine — a direction still has to be
  //     filed by that operator's own credential and still lands in an existing session's
  //     private turn, inside that session's existing containment.
  //   • WHAT IT DOES NOT DO: it is not a second launch toggle, it cannot direct a PEER's agent
  //     (there is no argument anywhere that names another operator), and it cannot make a
  //     directed turn post anything — the private-turn gate holds an outbound post for the
  //     operator's approval whatever this is set to.
  "orchestratorDirect.get",
  "orchestratorDirect.set",
  "orchestratorLaunch.get",
  "orchestratorLaunch.set",
  "passwordSignIn",
  "sendMagicLink",
  // ⚠ ONE JOINED HERE ON 2026-08-22 (OQ-3, the agent-templates launch wave):
  // `sessions.approveTemplate` records THIS MACHINE's first-use approval of ANOTHER MEMBER's
  // agent template. The review, because the pin fails on the ADD:
  //
  //   • It STARTS NOTHING and GRANTS NOTHING. No query, no shell wake, no tool, no post. It
  //     decides one thing: whether a foreign template's TEXT may become an agent's role here.
  //     A launch from an approved template is contained exactly like any other launch — same
  //     tool profile, same permission axes, same working folder, same hard-deny floor.
  //   • Handler: `main/session-ipc-ops.js › sessions:approveTemplate`, `appWindowOnly`, with a
  //     UUID gate on the id, delegating to `main/session-launch-op.js › approveTemplate`.
  //   • The failure direction of a FORGED call is that a template the operator would have been
  //     asked about runs without the question. That is why it is sender-bound like everything
  //     else here, and why the store it writes is machine-local: a SERVER-writable approval
  //     would let a credential-holding agent pre-approve itself across the whole fleet, which
  //     is the escalation `orchestratorLaunchEnabled` exists to not have either.
  "sessions.approveTemplate",
  // ⚠ ONE JOINED HERE ON 2026-08-25 (Samuel's delete ruling): `sessions.delete`, the Agents-tab
  // card's trash icon. The pin failed on the ADD, which is the review this comment records:
  //   • The main-process handler EXISTS and was checked before this list was edited —
  //     `main/session-ipc-ops.js` registers `sessions:delete` under the same `appWindowOnly()`
  //     sender binding as every op above, UUID-gates `channelId`, and delegates to
  //     `main/session-delete-op.js › deleteAgent`, which re-validates the payload because the
  //     split moved the code and not the boundary.
  //   • IT IS A STOP VERB PLUS A LOCAL ERASE, AND IT WIDENS NOTHING. It cannot start a query,
  //     wake a parked shell, grant a tool or post anything. A live session is ended through the
  //     SAME reducer event `sessions:end` dispatches — one stop path, never two — and then the
  //     LOCAL stores keyed to that agent are dropped. The failure direction of a forged call is
  //     an agent that stops and a local card that disappears.
  //   • ⚠ **IT REACHES NO `channel_messages`.** Everything the agent posted is the SERVER's
  //     shared record and is unreachable from main at all; the transcript keeps every message
  //     and keeps attributing it to `Agent #<id>`, because the id rides the message rather than
  //     any table this op can touch. The only server-visible effect is the one `end` already
  //     has: the session projects as `ended`.
  //   • ⚠ `agentId` IS REQUIRED, uniquely on this namespace. Every other op resolves an omitted
  //     id to the OLDEST live agent on the thread; for a DESTRUCTIVE verb that is a DIFFERENT
  //     agent than the card that was clicked, and nothing would report the substitution.
  //   • Own agents only, structurally: the registry and the local stores hold nothing but this
  //     operator's own agents on this machine.
  "sessions.delete",
  // ⚠ TWO OPS JOINED HERE ON 2026-08-27 (the composer's launch panel). The pin failed on the
  // ADD, which is the review this comment records:
  //   • BOTH main-process handlers EXIST and were checked before this list was edited —
  //     `main/session-ipc-ops.js` registers `sessions:describe` and `sessions:mintAgentId`
  //     under the same `appWindowOnly()` sender binding as every op above. A pinned op with no
  //     handler is a promise the bridge cannot keep; that is the check this rule forces.
  //   • `sessions.describe` IS `sessions.rename`'S TWIN, field for field: it takes no channel,
  //     moves no session, starts no turn, grants nothing, and never consults the registry. It
  //     writes one machine-local string to `main/agent-names.js` — the same store, the same
  //     `electron-store` record, the same never-server-reachable rule.
  //   • `sessions.mintAgentId` STARTS NOTHING AND RESERVES NOTHING. It returns eight characters
  //     from `main/agent-id.js › newAgentId` — a pure CSPRNG draw with no registry entry and
  //     nothing to release. ⚠ ITS PRESENCE IS ALSO A CAPABILITY GATE: the SPA reads it as "this
  //     build's `session-launch-op.js` forwards a caller-supplied `agentId`", and falls back to
  //     filling the id in after launch when it is absent. **Removing it does not merely lose an
  //     op — it silently re-enables the fallback**, which is exactly the class of disappearance
  //     this file exists to catch.
  "sessions.describe",
  // ⚠ TWO OPS JOINED HERE ON 2026-08-18 (wiring plan Phase 5): `sessions.pause` and
  // `sessions.end`, the Agents tab's controls on the operator's OWN agent. The pin failed on
  // the ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked before this list was edited —
  //     `main/channel-dir-ipc.js` registers `sessions:pause` / `sessions:end`, both wrapped in
  //     the same sender binding as `sessions:reopen` and the folder ops (`mainOnly()` when this
  //     entry was written; `appWindowOnly()` since Phase 10 widened its subject), both
  //     UUID-gating `channelId`. A pinned op with no handler is a promise the bridge cannot
  //     keep; that is the check this rule exists to force.
  //   • THEY WIDEN NOTHING. Each resolves (channel, thread) against main's OWN session
  //     registry and dispatches a reducer event the session window's buttons already
  //     dispatched — `interrupt` (the send button's pause morph) and `end` ("End session").
  //     No query starts, no shell wakes, no tool is granted, nothing is posted. The failure
  //     direction of a forged call is an agent that STOPS.
  //   • Own agents only, structurally: the registry holds nothing but this operator's sessions
  //     on this machine, so there is no cross-member control surface to abuse.
  "sessions.end",
  // ⚠ JOINED 2026-08-22 with Samuel's ended-agent ruling: `sessions.forgetThread` drops every
  // LOCAL trace of a deleted thread's ended agents (frozen history, durable record, resume map,
  // ended card, notice guard). Main cannot see the server's delete cascade, so without a call
  // from the SPA an ended agent's history outlives its thread by up to seven days. It deletes
  // no `channel_messages` and cannot touch a LIVE session — the SPA ends those first.
  "sessions.forgetThread",
  // ⚠ ONE JOINED HERE ON 2026-08-20: `sessions.launch`, the Agents tab's "Launch
  // agent" button — attach MY OWN agent to a thread, windowless. Handler exists
  // (`main/session-ipc-ops.js › sessions:launch`, appWindowOnly, UUID-gated channel
  // AND task). It DOES start a query — the materially different shape Phase 5's
  // stop verbs called out — and that is the feature: the same authority the
  // consent Allow exercises, here exercised by the operator on their OWN thread
  // with no peer involved. Posture is main's (auto_inbound / channel auto-send);
  // the renderer hands over ids and display strings only.
  "sessions.launch",
  // ⚠ FOUR JOINED HERE ON 2026-08-20 (F-212's closure — the AGENT WINDOW). The pin failed
  // on the ADD, which is the review this comment records. They are NOT equivalent to each
  // other and are reviewed separately:
  //
  //   `sessions.message` — ⚠ THE ONE OP ON THIS BRIDGE THAT STARTS A TURN, and the only
  //     reason this namespace's failure direction is no longer simply "an agent that
  //     stops". Handler: `main/channel-dir-ipc.js › sessions:message`, appWindowOnly,
  //     UUID-gated channel, body capped in BOTH layers (the preload's is a convenience,
  //     main's `MESSAGE_CAP` is the fence), empty-after-trim refused, and the version floor
  //     applies. It dispatches the EXISTING `steer` reducer event through
  //     `session-reopen.js › messageByTask` — no new branch and no second wake path — on a
  //     session resolved by (channel, thread) against MAIN'S OWN registry, which is what
  //     makes it own-agents-only structurally rather than by a check. The text is delimited
  //     with that session's nonce and carries OPERATOR authority (`session-seed.js ›
  //     frameOperatorTurn`); it is deliberately NOT fenced as data, and that file states
  //     why. ⚠ It BYPASSES the inbound gate, correctly: AXIS B governs counterparty turns,
  //     and this is the operator's own keyboard in a window main created. Worst case of a
  //     forged call: the operator's own agent does work they did not ask for, inside its
  //     existing profile and containment — it grants no tool, widens no posture, reaches no
  //     other machine, and cannot post without the outbound gate.
  //   `sessions.openAgentWindow` — `threads.openWindow`'s twin, verbatim guards: it ASKS
  //     for a window and gets none back, three strings character-checked (UUID + two
  //     `isSafeSegment`), one `{ ok: false }` refusal shape, version floor honoured.
  //   `sessions.narration` / `sessions.onNarration` — READ-ONLY, derived from in-memory
  //     state: no path, no token, no window handle, and explicitly no `inputFull` (which is
  //     unbounded by construction — `main/session-narration.js` states what may enter a
  //     ring entry). Read once on mount, then listen, like `summaries`/`onSummaries`.
  "sessions.message",
  "sessions.mintAgentId",
  "sessions.narration",
  "sessions.onNarration",
  "sessions.onSummaries",
  "sessions.openAgentWindow",
  "sessions.pause",
  // ⚠ JOINED 2026-08-25: `sessions.rename` — what the operator calls one agent. DISPLAY ONLY:
  //     the main-process handler EXISTS and was checked before this list was edited —
  //     `main/session-ipc-ops.js` registers `sessions:rename` under the same `appWindowOnly()`
  //     sender binding as every op above, gates `agentId` through `agent-id.js › isAgentId`,
  //     and stores the string in `main/agent-names.js` keyed by that address.
  //   • It moves no session, starts no turn and grants nothing; it cannot wake anything,
  //     because the registry is never consulted.
  //   • NOTHING RESOLVES AN AGENT BY IT. `@<agentId>` and every op still address the id, so a
  //     rename can never re-point a running instruction.
  "sessions.rename",
  "sessions.reopen",
  // ⚠ ONE JOINED HERE ON 2026-08-20: `sessions.setMode`, the agent view's LIVE permission
  // controls. The pin failed on the ADD, which is the review this comment records:
  //   • The main-process handler EXISTS and was checked first — `main/channel-dir-ipc.js`
  //     registers `sessions:setMode`, `appWindowOnly`, UUID-gating `channelId`, with the
  //     AXIS restricted to the two literals and the MODE re-validated against
  //     `session-profiles.js`'s frozen enums (the same normalizers `channel-prefs.js`
  //     uses) — and the reducer coerces AGAIN fail-closed via `coerceMode`, so an unknown
  //     value lands on the most restrictive member of its axis rather than half-applying.
  //   • ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT — the review this op turns on. The two
  //     axes decide whether the OPERATOR IS ASKED. The PROFILE decides what is reachable at
  //     all, is checked FIRST, and no posture can widen it: `SESSION_HARD_DENY` is
  //     unconditional, and `bypass` is a POSITIVE allow-list, so an unclassified tool (any
  //     built-in a newer CLI ships, every tool from the operator's own MCP servers) gates in
  //     EVERY mode, `bypass` included. So the worst a forged call achieves is to stop asking
  //     about tools this operator's own channel profile ALREADY PERMITS.
  //   • THAT IS THE SAME AUTHORITY THE DURABLE POSTURE ALREADY HANDS THEM. `channels.
  //     setLaunchPosture` sets exactly these two axes for the next spawn; this sets them on a
  //     session already running. A forged call buys a few minutes' head start on a decision
  //     the operator can make from the Settings tab, and reaches no other machine.
  //   • ⚠ IT IS NOT THAT DURABLE POSTURE AND MUST NOT BE WIRED TO IT. This writes NOTHING —
  //     it moves one live session's reducer state, and the channel's stored posture is
  //     untouched. Collapsing the two would make a per-session decision permanent.
  "sessions.setMode",
  // ⚠ ONE MORE JOINED ON 2026-08-22: `sessions.setModel`, the LIVE model switch (Samuel's
  // model-selection ruling). The same review, and it lands in a materially milder place:
  //   • The main-process handler EXISTS and was checked first — `main/session-ipc-ops.js`
  //     registers `sessions:setModel`, `appWindowOnly`, UUID-gating `channelId`, coercing the
  //     value against `session-model.js`'s frozen ID list at the boundary and converting to the
  //     argv-safe ALIAS inside. `session-query.js › buildSdkOptions` coerces once more, as the
  //     last step before the value could become `--model` on a child process.
  //   • THE FAILURE DIRECTION IS THE MILDEST ON THIS BRIDGE: a forged call makes the operator's
  //     OWN agent answer on a different model. It grants no tool, widens no posture, reaches no
  //     other machine, and the permission table never reads a model at all.
  //   • AN UNKNOWN VALUE CLEARS THE OVERRIDE rather than being refused, which is deliberate:
  //     "let the CLI choose" is a legitimate ask and is what an unset channel already does. A
  //     forged string therefore cannot even pin a model, only un-pin one.
  //   • ⚠ IT IS NOT `channels.setLaunchPosture`'s `model` FIELD. That one governs the NEXT spawn
  //     and is durable; this moves one running session and stores nothing per channel. Same
  //     distinction `setMode` carries above, for the same reason.
  "sessions.setModel",
  "sessions.summaries",
  "signOut",
  "syncWatch",
  // ⚠ ONE JOINED HERE ON 2026-08-18 (wiring plan Phase 10): `threads.openWindow`, the
  // thread view's "Open as new window". The pin failed on the ADD, which is the review this
  // comment records:
  //   • The main-process handler EXISTS and was checked before this list was edited —
  //     `main/channel-dir-ipc.js` registers `threads:openWindow` under the same
  //     `appWindowOnly()` sender binding as every op above, UUID-gates `channelId`, and runs
  //     the segment and the thread id through `deep-link-target.js › isSafeSegment` (the ONE
  //     character rule for a string entering a router path). A pinned op with no handler is
  //     a promise the bridge cannot keep; that is the check this rule exists to force.
  //   • IT ASKS FOR A WINDOW; IT DOES NOT GET ONE. No handle, window id or reference comes
  //     back — main creates the window and main registers it in `main/app-windows.js`. That
  //     is precisely why widening the sender binding in this phase is safe: the renderer
  //     cannot enlarge the set of bound senders, only ask main to.
  //   • The failure directions are all refusals in ONE shape (`{ ok: false }`): a bad id, a
  //     blocking version floor, a full window budget. Nothing here starts a query, wakes a
  //     shell, grants a tool or posts anything.
  "threads.openWindow",
  // ⚠ TWO JOINED HERE ON 2026-09-05 (task 9b; Samuel's #1098 via #1101 item 4b, ruled (a) in
  // #1177): `turnCap.get` / `turnCap.set`, the machine's LOOP-SAFETY BRAKE. The pin failed on the
  // ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `settings:getTurnCap` / `settings:setTurnCap` under the same `appWindowOnly()`
  //     sender binding as every op above, and both are enumerated in `_ipc-ops-table.mjs`. There
  //     is NO id to UUID-gate: the subject is the MACHINE, the fourth op family here with that
  //     shape after the two `orchestrator*` pairs and `claude.signIn`, so the sender binding is
  //     the only guard on them. Storage is `main/settings.js › sessionTurnCap`, whose `setTurnCap`
  //     is the ONE writer of that key in the app.
  //   • ⚠ THIS ONE CAN REMOVE A SAFETY BOUND, WHICH THE OTHERS CANNOT. `set(0)` means unlimited:
  //     the cap is what ends a runaway session (`session-reducer.js`, reason `turn_cap`), and
  //     without it a loop between two agents has no local stop. That is why there is no route, no
  //     MCP op and no `workspace_settings` column for it — a SERVER-writable version would let an
  //     agent holding this operator's device token (§6) unbound itself on every Mac they own.
  //   • FORGED FROM AN APP-WINDOW TOP FRAME, the worst case is the operator's own machine running
  //     with a cap they did not choose. It starts no turn, grants no tool, opens no window, posts
  //     nothing and reaches no other machine — and it applies to NEW sessions only, because a
  //     running session read its cap at launch and re-reads nothing (#1177: the reducer owns every
  //     transition, so a live re-read is a reducer event and a build of its own).
  //   • Both are feature-probed by the SPA; an older main has no turn-cap concept, which reads as
  //     NO ROW rather than an inert one.
  "turnCap.get",
  "turnCap.set",
];
