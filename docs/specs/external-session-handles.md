# Giving an external session an address — options

**DESIGN ONLY. Nothing in this document is built.** Written 2026-09-18 alongside the
addressing wave (`fix/channel-addressing`), which made `to=` the only way an agent reaches an
agent. That change sharpened a gap it did not create, and this is the options paper for it.

## In plain language (for a non-technical reader)

- Agents inside Dopl have names, so other agents can say "this one is for you".
- A Claude Code session on your laptop, waiting on a Dopl channel, does **not** have a name.
- So an agent that wants to reach it has to address **you** instead.
- Addressing you wakes your machine, which may start a *different* agent to answer.
- The message still arrives at the waiting session, but something else may answer first.
- The fix is to let a waiting session claim a name while it waits, and give it up when it stops.
- Three ways to do that are below; the recommended one is about two days of work.
- Nothing changes until you pick one.

## The gap, precisely

An **external MCP session** is a Claude Code (or Codex / Cursor) run holding
`dopl_channel(op="read", wait_ms=…)`, authenticated with the operator's device token. Three
facts about it, each verifiable today:

1. **It has no handle.** Agent handles are built from `channel_sessions` rows
   (`server/service-wake-verdict-handles.ts › resolveAgentRecipients` →
   `lib/agent-mentions.ts › buildAgentMentionIndex`), and that projection is pushed by the
   DESKTOP for the sessions it runs (`main/session-state-push.js`). An external session pushes
   nothing, so no handle names it and `to=@anything` resolving to it is impossible.
2. **Its runtime is unstamped.** `CallerIdentity.runtime` is an OBSERVATION, and "no stamp" is
   deliberately not "external" (`tools/channel-wake-guidance.ts`) — an older desktop build looks
   the same. So the server cannot infer the class either.
3. **So the only address it has is its operator.** An in-channel agent must send
   `to=<user id>`, which is a MEMBER verdict: the operator's listener fires, and their machine
   decides what runs — which can be a responder agent that answers before, or instead of, the
   waiting session.

⚠ **The message is not lost.** The hold returns it like any other message, because a hold reads
the transcript rather than a mailbox. What is wrong is the *addressing*: the sender has to name a
person to reach a machine, and naming a person is a request for that person's agents.

## Option A — a session registers a named presence when it arms a hold

`dopl_channel(op="read", wait_ms=…, as="<name>")` writes a `channel_sessions` row for the
duration of the hold, with a new `origin` column marking it external. The row mints a handle
through the existing index, so `to=@<name>` resolves to it like any other agent — and because
the row is external, the desktop's listener has nothing to feed and starts nothing.

- **Delivery:** the sender addresses the session directly; `recipient_agent_ids` carries its id;
  the operator's listener is not triggered at all.
- **Lifetime:** the row is written on arm and cleared when the hold returns or expires; a crashed
  session leaves a stale row, which the existing freshness rule already covers for REFUSAL
  (`F-418`'s asymmetry) but not for resolution — so a TTL sweep is part of the work.
- **Cost:** the `as=` argument (one field on a budgeted schema), an `origin` column plus its
  migration, arm/clear on the hold path, the desktop's dispatch teaching it to skip external
  rows, and a stale-row sweep. **Roughly 2 days**, most of it in the lifetime rules rather than
  the happy path.
- **Against it:** it puts a WRITE on the read path. A hold is currently the cheapest call on the
  surface and this makes it a write plus a write on return.

## Option B — the operator names a standing external handle in the app

The operator declares, once, in the desktop UI: *"`@laptop` is my Claude Code session."* The
handle is stored on the membership row and resolves for as long as it exists, whether or not
anything is holding. A send to it stamps the recipient and starts nothing locally; a session that
is not holding simply reads it when it next looks.

- **For it:** no change to the hold path at all, and the handle is stable across sessions — an
  orchestrator can write `to=@laptop` into a plan and have it keep working next week.
- **Against it:** the handle can be a **lie**. Nothing verifies anybody is there, so `delivery=`
  reports a reach that may be into an empty room, which is exactly the invisible-delivery failure
  the `to=` refusal exists to prevent. It also needs a UI surface.
- **Cost:** a column, a settings row and the resolver arm. **Roughly 1.5 days**, but it buys a
  weaker guarantee than A.

## Option C — leave `to=<operator>` and make the operator's side quieter

No new address. Instead, a message addressed to an operator who has a live external hold is
marked so that the desktop does **not** start a responder for it — the hold is treated as the
answer. The sender's vocabulary does not change.

- **For it:** smallest change, no schema and no migration; it fixes the *symptom* Samuel named
  (something else answers).
- **Against it:** the sender still cannot say who it meant, so a room with an operator, two
  desktop agents and a laptop session has three addressees and two names. It also needs the
  server to know a hold is live, which is Option A's projection row by another route — so it
  mostly *defers* A rather than replacing it.
- **Cost:** **Roughly 1 day**, and it is a step toward A rather than an alternative to it.

## Recommendation

**Option A**, with one amendment: make `as=` **optional** and default to no presence at all, so
today's holds are byte-identical and the cost is paid only by a session that wants an address.

The reason is the one this wave is built on: an address must be something the sender can *say*
and the system can *check*. A names the session and proves it is there (the row exists only while
the hold does); B names it and proves nothing; C proves it and lets nobody say it.

⚠ **The risk to design out before building A is the stale row**, not the happy path. A handle
that resolves to a session which died three hours ago is worse than no handle, because
`delivery=woken` would be reported for it. The rule should be that an external presence resolves
only while its hold is live, and that an expired one answers the same refusal a misspelled handle
does — with the live handles listed.

## Open question for Samuel

Should an external handle be visible to **other members** of the channel, or only to the
operator's own agents? A's row would make it channel-wide by default, which matches how a
desktop agent's handle already works — but a laptop session is a more personal thing than an
agent launched into a shared room, and the answer changes the projection's fence.
