# The `ping` primitive — "Needs you"

**Status:** design, written 2026-09-01, ahead of the code in the same branch.
**Problem.** When an agent finishes, has a question, or is blocked, nothing reaches the person or
the external session that has to act. A channel post is the wrong instrument: THE LOOP BRAKE means
an agent-authored unaddressed post starts nobody, and an addressed one fans out to a room. So an
escalation card can sit unread for twenty minutes with no signal anywhere. There is no
**out-of-band, one-recipient, cheap-to-watch** signal.

## 1. The primitive

A **PING** is one row: *this agent, on this channel/thread, has one of three things to say to
exactly one recipient.* It is not a chat message and never becomes one.

```
kind      done | question | blocked          (closed set, three statements: column CHECK, closedEnum, TS tuple)
body      1..600 chars                        (a line, not a report — the thread holds the report)
to        one of three recipient forms, below
```

**Three recipient forms, one stored shape.** `recipient_kind ∈ member | agent | desktop`, plus
`recipient_user_id` (always stamped or resolved) and `recipient_agent_id` (set iff `agent`).

| MCP arg | `recipient_kind` | `recipient_user_id` | means |
| --- | --- | --- | --- |
| `to="<member>"` | `member` | the resolved member | a person on this channel |
| `to_desktop=true` | `desktop` | **stamped `ctx.userId`** | *my* operator's external Desktop Agent |
| `agent_id="<handle>"` | `agent` | **stamped `ctx.userId`** | one of *my* operator's own running agents |

> ⚠ **The ticket asked for a param literally named `to_agent`. It cannot exist.**
> `channel-addressing-rule.test.ts` asserts `CHANNEL_INPUT_SHAPE` has no `to_agent` property, and
> `channel-law.test.ts › REMOVED_VOCABULARY` bans the *string* `/to_agents?\b/` from every shipped
> literal in the `channel-*` group — both are residue-fences from the named-agent rollback. The
> capability is delivered on the existing `agent_id` param, which is already how `direct_agent`
> addresses one of the operator's own agents. Same meaning, permitted spelling.

**The loop brake is reused, not re-stated.** `direct_agent`'s whole authorization story is *the
operator is `ctx.userId` and there is no request field that could say otherwise.* A ping keeps it
for the two self-scoped forms: `agent` and `desktop` stamp `ctx.userId` and take no operator
argument, so **an agent can never ping another member's agent** — there is nothing to say it with.
The `member` form is the one that names someone else, and it is fenced the way a post is: sender
must be a **member** of the channel (`loadVisibleChannel` + `membership !== null` — membership, not
readability, so a public channel does not widen it) and the recipient must be a member too.
Self-`to=` is refused, naming `to_desktop=true` as the instrument.

## 2. Why its own table, not a column on `channel_messages`

`escalate` rides `kind:'message'` metadata, and that was right for it: an escalation is *public in
the transcript* and its answer comes back as a message. A ping is the opposite on every axis, and
the axes are the ones `channel_agent_directions` already argued:

- **It must not fan out.** A `channel_messages` row is read by every channel member and classified
  by every listener. "Targets one recipient" is not expressible there.
- **It must not end a channel `await`.** A ping has no `channel_messages.seq`, so by construction it
  cannot consume or advance the message cursor — the property directions were given a table for.
- **It needs its own cursor.** `/api/pings/await?since=` is watched by an external session that is
  *not* reading the channel; sharing `seq` would make one stream's progress silently skip the other.

So: **`channel_pings`**, `channel_agent_directions`' shape — `seq BIGINT GENERATED ALWAYS AS
IDENTITY` (`channel_messages.seq`'s own idiom) as the cursor, service-role writes only, RLS SELECT
mirroring channel membership *and* narrowing to the two parties:

```sql
is_current_workspace_member(workspace_id, 'viewer')
AND is_channel_member(channel_id)
AND (recipient_user_id = auth.uid() OR sender_user_id = auth.uid())
```

Membership alone would publish every ping to the room, which is the property the table exists to
avoid; the party clause alone would leak past a channel the reader left. A `deleted_at IS NULL`
guard on the channel joins them (2026-09-02): a membership row outlives a soft-delete tombstone,
so without it a ping outlives the room it is about.

## 3. Delivery — three paths over one row, no second producer

**(a) The external Desktop Agent: `GET /api/pings/await?since=`.** One cheap held request instead of
N per-channel polls. It reuses `withWorkspaceAuth` (no `sessionOnly` — the caller is a `dopl_at_*`
device token, `agent-directions/claim`'s ruling), `parseQuery`, the four `AWAIT_*` constants in
`features/channels/constants.ts`, the `runtime`/`dynamic`/`maxDuration = 60` triple, and the
`{ items, timedOut: items.length === 0 }` response contract. What it does **not** share is the ~12
line hold body: `service-await.ts` and `service-await-workspace.ts` both state, in bold, that a
"channel or workspace mode" behind one signature puts two authorization stories behind one fence,
and a ping's fence is a third (`recipient_user_id = ctx.userId` AND the proven channel-membership
set). ⚠ **CORRECTED 2026-09-02 (R1).** This paragraph used to say the loop was short because "the
fence *is* the SQL predicate, so there is no access re-proof cadence to run". That was only true of
the party half. The RLS policy above is `is_channel_member(channel_id) AND (party)`, and the REST
lane runs on the admin client — so party-only there made the two lanes disagree for exactly the
caller a removal is about. The hold now proves membership at tick 0 and every
`AWAIT_REVALIDATE_EVERY_TICKS` after, and both the probe and the row read carry the proven set. The
assembled multi-poll budget on the MCP side is genuinely shared: `channel-await-budget.ts`, imported.

**(b) The local watcher: one `listener.log` line, zero tokens.** The desktop already holds one
realtime socket per workspace; `channel_pings` chains onto it exactly as `channel_agent_directions`
does (`realtime-mailboxes.js › applyBindings`). On an inbound ping addressed to this operator the
desktop writes, through the one logger (`diag()`), beside its existing `fan-out` / `msg` lines:

```
ping <chan8> seq <N> to=<recipient8> kind=<done|question|blocked>
```

A local external agent arms a wake on it with `tail -F` in a background shell task — the same
turn-ending trick `scripts/dopl-channel-wait.sh` documents, but free.

**(c) The inbox read: `dopl_channel(op="pings", since=)`.** Terse rows over `GET /api/pings`, so an
agent that missed a hold can catch up without replaying channels.

**(d) Waking a LOCAL agent session** — when `recipient_kind = 'agent'`. **No second wake mechanism.**
The desktop resolves the agent's `(channelId, taskId, agentId)` slot from
`sessionEngine.listLiveSessions()` and calls `sessionEngine.feedInbound({..., addressing: { me:
true }, wake: true })` — the identical belt the `@agent-<id>` fan-out door terminates in. If no live
session holds that handle, nothing happens and the row stands as the record; the ping is still in
the operator's inbox.

## 4. The UI card

A **"Needs you"** section on the workspace Overview page — `recent-activity.tsx`'s idiom (`bento`
section, uppercase `text-label` heading, `divide-y` list, `"Nothing yet."` empty state), token
classes only, no new dependency, no new route (a new top-level page is a three-file hand-copied
change across `routes.tsx`, the sidebar and `deep-link-target.js`; this earns none of it yet).

Each row: the kind chip (`done` / `question` / `blocked`), the sending agent's handle, the channel,
a relative age, and two one-click actions — **Open thread** (a `RouterLink` to
`#/<segment>/channels/<id>?thread=<taskId>`, i.e. the existing deep link) and **Send to Desktop
Agent**, which re-emits the ping with `to_desktop=true` through `useApiMutation`, quoting the
original. That second button is the whole point: it is how a human hands a signal to the external
session without typing.

## 5. How it composes with what exists

- **`to=` addressing** is unchanged. A post's `to=` triggers a member's *machine*; a ping's `to=`
  files a signal in their *inbox*. Different instruments, and the ping never posts.
- **`@agent-<id>` wakes** are unchanged and are what path (d) reuses. A ping adds no fourth
  addressing door to `session-dispatch.js`.
- **Threads** are a nullable `thread_id` (`ON DELETE SET NULL`, the launch/direction rule), so a ping
  points at the work without owning its lifetime.
- **`dopl_status` / wake-ack** are untouched: a ping is not a session state change and reports none.
  The footer already tells a caller who it is; the ping row's `sender_agent_id` is derived
  server-side from `X-Dopl-Session-Id` as a **caption only** — `service-directions.ts ›
  senderAgentIdFrom`'s rule, nothing gates, routes, filters or authorizes on it.
- **`escalate` stays the instrument for "a human must choose between options."** A ping is the
  instrument for "someone should look." An escalation that also wants to be *noticed* sends a
  `question` ping beside it; the two do not merge.

## 6. Minimal-first — what is deliberately NOT in v1

1. **No ack / dismiss.** No `read_at`, no write policy beyond insert. The inbox is a recent window
   (24h, newest first, capped) and *Open thread* is the resolution gesture. An ack column plus a
   PATCH route is the first extension, and it is additive.
2. **No `SYNC_TABLES` entry.** The SPA panel refetches on mount and after its own mutation. Live SPA
   push is additive once the table is published (it already will be, for the desktop mailbox).
3. **No new consent toggle.** A ping starts no process and opens no private turn, so
   `orchestrator-consent`'s two flags do not apply; path (d) reaches only sessions on the operator's
   own machine, which the operator already launched.
4. **No expiry, no cron.** Rows are the record, like directions.
5. **No badge / tray count.** Named as the obvious next step once the card proves the shape.
