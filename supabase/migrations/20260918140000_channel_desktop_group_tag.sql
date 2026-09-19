-- **`@desktop` — THE OPERATOR'S OUTSIDE SESSIONS, AS ONE BUILT-IN ADDRESS**
-- (2026-09-18, Samuel's ruling on the external-session group tag).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY IS OWED.** This file has executed NOWHERE.
-- Do not read the absence of an error as evidence that it works.
-- ⚠ RE-DERIVE RATHER THAN TRUSTING THAT LINE, AND JOIN ON THE NAME:
-- `supabase migration list --linked` (or MCP `list_migrations`) plus a look at
-- the live constraint. INVARIANTS §12; F-304's re-stamp is the precedent.
--
-- ⚠ READ `20260912120000_channel_delivery_verdict.sql` (which created both
-- columns and both CHECKs) and `20260918120000_channel_default_responder.sql`
-- (which last widened the verdict CHECK, for the resilience arms) before
-- changing anything here. This file is the THIRD statement of the verdict set
-- and the SECOND of the delivery set.
--
-- ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
--
-- An OUTSIDE SESSION is any MCP client on the operator's device token that this
-- product did not spawn — a Claude Code run, Codex, Cursor, a scheduled routine.
-- It has no handle, so an in-channel agent could only address the OPERATOR, and
-- addressing a person is a request for that person's agents: the operator's
-- machine would wake a responder for a question that was really aimed at their
-- laptop. `@desktop` is the address that was missing.
--
-- ⚠ **NO NEW COLUMN, AND THAT IS THE DESIGN RATHER THAN A SHORTCUT.** The
-- recipient rides the server-owned `metadata.to_desktop` key, which carries the
-- OPERATOR'S user id. Two reasons, and the first is a safety property:
--
--   1. **`recipient_user_ids` IS WHAT MACHINES ROUTE ON**
--      (`main/session-dispatch.js › serverNamesMember`), and `metadata.to_user_id`
--      is what the desktop's `targeting.js › classify` reads and what consent
--      cards index. An address that must wake NOTHING and notify NOBODY has to
--      live outside both, or every machine in the field would have to learn a
--      new exception — including the ones that will never be updated again.
--      Keeping it in metadata makes "it starts nothing" true BY CONSTRUCTION,
--      for an old desktop exactly as for a new one.
--   2. It is indexable the same way the member lane already is: `dopl_status`
--      asks `metadata->>to_desktop = <me>` exactly as it asks
--      `metadata->>to_user_id = <me>` (`server/repository-account.ts`).
--
-- So the only schema change is the two CHECK widenings below.

-- ═══ 1. `channel_messages.wake_verdict` — THE `desktop` VERDICT ════════════
--
-- ⚠ **WIDENING ONLY.** Every value the previous CHECK admitted still passes, so
-- an older build's inserts are unaffected and no existing row is re-validated
-- against a narrower set. ⚠ The reverse direction is the one that fails: once a
-- row carries 'desktop', re-adding the previous CHECK errors on it. Reverting
-- this slice means reverting the CODE and leaving the widened CHECK in place —
-- exactly what `20260918120000`'s header says about its own widening.
--
-- ⚠ **AN OLDER DESKTOP DEGRADES TO THE CORRECT BEHAVIOUR, NOT MERELY A SAFE
-- ONE.** `main/session-dispatch.js › VERDICTS` does not list this word, so
-- `storedVerdict` answers `''` and the row takes the no-wake fallback. For every
-- other new verdict that would be a degradation; here it is the specification.
ALTER TABLE public.channel_messages
  DROP CONSTRAINT IF EXISTS channel_messages_wake_verdict_check;

-- ⚠ RE-CREATED WHOLE, NOT EDITED — a CHECK cannot be ALTERed, and a
-- partially-rewritten one is how a clause goes missing.
ALTER TABLE public.channel_messages
  ADD CONSTRAINT channel_messages_wake_verdict_check
  CHECK (
    wake_verdict IS NULL
    OR wake_verdict IN (
      'none', 'member', 'agent', 'thread',
      'thread_peer', 'reciprocal', 'responder',
      'desktop'
    )
  );

COMMENT ON COLUMN public.channel_messages.wake_verdict IS
  'WHO the server resolved this message for at write time: none | member | agent | thread | thread_peer | reciprocal | responder | desktop. thread_peer/reciprocal/responder are the B1 RESILIENCE arms (the server repaired an address the author did not write); reciprocal is a TOMBSTONE with no producer since 2026-09-18. ⚠ desktop = `to=@desktop`, the author''s OWN operator''s OUTSIDE SESSIONS — it wakes nothing and notifies nobody, and its recipient rides metadata.to_desktop rather than recipient_user_ids, so no machine routes on it. NULL = written before the resolver existed. Never re-computed on read.';

-- ═══ 2. `channel_messages.delivery` — THE `posted` OUTCOME ═════════════════
--
-- ⚠ **`posted` IS THE ONE HONEST WORD FOR A LANE WITH NO PRESENCE SYSTEM.** A
-- hold is `dopl_channel(op="read", wait_ms=…)` — a long poll that registers
-- nothing server-side — so no server can say whether an outside session is
-- listening at this instant. `held` would be a claim nobody can check and
-- `woken` would be false. `posted` states what happened: the message is in the
-- room, and the outside session sees it on its next look, whenever that is.
-- (The projection row that WOULD have made `held` checkable is Option A of
-- `docs/specs/external-session-handles.md`, which is not what was chosen.)
--
-- ⚠ **NO MACHINE MAY REPORT IT.** `types-delivery.ts › MachineDelivery` is an
-- `Extract` over four words and this is not one of them, so the ack lane cannot
-- carry it inbound; `server/service-writes-delivery.ts › DELIVERY_RANK` ranks it
-- above every machine outcome so a stray receipt cannot overwrite it either.
ALTER TABLE public.channel_messages
  DROP CONSTRAINT IF EXISTS channel_messages_delivery_check;

ALTER TABLE public.channel_messages
  ADD CONSTRAINT channel_messages_delivery_check
  CHECK (
    delivery IS NULL
    OR delivery IN (
      'none', 'unreachable', 'idle', 'delivered', 'woken', 'refused',
      'posted'
    )
  );

COMMENT ON COLUMN public.channel_messages.delivery IS
  'The OUTCOME: none | unreachable | idle | delivered | woken | refused | posted. The server stamps its write-time answer; the operator''s machine overwrites it with what it did and stamps delivery_at. ⚠ delivery_at NULL means nothing has confirmed the server''s answer. ⚠ posted is the @desktop lane and is SERVER-ONLY — no machine reports it, and nothing overwrites it, because no machine was handed the message.';

-- ═══ 3. NO INDEX ON `metadata->>to_desktop`, AND THAT IS MEASURED ══════════
--
-- `dopl_status` asks for messages addressed to the caller's outside sessions:
-- `metadata->>to_desktop = <me>`, bounded by the caller's channel set and by a
-- seq floor, exactly as the member lane's `metadata->>to_user_id` predicate is.
--
-- ⚠ **THE MEMBER LANE'S OWN INDEX IS THE PRECEDENT, AND IT IS DELIBERATELY NOT
-- COPIED YET.** That predicate earned an index because EVERY addressed message
-- carries `to_user_id` — it is the common case. `to_desktop` is stamped only
-- when an author explicitly writes `to=@desktop`, so the key is absent from the
-- overwhelming majority of rows and a b-tree over a mostly-NULL expression is an
-- index to maintain on every insert for a read that already has two bounds.
-- Add one when a measurement asks for it, and record the measurement here.
