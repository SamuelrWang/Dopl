# AUTO-ADDRESS-TRACE — why "last addressed agent" keeps getting stomped by agent posts

**Round 4 on this bug.** Mandate was *why it keeps coming back*, not a patch. Answer up front,
then the table, the archaeology, and the fix.

> **STATUS: FIXED 2026-09-15, filed as F-704** (`docs/REFACTOR-FINDINGS.md`). This document was
> written as report-only; Samuel then gave the go and F1-F4 below were implemented **exactly as
> proposed**, with two additions the proposal did not foresee:
>
> - a **legacy-row degrade** case, pinning that an absent `author_kind` still counts as the
>   author's own tag (the predicate is `=== "agent"`, never `!== "user"`);
> - the parity case lives in a **new file**, `draft-reach-parity-author-kind.test.ts`, because
>   `draft-reach-parity.test.ts` sat exactly at the 500-line cap (ENGINEERING.md §2);
> - and the query shape got its own suite, `server/repository-messages-recent.test.ts`, so the
>   projection cannot silently drop `author_kind` and make the bug inexpressible again.
>
> Each new case was verified to **fail with the one-line predicate removed** and pass with it.
> Gates: channels suite 207 files / 3113 tests green, root `tsc --noEmit` exit 0, eslint clean on
> every changed file.
>
> ### ⚠ AND THERE WAS A SECOND CAUSE — F-705, fixed the same day
>
> Samuel reported the symptom again **~24 minutes after this fix went live**, which was verified
> live in both halves (the dev server's compiled send route and the running vite server each
> carried the predicate), so staleness was ruled out. The remaining mover was **not a writer this
> document missed** — it was RR3's *tertiary arm*: when none of the agents he had addressed was
> still live, the room answered **whichever session launched last**, a target he never chose that
> re-pointed itself every time any agent launched or ended.
>
> **Two independent defects wearing one complaint**, which is exactly why three earlier rounds
> and this one each "fixed it" and it kept coming back:
> - **F-704** (this document) — arm 3's *evidence*: an agent's tag counted as its operator's.
> - **F-705** — the tertiary arm's *answer*: a launch-order guess where there should have been
>   none.
>
> Samuel's ruling: **when the last-tagged agent has ended, the fallback answers NOBODY** —
> auto-address resets to none-selected until he tags someone new. A deliberate narrowing of B1
> ("a forgotten `@` must never stall"), on the grounds that a guess which wanders is worse than a
> stall. Arms 2 and 3 are untouched, so a one-agent room still auto-answers. See `F-705` in
> `docs/REFACTOR-FINDINGS.md` for the full record, including the orchestrator-based fallback that
> was built, proven green and then discarded on product grounds — *"orchestrator" is one
> operator's setup, and this rule ships to every user.*

---

## The answer in one paragraph

There is **no stored "last addressed agent" anywhere** — no column, no desktop pref, no cache.
The value is **re-derived on every unaddressed post** by walking `channel_messages` for rows
this *user id* authored that carry a typed agent tag. The one field that distinguishes *Samuel
typed a tag* from *Samuel's agent typed a tag* is `author_kind`, and **the walk never reads it,
at any layer**: the SQL projection does not select it, the row type does not declare it, and the
predicate does not test it. Every one of Samuel's agents posts under **his own `author_user_id`**
(`service-writes.ts:252-253`), so an agent addressing another agent writes a row that is
**bit-for-bit indistinguishable, on the only field the rule filters, from Samuel addressing that
agent himself**. That is the whole bug. It keeps coming back because each of the three prior
fixes changed *which rows the arm selects* and never added the predicate *the author must be a
human* — and because the test fixtures cannot even represent an agent-authored history row, so
every regression test written for those fixes was blind to this case by construction.

---

## (1) Every writer and reader of auto-address / default-recipient state

### There is no state to write. Correct the mental model first.

`channel_members.unaddressed_responder` (migration `20260928130000`) stores only a **rule**,
two values, `'last_addressed' | 'none'`. The migration says so deliberately — *"IT IS A RULE
NOW, NOT A NAME"* — because agent ids are minted per launch and a stored handle decays. So the
**identity of the last-addressed agent is never persisted**; it is recomputed per post.

That means the de facto **writers** are not setters. A writer is **any INSERT into
`channel_messages` that lands a row matching the walk's predicate**:

> `author_user_id = <the person>` AND `recipient_agent_ids` non-empty AND `metadata.wake_reason`
> absent AND `metadata.taskId` absent (main room).

| # | Writer (the event that lands a qualifying row) | Path | Intended? |
|---|---|---|---|
| W1 | Samuel types `@prime` in the composer and sends | `service-writes.ts:252-253` insert; `recipient_agent_ids` from the mention parse, no `wake_reason` | ✅ yes — this *is* the feature |
| W2 | Samuel's MCP/desktop agent posts with a typed `@agent-...` or `to=` | same insert, `author_kind:'agent'` but **`author_user_id: ctx.userId` = Samuel** | ❌ **THE BUG** |
| W3 | Server's own RR3 pick on Samuel's untagged post | same insert, but `wake_reason` stamped (`service-writes.ts:243`) | ✅ excluded on purpose — `wake_reason` present ⇒ not evidence (stops self-reinforcing drift) |
| W4 | Threaded posts | same insert with `metadata.taskId` | ✅ excluded — `.is("metadata->>taskId", null)` |

W2 is the only unintended writer, and it is unintended **everywhere**, because W1 and W2 differ
only on `author_kind`.

### Readers — one rule, two trees, both bitten

| # | Reader | Location | Reads `author_kind`? |
|---|---|---|---|
| R1 | **The SQL feed** — 50 newest main-room rows by this user | `server/repository-messages-recent.ts:95-110`; projection line 102, filter `.eq("author_user_id", authorUserId)` line 104 | **NO.** And the docblock at **lines 70-71 states the omission as a feature**: *"`author_user_id`, NOT `author_kind`. The old read filtered to agent authors; this one filters to ONE PERSON."* |
| R2 | **The shared rule** — "which agents has this author addressed" | `lib/agent-post-stamp.ts:228-264`. Row type lines 231-237 **has no `authorKind` field at all**; filter at line 250 is `row.authorUserId !== authorUserId` | **NO — it cannot.** The field is absent from the type. |
| R3 | **The evidence predicate** | `lib/agent-post-stamp.ts:143-150` `isAuthorTypedAgentTag` — recipients present + `wake_reason` absent | **NO.** Its own docblock (line 137) says *"**Evidence must be the human's own act**"* — the sentence the code does not implement. |
| R4 | **Server arm 3** | `server/service-wake-verdict-resilience.ts:422-435` `recentRoomAgents` → maps R1's rows into R2; maps `seq`, `createdAt`, `authorUserId`, `recipientAgentIds`, `metadata` — no kind | **NO** |
| R5 | **Server resolver** | `lib/agent-mentions-responder.ts:136-180`; arm 3 loop line 176 returns the first id that is still live, `reason:"most recent"` | n/a (takes an id list) |
| R6 | **Client composer feed** | `components/derivations.ts:281-284` `recentAgentsAddressedBy(currentUserId, messages)` over the rendered transcript | **NO** — and the DTO rows it passes *do* carry `authorKind` (`server/dto.ts:174`), so the client is one field away and never asks |
| R7 | **Client recipient line** | `lib/draft-recipients.ts:328` → same `resolveDefaultResponder` | n/a |

Two independent surfaces, one shared rule, **identically blind** — which is why the parity suite
is green: both halves agree, and both are wrong the same way.

### Confirmed NOT writers or readers (checked, so round 5 does not re-check)

- **Desktop routing gate / main process** — `dopl-desktop-app/main/` has **no** last-addressed,
  auto-address or default-recipient state. `session-private.js`, `channel-prefs.js`,
  `channel-dir-ipc.js` matched only on unrelated substrings. The desktop executes the server's
  **stored** verdict (`0e53a140`); it does not compute one.
- **MCP server tree** — no third spelling of the rule.
- **`channels.default_responder_agent_name`** — retired 2026-09-06, read by nothing.
- **`"(only agent)"` resolution** — `agent-mentions-responder.ts:177`, arm 2. Fires only when
  the room holds exactly one live agent; it never consults history and cannot be stomped.

---

## (2) The repro, traced line by line

Channel `bb0f57db`. Samuel addresses Prime (`c65ym2fl`); Prime posts to `k2k2q9fh`; Samuel's
next untagged message routes to `k2k2q9fh`.

1. **seq N** — Samuel: `@prime ...` → row `{author_user_id: SAMUEL, author_kind:'user',
   recipient_agent_ids:['c65ym2fl'], no wake_reason}`.
2. **seq N+1** — Prime posts to `k2k2q9fh` → row `{author_user_id: SAMUEL, author_kind:'agent',
   recipient_agent_ids:['k2k2q9fh'], no wake_reason}`. `wake_reason` is absent **because Prime
   typed the tag itself** — the server only stamps it when the server chose
   (`service-writes.ts:243`).
3. **seq N+2** — Samuel, no tag. `authorKind:'user'`, main room, `addressed=false` ⇒ RR3
   (`service-wake-verdict.ts:337` is the RR2/RR3 split).
4. `recentRoomAgents(chan, SAMUEL, now)` → `listRecentRoomTagsBy` returns **both** rows, `seq`
   descending. **N+1 is first.**
5. `isAuthorTypedAgentTag(N+1)` → `true`. Recipients present, no `wake_reason`. The predicate
   has nothing to object with.
6. Arm 3 (`agent-mentions-responder.ts:176`) returns `k2k2q9fh`, `reason:"most recent"`. **Symptom
   reproduced.** The composer's recipient line agrees via R6/R7, so the UI predicted it too.

Note step 2 is not exotic: **it is the normal shape of every agent-to-agent handoff in this
channel.** Any orchestrator delegating to a worker re-points its own operator's default.

---

## (3) Git archaeology — the three prior fixes, and the delta each one missed

| # | Commit | Date | What it patched | Which writer it missed |
|---|---|---|---|---|
| 0 | `8297c1a5` | 09-02 | RR1/RR2/RR3 born — server repairs a forgotten address at write time | — |
| **A** | `c0794ed3` | 09-04 | **Bug born.** Arm 3 = *the agent that POSTED here most recently* (`recentAgentPosters`), per B1 "a forgotten `@` must never stall". Feed = `listRecentRoomAgentPosts`, `.eq("author_kind","agent")` | Any agent post at all re-pointed **every** member's default. Broadest form of the bug. |
| **B** | `9da20c5b` (rule in `agent-post-stamp.ts`) | 09-04→09-07 | **Fix 1.** Arm 3 re-fed from `recentAgentsAddressedBy`: scoped to **one author's user id**, and `isAuthorTypedAgentTag` added so the server's own picks are not evidence. Commit msg: *"an agent tagging another agent moved every member's default"* | **THE ROOT CAUSE.** It swapped `author_kind='agent'` for `author_user_id=<person>` and **deleted the kind filter in the same stroke** (R1 docblock 70-71 records the trade as intentional). Scoping by *user* does not exclude *that user's own agents* — they share the user id. Fixed "an agent **posted**"; left "an agent **addressed**" wide open. |
| **C** | `f5035e66` | 09-06 | **Fix 2.** Deleted the 15-minute window from rule, feed and composer (*"author stickiness has no clock"*) | Orthogonal — and it **made the bug permanent**. Before C, a stomped value self-healed in 15 minutes and read as flaky; after C the wrong agent sticks until Samuel manually re-tags. C did not cause the bug; it removed the thing that had been hiding it. |
| **D** | `a48d073a` | 09-15 | **Fix 3.** RR3 gated on `!namedButUnresolved` — a typed handle that resolved to nobody is no longer re-aimed | Orthogonal, adjacent symptom. Guards the case where Samuel **did** tag; this bug is the case where he **did not**. |

**The delta that is the root cause: attempt B replaced the author filter instead of intersecting
it.** The rule wants two conditions — *this person* AND *a human* — and B implemented the first
while removing the only field that could express the second.

### Why it survived three rounds — three compounding reasons

1. **The fix and the bug are one line apart, and the line reads correct.**
   `.eq("author_user_id", authorUserId)` looks exactly like "scope to this person". It is, on the
   *identity* axis. The identity model is what makes it wrong: an agent is not a separate
   principal, it posts **as its operator**. Nothing at the call site hints at that.
2. **The intent is documented; the enforcement is not.** `isAuthorTypedAgentTag`'s docblock says
   *"Evidence must be the human's own act"* (line 137) and `recentAgentsAddressedBy` says *"the
   HUMAN's"*/*"per PERSON"* (188-199). A reviewer reading the prose sees the rule enforced.
   **The prose is the spec; the predicate is two-thirds of it.** Rounds 2 and 3 each read those
   docblocks and moved on.
3. **The test fixtures cannot express the bug.** Every `listRecentRoomTagsBy` fixture in the tree
   (`service-wake-verdict-responder.test.ts:210,240`, `draft-reach-parity.test.ts:282,378-394`,
   `delivery-composed.test.ts:239`, `service-wake-verdict-harness.ts:111`) builds rows with
   `author_user_id` and **no `author_kind` field at all** — because R1's projection does not select
   it, so the `Pick<>` type forbids it. The two `authorKind:'agent'` occurrences in those suites
   (`draft-reach-parity.test.ts:422`, `responder.test.ts:373,388`) describe **the author of the
   message being routed** (RR2's lane), never a history row. **No test in this repo can currently
   state the sentence "my agent's post must not move my default."** A regression test was written
   for each prior attempt; none of them could have caught this.

---

## (4) The fix — single source of truth, APPLIED 2026-09-15 (F-704)

One rule, one new condition, threaded through the three layers that dropped the field. Written as
a proposal, approved unchanged, and implemented as described below.

**F1 — the predicate carries the condition** (`lib/agent-post-stamp.ts`)
Add `authorKind` to `recentAgentsAddressedBy`'s row type (lines 231-237) and skip any row whose
author is not a human, beside the existing author filter at line 250:

```ts
if (row.authorUserId !== authorUserId) continue;
if (row.authorKind === "agent") continue;   // ⚠ my own agent posts as ME — see W2
```

Test as `authorKind === "agent"` (not `!== "user"`) so an **absent** field on a legacy row degrades
to the old behaviour rather than silently emptying the list — INVARIANTS §11, UNKNOWN is not EMPTY.
This is the single source of truth: R4 and R6 both route through here, so one edit fixes server
and composer together and they cannot drift.

**F2 — the feed stops discarding the field** (`server/repository-messages-recent.ts`)
Add `author_kind` to the projection (line 102) and to `RecentAuthorTagRow` (90-93), and add
`.neq("author_kind", "agent")` at line 104. Belt and braces on purpose: the SQL bound is what keeps
an agent-heavy room from spending its 50-row budget on rows F1 will throw away, which would silently
shorten the look-back. **Rewrite the docblock at lines 70-71** — it currently argues *for* the
omission and is how round 3 talked itself out of this.

**F3 — the client passes what it already has** (`components/derivations.ts:281-284`)
No new fetch: the DTO already carries `authorKind` (`server/dto.ts:174`). The rows flow into F1
unchanged; only F1's type gains the field.

**F4 — regression tests that pin the invariant.** Three, and the first one is the deliverable:

1. 🔒 **`lib/agent-post-stamp` unit** — history: `{user, tag→A}` then `{agent, tag→B}`, both under
   the same `author_user_id`. Assert the result is **`["A"]` and that `B` does not appear**. This is
   the sentence no existing test can say.
2. 🔒 **Server end-to-end** (`service-wake-verdict-responder.test.ts`) — the exact `bb0f57db`
   repro: Samuel→Prime, Prime→`k2k2q9fh`, Samuel untagged ⇒ `recipientAgentIds === ['c65ym2fl']`,
   `reason: "most recent"`.
3. 🔒 **Parity** (`draft-reach-parity.test.ts`) — same three rows through the composer, asserting
   the recipient **line** and the stored **verdict** still name the same agent, so F3 cannot drift
   from F1.

Plus one **fixture change that is itself a guard**: give the shared harness's tag rows an explicit
`author_kind`. Once the `Pick<>` includes it, an agent-authored history row becomes *expressible*,
which is the structural reason round 5 would catch what rounds 2-4 could not.

**Blast radius.** F1 narrows arm 3 only. `recentAgentPosters` (unused by the arm since 09-04),
RR1, RR2, arm 2 "only agent" and arm 4 "most recently launched" are all untouched. An agent
handoff no longer moves the default; when Samuel's last human tag names an agent that has ended,
the liveness intersection in `resolveDefaultResponder` drops it and the next-most-recent **human**
tag wins, exactly as the 09-06 ruling describes.

**Open question for Samuel (does not block F1-F4).** Should an agent posting on Samuel's behalf
update **its own** stickiness — i.e. per-`(user, author_kind)` or per-agent-session threads of
address, rather than one per user? Today the agent shares Samuel's thread of address entirely, which
is also why this stomp is possible. F1 makes the human's thread authoritative and gives agents none.
That matches the stated ruling ("the agent **you** last addressed"); a per-session variant would be
a new ruling, not a fix.

---

## Verification notes

**Investigation phase** was read-only; line numbers are against `d695c478`.

**Implementation phase** (after Samuel's go) touched **nine files, staged by explicit path** —
never a directory, because Samuel's own tab session had ~22 files mid-edit in the same tree. No
file in this change overlaps that work. No dev server was started.

Changed: `lib/agent-post-stamp.ts` (the predicate) · `server/repository-messages-recent.ts`
(projection, type, `.neq`, and the docblock that argued for the omission) ·
`server/service-wake-verdict-resilience.ts` (row mapping) ·
`server/service-wake-verdict-harness.ts` (fixture default) · `components/derivations.ts` (docs
only — the DTO already carried the field) · plus four test files, two of them new.

Gates run serially on this tree: `vitest run src/features/channels` → **207 files, 3113 tests,
all pass** · root `tsc --noEmit` → **exit 0** · `eslint` on all nine changed files → **clean**.
The three behavioural pins were each confirmed RED with the one-line predicate commented out, so
they measure the bug rather than agreeing with the fix.
