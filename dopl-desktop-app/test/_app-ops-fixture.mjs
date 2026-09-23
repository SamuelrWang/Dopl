/**
 * The pinned `window.dopl` op surface, split out of `preload-parity.test.mjs` on 2026-09-05.
 * ORDER IS PART OF THE ASSERTION: `opPaths` walks the exposed object and the test compares
 * deep-equal, so a reordering reads as a changed surface. Add an op where it actually sits.
 */
export const APP_OPS = [
  "apiRequest",
  // 2026-09-13 (Wispr-Flow ruling): `appWindow.close` / `.toggleMaximize`. Both handlers are
  // `appWindowOnly`, take NO arguments and can name no other window — the only window either can
  // reach is the caller's own, which is the authority macOS's own buttons had before `frame: false`.
  "appWindow.close",
  // 2026-09-13 (tabbed pop-out): `closeTab` is the first of these to take an argument, and the key
  // names a TAB INSIDE THE SENDER'S OWN WINDOW. Two fences: the sender must be a bound app window
  // AND that window must BE the agent window (`agent-window.js › isHostWindow`); an unknown key
  // answers `false`. The LAST-TAB rule stays in MAIN, so the renderer cannot close a window by
  // emptying a list. `onTabs` is a listener — main pushes `agent-window:tabs`.
  "appWindow.closeTab",
  "appWindow.onTabs",
  "appWindow.toggleMaximize",
  "avatarDataUri",
  "beginSignIn",
  // 2026-09-18 (default-agent-settings ruling): `channels.apply/get/setAgentDefaults` — the
  // machine-user's DEFAULTS record and the seed that copies it into a channel at CREATION. All
  // three are appWindowOnly; only `apply` takes an id and it is UUID-gated. ⚠ THE RECORD IS NEVER
  // READ AT A SPAWN (`main/agent-defaults.js` states why that would re-open H2 and would
  // additionally re-point every EXISTING channel), and `apply` refuses a channel that already has
  // a posture — so a forged call reaches no configured room, no running session, no other machine.
  "channels.applyAgentDefaults",
  "channels.chooseFolder",
  "channels.clearFolder",
  // `channels.get/setAutoSend`'s ADD review is retired with the ops (2026-09-06, item 8); the
  // REMOVAL review is on `channels.getAutoSend`'s former line below.
  // 2026-08-31 (agent-chaining ruling): `channels.get/setAgentChain` — appWindowOnly, UUID-gated,
  // durable per channel, default OFF, boolean-only. It lifts a DEPTH bound (may an agent launched
  // here launch more?) and nothing else, and it is a SPAWN-TIME stamp, so a forged flip cannot
  // widen a session already running — the deliberate asymmetry with `setLaunchPosture`, which
  // fans out live: that one widens SUPERVISION, this one is CONTAINMENT.
  "channels.getAgentChain",
  "channels.getAgentDefaults", // 2026-09-18 — the review is on `channels.applyAgentDefaults` above
  // 2026-09-06 (settings overhaul, item 8): `channels.getAutoSend` / `.setAutoSend` are DELETED,
  // handlers and storage with them — leaving them pinned would assert a bridge to nowhere. The
  // axis they set is the launch posture's `messages`, whose ops are already pinned here, so the
  // setting did not die; the second authority over one axis did.
  "channels.getFolderLabel",
  // 2026-08-20: `channels.get/setLaunchPosture` — appWindowOnly, UUID-gated, with BOTH axes
  // re-validated against the frozen enums in `channel-prefs.js › normalizePreset` (a half-valid
  // pair is rejected whole and writes nothing). It is SUPERVISION, not containment: a forged `set`
  // to `bypass` cannot escape the channel's tool profile or `session-profiles.js › SESSION_HARD_DENY`.
  // It has exactly ONE consumer (`sessions:launch`); a second reader re-opens the failure H2 exists
  // to prevent, which is what the census in `test/session-preset-start.test.mjs` enforces.
  "channels.getLaunchPosture",
  // 2026-08-20: `channels.getPermissionPreset` / `.setPermissionPreset` were REMOVED, and a removal
  // is exactly what this file exists to catch — so it is stated rather than absorbed. The feature
  // was already missing: the arm's web controls lived in `launch-panel.tsx`'s INBOUND branch, which
  // stopped rendering at the 2026-08-18 consent rewrite (F-233). The handlers are gone with them.
  "channels.setAgentChain", // 2026-08-31 — the review is on `channels.getAgentChain` above
  "channels.setAgentDefaults", // 2026-09-18 — the review is on `channels.applyAgentDefaults` above
  // `channels.setAutoSend` left 2026-09-06 — the removal review is on `channels.getAutoSend` above.
  "channels.setLaunchPosture",
  // 2026-08-25: `claude.signIn`, the ONE entry into the Claude Code auth recovery flow. It takes NO
  // PAYLOAD — the subject is the MACHINE, so the sender binding is the only guard. It exists because
  // the detection had no remedy: `session-auth.js` had HELD sessions on a missing credential since
  // Q6 while `startSignInFlow` / `resumeAfterSignIn` had zero production callers. NO CREDENTIAL
  // CROSSES IT: main opens the OAuth page in the SYSTEM BROWSER and answers a bare `{ ok }`. On
  // success it RELEASES sessions this machine is already holding.
  "claude.signIn",
  "getAuthState",
  "onAuthState",
  "onNavigate",
  "onSyncEvent",
  "openExternal",
  // 2026-08-22 (launch-over-MCP ruling): `orchestratorLaunch.get` / `.set` — the MACHINE-WIDE
  // standing consent for the `channel_launch_directives` lane. No id to UUID-gate; the payload is a
  // bare boolean and `=== true` is the whole validation. Enabled, it lets a DIRECTIVE cause this
  // machine to spawn a session with no click, so THE TOGGLE IS THE CONSENT — and it is deliberately
  // not reachable by any Dopl credential (no route, no MCP op, no `workspace_settings` column),
  // because a spawned session has `Bash` and the device token is on disk (§6). It widens WHO MAY
  // PRESS, never what is allowed. Feature-probed by the SPA; an older main reads OFF.
  // 2026-08-31: `orchestratorDirect.get` / `.set` — the PRIVATE DIRECT lane's standing consent, same
  // machine-wide no-id shape, default OFF. It lets the operator's own external agent deliver a
  // private message into one of their own running agents. It is not a second launch toggle, cannot
  // direct a PEER's agent, and cannot make a directed turn post: the private-turn gate still holds
  // an outbound post for approval whatever this is set to.
  "orchestratorDirect.get",
  "orchestratorDirect.set",
  "orchestratorLaunch.get",
  "orchestratorLaunch.set",
  "passwordSignIn",
  "sendMagicLink",
  // 2026-08-22 (OQ-3): `sessions.approveIdentity` records THIS MACHINE's first-use approval of
  // ANOTHER member's identity. It starts nothing and grants nothing — it decides only whether a
  // foreign identity's TEXT may become an agent's role here, and a launch from an approved identity
  // is contained exactly like any other. The store is machine-local because a SERVER-writable
  // approval would let a credential-holding agent pre-approve itself across the fleet.
  // 2026-09-17 (Samuel's inline-approval ruling): `sessions.answerPermission` carries the operator's
  // Approve / Deny for ONE tool call this machine is HOLDING at the gate. The GATE already ruled
  // "hold and ask"; this only carries the answer to a resolver parked in THIS process. ALLOW-ONCE,
  // so it mints no standing grant, moves neither axis, starts no turn — and a `deny` VERDICT parks
  // no resolver at all, so a hard-denied tool cannot be made to run here. EXACTLY ONCE is proved by
  // the resolver map, not a flag: `session-permissions.js › resolvePerm` deletes as it answers.
  "sessions.answerPermission",
  "sessions.approveIdentity",
  // 2026-08-25 (Samuel's delete ruling): `sessions.delete` — a STOP VERB plus a LOCAL ERASE. A live
  // session ends through the SAME reducer event `sessions:end` dispatches (one stop path, never
  // two), then the local stores keyed to that agent are dropped. IT REACHES NO `channel_messages`:
  // the transcript keeps every message and keeps attributing it to `Agent #<id>`. `agentId` is
  // REQUIRED, uniquely on this namespace — every other op resolves an omitted id to the OLDEST live
  // agent, which for a destructive verb is a different agent than the card that was clicked.
  "sessions.delete",
  // 2026-08-27 (the composer's launch panel). `sessions.describe` is `sessions.rename`'s twin, field
  // for field: one machine-local string in `main/agent-names.js`. `sessions.mintAgentId` starts and
  // reserves nothing — eight CSPRNG characters from `main/agent-id.js`. ITS PRESENCE IS ALSO A
  // CAPABILITY GATE: the SPA reads it as "this build forwards a caller-supplied `agentId`", so
  // removing it does not merely lose an op, it silently re-enables the fill-in-after-launch fallback.
  "sessions.describe",
  // 2026-08-18 (wiring plan Phase 5): `sessions.pause` / `sessions.end` — sender-bound, UUID-gated
  // stop verbs dispatching the reducer events the session window's buttons already dispatched. The
  // failure direction of a forged call is an agent that STOPS. Own agents only, structurally: main's
  // registry holds nothing but this operator's sessions on this machine.
  "sessions.end",
  // 2026-08-22 (ended-agent ruling): `sessions.forgetThread` drops every LOCAL trace of a deleted
  // thread's ended agents. Main cannot see the server's delete cascade, so without a call from the
  // SPA an ended agent's history outlives its thread by up to seven days. It deletes no
  // `channel_messages` and cannot touch a LIVE session — the SPA ends those first.
  "sessions.forgetThread",
  // 2026-08-20: `sessions.launch` — attach MY OWN agent to a thread, windowless. appWindowOnly,
  // UUID-gated channel AND task. It DOES start a query, which is the feature: the same authority the
  // consent Allow exercises, here on the operator's OWN thread with no peer involved. Posture is
  // main's; the renderer hands over ids and display strings only.
  "sessions.launch",
  // 2026-08-20 (F-212's closure — the AGENT WINDOW). Reviewed separately, because they are not the
  // same shape as each other:
  //   `sessions.message` — THE ONE OP ON THIS BRIDGE THAT STARTS A TURN. UUID-gated channel, body
  //     capped in both layers (main's `MESSAGE_CAP` is the fence), empty-after-trim refused. It
  //     dispatches the EXISTING `steer` event through `session-reopen.js › messageByTask` on a
  //     session resolved against MAIN'S OWN registry, which makes it own-agents-only structurally.
  //     The text carries OPERATOR authority (`session-seed.js › frameOperatorTurn`) and is
  //     deliberately not fenced as data. It BYPASSES the inbound gate, correctly: Axis B governs
  //     counterparty turns, and this is the operator's own keyboard in a window main created.
  //   `sessions.openAgentWindow` — `threads.openWindow`'s twin, verbatim guards.
  //   `sessions.narration` / `.onNarration` — READ-ONLY, derived from in-memory state: no path, no
  //     token, no window handle, and explicitly no `inputFull`.
  "sessions.message",
  "sessions.mintAgentId",
  "sessions.narration",
  "sessions.onNarration",
  "sessions.onSummaries",
  "sessions.openAgentWindow",
  "sessions.pause",
  // 2026-08-25: `sessions.rename` is DISPLAY ONLY — `agent-id.js › isAgentId` gates the key and the
  // string lands in `main/agent-names.js`. It moves no session and never consults the registry, and
  // NOTHING RESOLVES AN AGENT BY IT, so a rename can never re-point a running instruction.
  "sessions.rename",
  "sessions.reopen",
  // 2026-08-20: `sessions.setMode`, the agent view's LIVE permission controls. The AXIS is two
  // literals, the MODE re-validates against `session-profiles.js`'s frozen enums, and the reducer
  // coerces AGAIN fail-closed via `coerceMode`. IT WIDENS SUPERVISION, NEVER CONTAINMENT: the
  // profile is checked first, `SESSION_HARD_DENY` is unconditional, and `bypass` is a POSITIVE
  // allow-list, so an unclassified tool gates in every mode. IT IS NOT THE DURABLE POSTURE and must
  // not be wired to it — this writes nothing, it moves one live session's reducer state.
  "sessions.setMode",
  // 2026-08-22 (model-selection ruling): `sessions.setModel`, the LIVE model switch. The value is
  // coerced against `session-model.js`'s frozen ID list at the boundary and converted to the
  // argv-safe ALIAS inside; `session-query.js › buildSdkOptions` coerces once more, as the last step
  // before it could become `--model` on a child process. An UNKNOWN VALUE CLEARS THE OVERRIDE rather
  // than being refused, so a forged string cannot pin a model, only un-pin one. It is not
  // `channels.setLaunchPosture`'s `model` field: this moves one running session and stores nothing.
  "sessions.setModel",
  "sessions.summaries",
  "signOut",
  "syncWatch",
  // 2026-08-18 (wiring plan Phase 10): `threads.openWindow`. UUID-gated channel, with the segment
  // and thread id through `deep-link-target.js › isSafeSegment`. IT ASKS FOR A WINDOW; IT DOES NOT
  // GET ONE — main creates it and registers it in `main/app-windows.js`, which is why widening the
  // sender binding is safe: the renderer cannot enlarge the set of bound senders, only ask main to.
  "threads.openWindow",
  // 2026-09-07 (Samuel: "Remove the turn/cost limit"): `turnCap.get` / `turnCap.set` are DELETED.
  // THIS LIST IS WHY THE DEFECT WAS FINDABLE: it went on asserting two bindings whose main-process
  // handlers had already been unregistered — the list agreeing with the preload while both
  // disagreed with main. A preload op with no handler REJECTS on invoke, which the SPA row's catch
  // rendered as "unset": a control showing a posture nothing enforced.
];
