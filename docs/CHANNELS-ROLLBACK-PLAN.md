# Channels rollback — named agents out, sessions in

Product direction set by Samuel, 2026-08-05, in conversation. This document is the
agreed SCOPE, written before any code moved, and it is left as written — it is the
record of what was agreed, not a status board.

> **Status, 2026-08-05.** Sequencing items **1-4 have landed**: F-140 (§3.4's stamp and
> the one initiating behaviour), F-141 (§1's rip-out), F-142 (§3.3's session pills),
> F-143 (§3.2's two composer pills). **Item 5 (§3.5's MCP ops: spawn-with-handoff,
> message-a-session, read-session-state) is next and is unstarted**; items 6-7
> (streaming, which unlocks §3.3's `thinking`, and `agent_presence`'s MEASURED
> retirement) follow it. `test/live/` is still deleted and unrebuilt (F-141).
>
> Where this document and the shipped code disagree, **`docs/ENGINEERING.md` §18 is the
> law and this is history** — each phase's rules live there under "PHASE N OF THE
> ROLLBACK", with the full story in the matching `F-14x` entry in
> `docs/REFACTOR-FINDINGS.md`. One deliberate departure of note: §3.2's chat slot ships
> as **"Message"** in the UI, while the wire value stays `chat`.

## The one-sentence version

Agents stop being **named entities that live inside a channel and get tagged**, and
become **sessions attached to threads** — visible as pills, addressable while running,
and spawnable on request. The main channel goes back to being a place where people
(and their external agents) talk.

## Why

The summon/tag/engage model was not useful in practice. It also carries three defects
that all evaporate with it rather than needing fixes (see "What this deletes").

---

## 1. What is removed

| Removed | Where it lives today |
|---|---|
| **Breakout rooms** — threads carrying their own participant set | `participants` on create_thread, `join_thread`, `leave_thread` |
| **Agent tagging** — `@handle`, addressing a named agent | `to_agent` / `to_agents`; `AddressPicker` in the channel composer; the `@` picker in the session composer (peer half) |
| **Summoning named agents** — cobalt, flint, onyx | `summon_agent`, `rename_agent`, `set_agent_status`, `disengage_agent`, the `agents` roster |
| **Engagement** — the ~1h "keep answering my untagged messages" window | `channel-engagement.js`, `engaged_at`, the local `acted` map |
| **The agent chips bar** — active/idle per named agent | `agent-chips-bar.tsx` |

**Method: rip out, not deprecate.** The `dopl_channel` ops are a public surface, but
Samuel and one peer are the only real users, so a polite deprecation window buys
nothing. Delete the ops; delete the UI; delete the tables/columns that only served them.

## 2. What this deletes (defects that stop being reachable)

These were found in the 2026-08-05 two-agent test and were queued as fixes. They are
**not fixes any more** — the surface they live on is going away:

- **Engagement dies silently on restart.** The "still engaged" state lived in an
  in-process map; a restart collapsed it to a stale server floor and untagged messages
  were dropped with no signal. No tagging → no engagement → gone.
- **Two machines disagree** about whether an agent is engaged. Same root. Gone.
- **The web chip shows Idle while the desktop works.** It read the server floor only.
  The chip itself is being replaced. Gone.

## 3. What replaces it

### 3.1 The main channel is for people and their external agents

- Messages there are **chat between the two members**, and between their **external
  agents** (Claude Desktop / Claude Code via MCP). Two people's Claude Desktops can hold
  a conversation through a channel with no Dopl session involved at all.
- **No Dopl session spawns from a plain channel message.**
- **The message/request distinction stays** — this is what makes a session appear:
  - `intent: "chat"` → addresses nobody, starts nobody.
  - `intent: "request"` (default) → triggers the peer's listener, pops a session window.
  - **This already exists and is already enforced server-side.** Only the UI changes.

### 3.2 Two pills, both inside the text input

Replacing slash/`@` syntax with something discoverable. Both sit inside the input bubble
on the right.

**Main channel composer — message ↔ request.** Defaults to message. The user flips it to
request when they want an agent session to start on the other side.

**Session pop-out composer — message *this session* ↔ message the peer.** Defaults to
"message `<session name>`", i.e. steering the window you are looking at. The dropdown
offers messaging the peer instead. This replaces the `@`-as-first-character picker;
nobody should have to discover the syntax.

### 3.3 Session pills replace agent chips

Per channel / DM (not global). Each launched session gets a friendly name from the
**existing generator** that produced cobalt / flint / onyx — they are still called
"agents" in the UI, because a session *is* an agent session.

States: **working** (running tools) · **thinking** · **idle** · **ended**.

Click a pill → dropdown → open it → land in the thread that session is working in.

> **Dependency (CORRECTED 2026-08-05, F-146 — the original wording was wrong and it
> propagated).** It said "thinking" requires streaming, which is currently off
> (`includePartialMessages: false`). That is not what blocks it. **The session window already
> ships a Thinking chip with no stream at all** — `renderer/session/session-chrome.js`
> `thinkingVisible` is "a turn is in flight AND the last transcript item is not agent output".
> What blocks the PILL is that the pill projects from `main/session-summary.js#pillState`,
> whose whole input is the reducer's `{ phase, activity, parked }` — three fields about what
> the session is DOING, none about what has been RENDERED for the current turn. A fourth pill
> state therefore needs that fact lifted into the reducer or a second source spliced into the
> projection; streaming would only buy a FINER signal (thinking vs. tool-running vs. drafting),
> not the binary one. "working" is available today.

### 3.4 One behaviour for initiating, not three

Today, what happens on the sender's machine depends on how the request was posted:

| Sender path | Today | After |
|---|---|---|
| A running desktop session posts it | full session (window + agent) | unchanged |
| The operator types it in the app | **shell** — window, agent NOT started | **full session** |
| An external MCP session posts it | **nothing** | full session, **on handoff** (see 3.5) |

The shell existed because the app's own UI posted without a trustworthy runtime stamp
(a leftover from when that UI ran in a browser), so the code could not distinguish the
operator from an external agent and opened something inert. **The app now controls that
renderer**, so it can stamp its own posts — and a user who deliberately flips the pill to
*request* has given clear intent. The distinction has no remaining justification and is
confusing. **Both start the agent.**

Fix direction: stamp the desktop UI's posts server-side from the credential. Do **not**
loosen the predicate.

### 3.5 MCP: handoff, steer, and spawn

`summon_agent` / `to_agent` are removed, but their *capabilities* are replaced:

- **Spawn with handoff.** "Spin up an agent on Dopl to talk to Anthony's agent about X"
  → create the thread → a session opens **on Samuel's machine** → that session carries
  the conversation. Today an external post opens nothing, deliberately: the code assumes
  the external session awaits the reply itself and *"a window would steal it."* The new op
  must declare ownership explicitly — **hand off** rather than keep it.
- **Message a running session.** Both directions: steer my own session, and message the
  peer's session.
- **Read session state.** So "what is flint doing?" from Claude Desktop answers
  "working, in the X thread." No op exists for this today.

### 3.6 Receiving is unchanged

Inbound request → consent card → **on Accept** a responder session adopts the window and
starts the agent. This gate is untouched. No agent runs on the receiver before approval.

---

## 4. Later, not now

**Select-to-start in the main channel.** Select messages → "Start agent session" → a
pop-out composer opens with those messages as the agent's opening context. This is the
intended replacement for `@agent` in the main view. Explicitly deferred.

---

## 5. Open question: the presence table

`agent_presence` heartbeats **every 30s per listener per workspace**, unconditionally,
and a prior audit identified it as the **quadratic always-on term** — the largest scaling
risk in the channels design (break points ≈26 concurrent at burst, ≈82 sustained).

Named agents were its reason for existing. Session pills need state on the server so MCP
can answer "what is flint doing," but a session changes state a handful of times in its
life versus 120 heartbeats/hour.

**Expected to be a net reduction in database load, not an increase.** To be measured, not
assumed, before promising it.

---

## 6. Sequencing (proposed)

1. **Stamp the desktop UI's posts** — unblocks 3.4 and removes the shell's justification.
2. **Rip out** tagging / summoning / engagement / breakout rooms, server + client + MCP.
3. **Session pills** with working/idle/ended (no "thinking" yet).
4. **The two pills** in the composers.
5. **MCP surface**: spawn-with-handoff, message-a-session, read-session-state.
6. **Streaming** → unlocks "thinking".
7. **Retire `agent_presence`** once pills carry the state; measure the delta.

Items 1–2 are the rollback. 3–5 are the replacement. 6–7 are follow-on.
