# GATE-BUG-REPORT — `mcp__dopl__dopl_channel` denied under tool mode `bypass`

**Date** 2026-09-15 · **Investigator** @agent-snrf11w2 · **Subject** @agent-fqv6bovk (session `8cc860b7`, channel `bb0f57db` "Dopl", ws `e7998a94`)
**Status** ROOT CAUSE FOUND. Nothing fixed. Three fixes proposed below, one of them a design call for Samuel.

---

## 0. TL;DR

1. **`bypass` never covered `dopl_channel` and was never supposed to.** The tool never runs on the TOOL axis. Every `dopl_channel` call is classified per-OP on the MESSAGE axis, and `rooms.list` / `rooms.open` are deliberately in no allow-lane, so they gate in *every* posture. The channel post that said `(tool mode bypass)` names a mode that did not decide anything — that copy is wrong, and it is what sent this investigation at the tool axis.
2. **There is no approval surface because none was ever built — and on this machine the one surface that exists was never shown.** A held tool gate on a windowless session has exactly ONE surface: a transient macOS notification banner. It writes **no server consent row** (deliberate, `session-windowless.js:20-27`), so no Inbox card, no thread send box, no Agents-tab control can render it. ⚠ **And the desktop running fqv6bovk is the repo's dev Electron (`com.github.Electron`), which is absent from all 81 registered notification clients in `com.apple.ncprefs`** — so the banner was almost certainly never displayed. On a dev build there is no tool-gate surface at all, in any posture. See §3(b).
3. **The queued message was not lost.** It was delivered into the session's input stream at 18:37:44 and sat there because the SDK child was blocked inside `canUseTool`. It drained at 18:41:27 when the second gate hit TTL. fqv6bovk is **not permanently wedged** — it self-unblocks one 10-minute TTL at a time.

---

## 1. The timeline (from `~/Library/Application Support/dopl-desktop/listener.log`)

```
18:20:08.774  launch-directive 61a101f0 launched agent fqv6bovk
18:20:16.409  session gate: dopl_channel op=read         allow auto-inbound-read  tool=bypass msg=auto_both session=8cc860b7
18:20:19.507  session gate: dopl_map                     allow tool-mode          tool=bypass msg=auto_both session=8cc860b7
18:20:43.892  session gate: dopl_channel op=rooms.list   gate  channel-op-approval-required tool=bypass msg=auto_both session=8cc860b7
18:20:43.906  windowless tool gated — operator notified mcp__dopl__dopl_channel req 3dd3af75
      ... 10 minutes, nothing to click ...
18:30:43.901  windowless tool gate expired unanswered mcp__dopl__dopl_channel req 3dd3af75
18:30:47.001  msg bb0f57db seq 1718 kind task_progress   <- "denied ... (tool mode bypass); further denials counted"
18:31:08.952  session gate: dopl_channel op=rooms.members allow auto-inbound-read
18:31:27.322  session gate: dopl_channel op=rooms.open   gate  channel-op-approval-required
18:31:27.326  windowless tool gated — operator notified mcp__dopl__dopl_channel req fd81003e
18:37:44.283  fan-out bb0f57db seq 1720 fed 1 of 3 verdict agent to:fqv6bovk   <- the operator message, DELIVERED
      ... still blocked; the fed message cannot be consumed ...
18:41:27.319  windowless tool gate expired unanswered mcp__dopl__dopl_channel req fd81003e
18:41:27.402  session gate: dopl_agent allow tool-mode ... session=8cc860b7     <- unblocks, resumes immediately
18:41:33..58  dopl_skill / dopl_ontology / dopl_kb / dopl_members / dopl_chats  all allow
```

Session↔agent identity confirmed from `config.json › sessionRecords["bb0f57db…::fqv6bovk"].sessionId = 8cc860b7-061c-414b-8538-00ac2190aa0f`, `model: opus`, `profile: full`, `taskId: ""` (main-room scope).

Launch posture **did reach the spawned session**: every line above carries `tool=bypass msg=auto_both`, and `18:39:51.821 channel-prefs posture bb0f57db bypass auto_both` re-applied it to 3 live sessions. **Hypothesis "the posture never arrived" is disproven.**

---

## 2. Root cause (1) — why `dopl_channel` gates under `bypass`

**`bypass` is an AXIS-A (tool) mode. `dopl_channel` is decided on AXIS B (messages), per op.** The two axes are separate by design (v2.9), and the log proves it: `dopl_map` allows with reason `tool-mode`, every `dopl_channel` call allows or gates with a *channel* reason (`auto-inbound-read`, `auto-outbound`, `auto-launch-own-machine`, `channel-op-approval-required`). No amount of tool-mode widening can allow a `dopl_channel` op.

The op allow-lanes:

| lane | file | members |
|---|---|---|
| read (Axis B inbound) | `main/session-profiles.js:135` | `read`, `status`, `rooms.threads`, `rooms.members` |
| outbound | `main/session-own-outbound.js:120,156-167` | `send`, `artifact.create/add/remove/dissolve` |
| launch | `main/session-own-launch.js` | `manage.launch` (both axes + depth bound) |
| **everything else** | — | **gates in every posture** |

`rooms.list` is excluded **on purpose**, argued at `session-profiles.js:127-130`: *"it enumerates EVERY channel and DM this account can reach, so it is not own-channel-scoped."* `rooms.open` is excluded because it writes. So both gates were correct-by-the-rules. **This is not a regression; it is the fail-safe firing.**

### 2a. The genuine defect in this half: the argument for excluding `rooms.list` no longer holds

`op="status"` **is** on the read allow-list (`session-profiles.js:135`) and `dopl_status` enumerates *"Each channel you are in — any workspace, any home channel"* — a strictly **wider** enumeration than `rooms.list`, which is scoped to one workspace. A windowless agent under `auto_inbound` can already enumerate everything `rooms.list` would show, with no prompt. Gating the narrower op while auto-allowing the wider one buys zero confinement and costs a 10-minute auto-deny on a call the MCP surface itself advertises as the discovery entry point.

### 2b. The other genuine defect: the denial copy names the wrong axis

`main/session-windowless.js:239` reads the TOOL mode and `:247` writes it into the channel post:

```js
const mode = (s.state && s.state.toolMode) || 'manual';
… `denied ${tool} (tool mode ${mode}); further denials counted`
```

For a call refused on Axis B this says *"denied under tool mode bypass"*, which reads as "bypass is broken". The real reason code was already computed and is already on the payload — `main/session-gate-bridge.js:119` (`payload.gateReason = verdict.reason`, here `channel-op-approval-required`). The file's own comment at `:218-221` says *"IT SAYS THE MODE, BECAUSE THE MODE IS THE REMEDY"* — and for this class the mode is **not** the remedy, which is exactly why the line misled.

---

## 3. Root cause (2) — "waiting on you" with nothing to click

**Two independent causes, both live.**

**(a) The only surface is a transient OS banner, with no durable fallback.**
`session-windowless.js:260-308 › bridgeToolGate` builds a macOS notification with an **Allow** button and starts a `TOOL_GATE_TTL_MS = 10 * 60_000` timer (`:172`). That is the entire decision surface. The file states the design at `:20-27`: *"LOCAL, deliberately: no server row."* Outbound posts get a `channel_consent_requests` row (`bridgeOutbound`, `:385`) which the thread send box and the Inbox render; **tool gates get none**, so there is nothing for any in-app surface to draw. Dismiss decides nothing (`notify-action.js:20-22`) and the banner auto-dismisses to Notification Center within seconds. Operator's report — "nothing to click anywhere" — is the designed behaviour once the banner scrolls away.

**(b) `Notification.isSupported()` is a platform check, not an authorization check — and on THIS machine it was wrong. ⚠ REVISED 2026-09-15, post-publication.**
`main/notify-action.js:44`. On macOS it returns `true` even when the app has no notification authorization at all. So `bridgeToolGate` takes the "asked" branch, logs `operator notified`, arms the TTL — and if nothing is delivered, **nobody was asked**, while the code has already decided this is not the no-surface case (`:281-290`) and skipped both the honest denial copy and the `notifyDenied` local notice.

The first pass of this report filed that as *latent*. It is not. The desktop that ran fqv6bovk is the **dev Electron out of this repo**, not the installed app:

```
ps:  /Users/samuelwang/Downloads/setup-intelligence-engine/dopl-desktop-app/node_modules/electron/dist/Electron.app/…
     (pid 44105, started 01:34AM — the process that launched fqv6bovk)
Info.plist › CFBundleIdentifier = com.github.Electron
```

`com.apple.ncprefs` holds 81 registered notification clients. `com.github.Electron` is **not one of them**. The only Dopl-related entry is `com.dopl.connect` → `/Applications/Dopl.app`, which is a different binary and was not the one running. macOS registers a client on its first delivery attempt, so an app absent from ncprefs has never successfully shown a notification.

**Therefore the banner for `3dd3af75` and `fd81003e` was almost certainly never displayed at all.** Not missed — never shown. `~/Library/DoNotDisturb/DB/Assertions.json` shows no active Focus assertion, which rules out suppression and leaves non-registration as the explanation. That makes (b) the **primary** cause of "nothing to click anywhere" on this run, with (a) — no durable fallback — the reason it was unrecoverable rather than merely late.

⚠ **Scope of this correction:** anyone running the desktop from `npm start` / the repo's dev Electron has **no tool-gate surface whatsoever**, in any posture. Every held gate on a dev build dies at the 10-minute TTL with the operator never asked. A packaged `/Applications/Dopl.app` is registered (`auth=7`) and does get banners, so this is worst on exactly the machine that does the development.

One check would settle it beyond inference: trigger any gated call on the dev build and watch for a banner. If none appears, confirmed.

**(c) And the pill lies once any message arrives.**
`main/session-detail.js:124` maps `activity === 'awaiting_permission'` → detail `permission` → `"Waiting on you"` (`src/features/channels/components/agents-model.ts:353`). But `main/session-reducer.js:284`:

```js
if (inboundAutoAccepted(state)) {
  return { state: clone(state, { phase: 'running', activity: 'working', parked: false }), … };
}
```

An inbound message overwrites `awaiting_permission` with `working` **without consulting `state.pendingPermissions`**. The correct idiom is four lines away at `:194-197`, which does consult it. Result: at 18:37:44, seq 1720 flipped fqv6bovk's card from "Waiting on you" to "Working" while gate `fd81003e` was still held — the state the operator needed to see was erased by an unrelated event, which is why the card and the reality disagreed.

---

## 4. Root cause (3) — why the queued operator message never processed

Not a separate bug and **nothing was dropped**. `fan-out … seq 1720 fed 1 of 3 … to:fqv6bovk` means `session-gate.enqueue` returned true and, under `msg=auto_both`, `autoInbound` was true so it dispatched straight into the session's push iterator (`session-io.js:46-52`, `:73+`). The SDK child cannot begin a new turn while a `canUseTool` call is outstanding, so the message sat in the stream from 18:37:44 until the gate died at 18:41:27 — after which the session resumed within 80 ms and ran six more tool calls. **Latency, not loss; bounded by `TOOL_GATE_TTL_MS`.** Anything sent to an agent sitting on a held gate is invisible to it for up to 10 minutes.

---

## 5. Proposed fixes — NOT APPLIED

### FIX 1 (one line, obvious, recommended) — stop the denial post from blaming the tool axis
`main/session-windowless.js`

```diff
@@ function announceDenial(s, tool)
-function announceDenial(s, tool) {
+function announceDenial(s, tool, gateReason) {
   try {
     if (!s || !s.channelId) return;
-    const mode = (s.state && s.state.toolMode) || 'manual';
+    // ⚠ THE REASON, NOT THE MODE. A dopl_channel op is decided on AXIS B; naming the TOOL
+    // mode for one of those reads as "bypass is broken" and sends the operator to widen a
+    // posture that never decided the call. `gateReason` is already on the payload
+    // (session-gate-bridge.js:119); the tool mode stays the remedy only when it IS the reason.
+    const why = gateReason || `tool mode ${(s.state && s.state.toolMode) || 'manual'}`;
@@
-      `denied ${tool} (tool mode ${mode}); further denials counted`,
+      `denied ${tool} (${why}); further denials counted`,
```
…with `recordDenial(s, tool)` → `recordDenial(s, tool, payload.gateReason)` at `:288` and `:304`, and the same third argument threaded through `recordDenial` at `:256-258`.

### FIX 2 (one line, needs Samuel's nod because it widens an allow-list) — admit `rooms.list`
`main/session-profiles.js:135`

```diff
-const OWN_CHANNEL_READ_OPS = ['read', 'status', 'rooms.threads', 'rooms.members'];
+const OWN_CHANNEL_READ_OPS = ['read', 'status', 'rooms.threads', 'rooms.members', 'rooms.list'];
```
Argument, to be written into the block at `:127-130` if taken: `status` is already on this list and enumerates every channel in every workspace *and* every home channel — strictly more than `rooms.list`, which is one workspace. The exclusion confines nothing and costs a 10-minute auto-deny on the op the tool's own prose calls the discovery entry point. `rooms.open` / `rooms.invite` / `rooms.thread_mode` / `rooms.update` stay out — they write.
**If Samuel prefers the narrow answer instead**: leave the list alone and make the MCP `rooms` description say that `action="list"` gates on a desktop-run session, so an agent does not spend 10 minutes learning it.

### FIX 3 (NOT one line — design, for Samuel) — a durable surface for a held tool gate
The banner is the only thing that can answer a tool gate, and a banner is not a surface you can go back to. Two shapes, both real work:
- **(a) Give it a row.** `consent.createConsentRequest(kind: 'tool')` the way `bridgeOutbound` does, and render it in the Inbox / thread. Cost: the file's own argument at `:20-27` against it — a tool grant is a fact about THIS machine and must not be writable by anything holding the operator's Dopl credential. Any row-based version has to answer that.
- **(b) Keep it local, give it a list.** A "pending approvals" strip in the Agents tab fed from `s.pendingPermissions` over the existing IPC. No server row, so the `:20-27` argument survives intact. Smaller and, on that basis, the one I would build.

Either way, sub-fix **3c** is independent and cheap — `main/session-reducer.js:284`:
```diff
-      return { state: clone(state, { phase: 'running', activity: 'working', parked: false }), effects: feedInboundEffects(state, event) };
+      // ⚠ A HELD PERMISSION OUTRANKS AN INBOUND. `working` here erases the one signal the
+      // operator has that a decision is waiting (session-detail.js:124 → "Waiting on you"),
+      // and the agent cannot consume this message until that gate resolves anyway. Same
+      // question `:194-197` already asks.
+      const held = Array.isArray(state.pendingPermissions) && state.pendingPermissions.length > 0;
+      return { state: clone(state, { phase: held ? 'awaiting_permission' : 'running', activity: held ? 'awaiting_permission' : 'working', parked: false }), effects: feedInboundEffects(state, event) };
```
(Check `pendingPermissions`' shape on the reducer state before taking this verbatim — the engine holds a Map on the session object; `:194` reads a `nextPending` array.)

### FIX 4 (⚠ PROMOTED — this is the live one on a dev build)
`main/notify-action.js:44` — `Notification.isSupported()` does not tell you whether this app may actually deliver a notification, and the dev Electron binary cannot (§3b). Anywhere a notification is **load-bearing** — this gate is the only place it is — that check is insufficient, and the "true no-surface" branch at `session-windowless.js:281`, which exists precisely for this case, can never fire on macOS.

Two ways out, in order of honesty:
- **Best: FIX 3 makes it moot** by removing the load-bearing-ness. A durable in-app list works whether or not a banner lands. This is the argument for doing FIX 3 *now* rather than scoping it later.
- **Interim, small:** treat a notification that cannot be confirmed as the no-surface case on dev builds — gate the "asked" branch on something stronger than `isSupported()` (bundle-id registration, or a first-run probe cached per process). Failing to the `:281` branch means an immediate, honestly-worded deny instead of ten minutes of silence, which is the better failure.

Either way, **do not relaunch a prober against a dev build expecting a gate to be answerable** — no gated call can be approved there.

---

## 6. What this means for fqv6bovk right now

It is **not** hung. It is alive and self-unblocking on 10-minute TTLs; last tool call 18:41:58. Its logs are pulled and quoted above — nothing further is needed from it as live evidence. Safe to end and relaunch.
