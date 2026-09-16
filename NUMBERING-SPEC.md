# NUMBERING-SPEC — per-channel message numbers

**Spec only. No code was written.** Decision-ready for Samuel: the ask, what `seq` is today,
every consumer it would touch, three options with blast radius, and a recommendation.

Written 2026-09-15 by `cn19np53`. Numbers and file references measured against the tree at
`d695c478`; re-derive rather than quote.

---

## The ask

> *"Today `seq` is one global counter across the whole account; counts should be scoped per
> channel (and per thread) so `#1700` means something inside a room."*

## Recommendation, up front

**Option B — add a per-channel number as a SECOND, display-and-citation identifier, and leave
`seq` exactly as it is.** Cost: one migration + one insert path + one backfill + read-model and
renderer changes; roughly a day, most of it in tests. Blast radius: additive, nothing existing
changes meaning.

**Do not renumber `seq` itself (Option C).** It is load-bearing in nine places, and one of them
— the account-wide status cursor — has no per-channel equivalent at all.

⚠ **AND THE REAL RISK IS NOT THE MIGRATION, IT IS THE AMBIGUITY IT CREATES.** See
[The hazard](#the-hazard-two-numbers-one-notation) — it is the part of this spec worth arguing
about, and it applies to Options A and B equally.

---

## What `seq` is today

`supabase/migrations/20260725120000_channels.sql`:

```sql
seq BIGINT GENERATED ALWAYS AS IDENTITY
```

**One sequence per TABLE.** INVARIANTS §5 states the consequences, and they are already
load-bearing:

- Globally unique across every workspace **and** every `kind='link'` container at once.
- Strictly increasing per channel, but **gappy** — consecutive posts in one room are never
  consecutive numbers.
- **A `seq` range is never a message count**, and **a cursor is only ever a number the server
  handed you** — never arithmetic, never guessed.

So the user-visible complaint is precise and correct: inside a room, `#1759` carries no
ordinal meaning. It is an identity that happens to sort.

## Where a human sees one today

**Exactly one place in the UI**: `components/artifact-card.tsx:148` renders `#{member.seq}` for
each folded member. Everything else treats `seq` as a cursor.

**And everywhere in prose.** Agents and operators cite `#1759`, `#1760`, `seq 1759` constantly
in message bodies — this channel's own transcript is full of it. That usage is not a feature
anyone built; it is people reading the one number the system exposes. It is also why the
hazard below is not theoretical.

---

## Every consumer, and whether per-channel numbering breaks it

### A. Would BREAK under a renumbered `seq` (Option C)

| # | Consumer | Where | Why it breaks |
|---|---|---|---|
| 1 | **Account-wide status cursor** | `channels/server/service-account.ts:198` — *"⚠ ONE CURSOR IS LEGAL BECAUSE `seq` IS A TABLE-WIDE IDENTITY"* | `dopl_status(since=N)` is ONE number covering every channel of every workspace. Per-channel numbering makes a single cursor meaningless; the tool contract would need N cursors. **No per-channel equivalent exists.** |
| 2 | **Consent de-dupe key** | `channel_consent_requests.message_seq`, partial unique `(operator_user_id, channel_id, kind, message_seq)` (`20260726140000`) | Includes `channel_id`, so it would survive — but every EXISTING row's `message_seq` becomes ambiguous the moment the meaning changes. A decided row is the audit of a human decision (INVARIANTS §11); silently re-pointing it is not acceptable. |
| 3 | **Artifact member lists** | `dopl_channel(op="artifact", messages=[seq])`, `channel_messages(artifact_id, seq)` index (`20260926120000`) | Agents pass raw seqs to fold a run. Same notation, different meaning, no validation that can tell. |
| 4 | **Session wake/anchor watermarks** | `channel_sessions.last_wake_seq` (`20260909120000`), `anchor_seq` in the stale-activity RPC (`20260807160000`) | Stored numbers compared against live ones. A meaning change silently mis-compares. |
| 5 | **MCP `since=` / holds** | `packages/mcp-server/src/tools/channel.ts` (`op="read"`, `wait_ms` requires `since`) | Same notation, per-call scope now ambiguous — see the hazard. |
| 6 | **Transcript paging + window join** | `message-window.ts › isContiguous`, `oldestSeq`, `use-channel-messages.ts` | Uses `seq` as an opaque ordered cursor. Would keep working per-channel *by luck*, since the transcript is single-channel — but `boundarySeq` is compared against remembered values that predate the change. |
| 7 | **Delete doorbell** | `20260822130000_channel_messages_delete_doorbell.sql` | Rings when a pending row is anchored on a removed seq. |
| 8 | **Desktop listener lane** | ~8 files in `dopl-desktop-app/main/` (`channel-listener.js`, `listener-messages.js`, `delivery-ack.js`, `consent.js`, `legacy-threads.js`, …) | Ships in a build the user restarts on their own schedule — **an old desktop would interpret new numbers with old rules**, which is the worst version of this failure. |
| 9 | **Prose citations already in the archive** | every `#NNNN` in stored message bodies, KB entries, and this repo's own trace docs | Unfixable retroactively. A renumber makes every historical citation point at a different real message. |

### B. Unaffected by any option

Idempotency (`client_msg_id`, author-scoped), delivery/wake verdicts, recipients, threads
(`channel_tasks`), read watermark (`channel_members.last_read_at` — a TIMESTAMP, not a seq,
INVARIANTS §979), mention reads (`channel_mention_reads`, keyed by `message_id`).

⚠ Worth noting: the two things a user actually experiences as "unread" are already **not**
seq-based, so per-channel numbering buys nothing there.

---

## The hazard: two numbers, one notation

**The number a human reads and the number an agent types are the same string today.** If the UI
starts showing `#12` while `since=`, `messages=[…]` and every stored watermark still mean global
seq, then an operator saying *"re-read from #12"* and an agent passing `since=12` are now two
different messages — and **12 is a perfectly valid global seq**, so nothing errors. It silently
reads the wrong room's history.

This is the same failure class as the `dopl-development` slug (F-701): a plausible identifier,
resolved against the wrong namespace, answering confidently. It is why the recommendation
below refuses to let one notation mean two things.

### ⚠ THE HAZARD NOW HAS A SHIPPED CONSUMER (added 2026-09-15, after `a553a9ff`)

The clickable message pill landed hours after this spec was drafted, and it makes question 3
a **correctness** decision rather than a style one. `lib/message-refs.ts` is the one place that
decides what counts as a citation, and it reads every `#NNNN` in prose as a **global `seq`**:

```
MESSAGE_REF_TOKEN_RE = /((?<![\w#])#\d{2,}(?!\w|\.\d)|…)/gi
isCitableSeq(seq, newestSeq) → newestSeq !== null && seq > 0 && seq <= newestSeq
```

Both gates are well-judged for table-wide seqs — and **neither can catch a per-channel
number**. `#12` matches the pattern (its floor is 2 digits, chosen because *"channel seqs are
four digits by the time anyone cites one"*), and `12 <= newestSeq` is true in every channel
alive. So the day `channel_no` appears in prose, this component draws a confident pill that
jumps to **global seq 12** — a real message, in some other room, from months ago. A false
positive that resolves is worse than one that fails, and the file says so itself: *"a pill that
jumps nowhere teaches the reader to distrust every pill"*. One that jumps SOMEWHERE WRONG is
worse again.

⚠ **AND `#` CANNOT SIMPLY BE REASSIGNED, BECAUSE THE ARCHIVE ALREADY USES IT.** Every `#NNNN`
in stored message bodies, in the KB, and in this repo's own trace documents means a global
`seq` — thousands of them, written by people and agents over months. Ruling that `#` now means
the per-channel number silently re-points all of it. Ruling that `#` stays global means Samuel
does not get the thing he asked for. **That is the real decision**, and it has only three
honest resolutions:

1. **A distinct glyph for the new number** (`№12`, `c12`, anything the regex above cannot
   match). History keeps its meaning, the new number gets a namespace, no cutover. *Recommended.*
2. **`#` becomes per-channel, and a cutover date is stored** so the parser can resolve by
   message age. Correct but stateful, and every citation near the boundary is a coin flip.
3. **`#` becomes per-channel and history is accepted as broken.** Cheapest, and it silently
   breaks the citations in every trace document this incident produced.

A heuristic ("small numbers are channel numbers") is not on this list, deliberately — that is
F-701's disease with a different mask.

**Mitigation, required in whichever option is chosen:**

1. **Distinct notation.** Per-channel numbers render `#12`; global seqs render `seq 1759` and
   never `#1759`. One glyph, one namespace.
2. **MCP accepts both, explicitly, and never guesses.** `since=` keeps meaning global `seq`.
   A new `since_no=` (or `{channel, no}`) means the per-channel number. Passing a bare number
   that is valid in both namespaces is not disambiguated by heuristics — the tool takes the
   explicit parameter or refuses, the `ambiguous_slug` shape (F-701).
3. **The artifact card and the pill emit the per-channel number**, since those are read by
   humans; the wire payloads keep carrying `seq`.

---

## The options

### Option A — display-layer only (compute an ordinal at read time)

Derive `row_number() OVER (PARTITION BY channel_id ORDER BY seq)` when reading a page; store
nothing.

- **Cost:** low to write.
- ⚠ **But it is not cheap at read time and it is not stable.** The transcript pages backwards
  with a keyset cursor; computing an ordinal for a page requires counting every earlier row in
  that channel (`COUNT(*) WHERE channel_id = ? AND seq < ?`) on **every page fetch** — an
  unbounded scan that grows with the room, on the hottest read in the product.
- ⚠ **Numbers move.** Any delete renumbers every later message in the room, so a citation
  written on Monday points somewhere else on Tuesday. That is worse than the status quo: today
  `#1759` is at least permanently *some* specific message.
- **Verdict: rejected.** Fails the thing the feature is for — a number you can cite.

### Option B — a stored per-channel number, `seq` unchanged ✅ RECOMMENDED

Add `channel_no BIGINT` to `channel_messages`, assigned per channel at insert, backfilled by
`row_number()` over existing rows.

- **Assignment** must be atomic per channel. Two shapes, both fine: a `channel_counters` row
  incremented in the same transaction as the insert, or a trigger doing
  `SELECT COALESCE(MAX(channel_no),0)+1 … WHERE channel_id = ? FOR UPDATE`. Contention is
  per-channel and the write rate is human-paced.
- **`seq` keeps every current job** — cursors, watermarks, consent keys, artifact lists, the
  account-wide status cursor. Nothing above breaks, because nothing above changes meaning.
- **Gaps:** a deleted message leaves a gap in `channel_no`, exactly as it does in `seq` today.
  ⚠ **That is correct and must be specified as intended**: a stable citation is worth more than
  a gapless count, and renumbering on delete is what makes Option A unusable.
- **Reads:** `channel_no` joins the message DTO; the artifact card, the new message-reference
  pill, and any "#" the UI prints use it.
- **Blast radius:** additive. One migration, one insert path, one backfill, the DTO, the two
  render sites, and the MCP `since_no=` addition. Old desktops keep working because they never
  see the new field.

### Option C — renumber `seq` itself per channel

- **Verdict: rejected.** Breaks all nine consumers in table A, including one (the account-wide
  cursor) with no per-channel equivalent, and invalidates every `#NNNN` already written into
  stored prose. The only way to do it safely is Option B plus a multi-release deprecation of
  `seq` from every wire contract — months, for a display improvement.

---

## Per-thread numbering — recommend NOT doing it

The ask says *"per channel (and per thread)"*. A third namespace multiplies the hazard above by
one more, and a thread is a **filter over a channel's messages**, not a container that owns
them: the same message would carry `#12` (channel) and `#3` (thread) simultaneously, and a
citation would have to say which.

**Recommendation:** one number per message, scoped to the CHANNEL, shown in both the channel
view and the thread view. A thread's messages then read as a non-contiguous run (`#12`, `#15`,
`#16`), which is honest — they are non-contiguous in the room. If Samuel specifically wants
`1, 2, 3…` inside a thread, that is a second decision and should be taken on its own.

---

## Open questions for Samuel

1. **Gaps on delete: keep (recommended) or renumber?** Keeping them preserves citations.
2. **Per-thread numbers: drop (recommended) or build the second namespace?**
3. **Notation:** `#12` for per-channel and `seq 1759` for global — acceptable?
4. **Backfill scope:** every channel ever, or only channels with activity in the last N days?
   (Full backfill is one `UPDATE … FROM (SELECT row_number() …)`; the table is small today.)
5. **Does the new message-reference pill cite `#channel_no` or a message UUID?** A UUID is
   unambiguous and survives every decision above; the number is what a human can type.

## What this spec does not do

No code, no migration file, no schema change. Nothing here is committed beyond this document.
