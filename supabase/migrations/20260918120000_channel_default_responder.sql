-- **THE DEFAULT RESPONDER, AND THE THREE RESILIENCE VERDICTS** (2026-09-02,
-- v2 wave B slice B4 — Samuel's rulings B1 and B6).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY IS OWED, AND IT IS OWED FOR WAVE A TOO.**
-- Docker was unavailable for the whole of wave A, so `supabase db reset` has run
-- against NONE of `20260907120000`..`20260913120000` either. This file has
-- executed nowhere. Do not read the absence of an error as evidence that it
-- works. Re-derive with `supabase migration list --linked` (or MCP
-- `list_migrations`) and a look at the live columns — INVARIANTS §12, and F-304
-- is the precedent for a "not applied" claim that outlived the truth.
--
-- ⚠ READ `20260912120000_channel_delivery_verdict.sql` FIRST. It created
-- `channel_messages.wake_verdict` and the CHECK this file widens, and its
-- section 1 states the `{}` vs NULL rule that every reader of the recipient
-- arrays depends on. Nothing here changes that rule.
--
-- ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
--
-- Wave B narrows the fan-out to the ADDRESSED recipient (ruling B1). On its own
-- that means a message which named nobody reaches nobody — and Samuel's ruling
-- in the same breath is that a forgotten `@` must never stall a conversation.
-- So the server repairs the address, by three rules, and STORES WHICH ONE FIRED:
--
--   'thread_peer'  RR1 — a reply in a thread with no `to`. A thread has exactly
--                  two parties, so "the other one" is total.
--   'reciprocal'   RR2 — an unaddressed AGENT post in the main room, aimed back
--                  at whoever last addressed that agent there, inside
--                  `src/shared/channels/caps.ts › RESILIENCE_WINDOW_MS`.
--   'responder'    RR3 — an unaddressed HUMAN message, aimed at the channel's
--                  configured default responder, or at the room's one live
--                  agent when there is exactly one.
--
-- ⚠ **THE ARMS ARE STORED AS VERDICT VALUES RATHER THAN AS A FLAG BESIDE
-- 'member' / 'agent'.** The desktop has to be able to tell an address the author
-- WROTE from one the server REPAIRED, because "why did my agent answer that" is
-- a question a transcript must be able to answer. Collapsing them would make the
-- repair invisible in exactly the rows it happened on.
--
-- ⚠ **ADDITIVE IN BOTH HALVES, WHICH IS WHAT MAKES THE ROLLBACK A REVERT OF THE
-- CODE AND NOT OF THE DATA.** The column is nullable with no default and the
-- CHECK only WIDENS: a build rolled back to wave A writes 'none'/'member'/
-- 'agent'/'thread', all of which still pass, and reads a column it does not know
-- about as absent. Rolling the CHECK back after rows carry a new value is the
-- one direction that fails, so the DROP/ADD pair below is the whole revert and
-- it is stated in the slice's rollback row.

-- ═══ 1. `channels` — WHO ANSWERS WHEN NOBODY IS NAMED (B6) ════════════════
--
-- ⚠ **IT STORES A HANDLE, NOT A TEMPLATE ID, AND THAT IS A VISIBILITY DECISION
-- RATHER THAN A CONVENIENCE.** `20260823130000_channel_sessions_template_name.sql`
-- gives the reason for its own column and it is the same one: an FK to
-- `agent_templates` from a row every channel MEMBER can read is a cross-visibility
-- reference — the member learns that a template exists, and its id, without any
-- grant on it. A handle names something the room can already see.
--
-- ⚠ **THE GRAMMAR IS `channel_sessions.name`'s, VERBATIM.** That column's own
-- CHECK is `^[a-z][a-z0-9-]{1,30}$`, `channel_messages.recipient_agent_ids`
-- carries the same vocabulary (`20260912120000` section 1), and this points at a
-- row in that projection. A third spelling of "what an agent handle looks like"
-- is how the setting comes to name something no session can ever be.
--
-- ⚠ **IT DEGRADES, IT DOES NOT DANGLE.** Nothing enforces that the handle names
-- a LIVE session, and nothing should: sessions come and go on somebody else's
-- machine and a setting that 500s when its agent stops is worse than one that
-- goes quiet. A handle with no live session simply falls through to RR3 arm 2
-- (the room's one live agent) and then to arm 3 (`delivery=none`, live handles
-- listed). That is the whole failure mode.
--
-- ⚠ **THE WRITE IS MANAGE-GATED ON THE SERVER**, not in the UI:
-- `service-writes.ts › MANAGED_CHANNEL_FIELDS`, the same list `agentPosture`
-- joined for the same kind of reason (`20260912120000` section 2). This decides
-- whose agent the room's unaddressed work lands on, which is a permission
-- statement about somebody else's machine.
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS default_responder_agent_name TEXT;

ALTER TABLE public.channels
  DROP CONSTRAINT IF EXISTS channels_default_responder_check;
-- ⚠ RE-CREATED WHOLE, NOT EDITED — a CHECK cannot be ALTERed, and a
-- partially-rewritten one is how a clause goes missing (`20260912120000`).
ALTER TABLE public.channels
  ADD CONSTRAINT channels_default_responder_check
  CHECK (
    default_responder_agent_name IS NULL
    OR default_responder_agent_name ~ '^[a-z][a-z0-9-]{1,30}$'
  );

COMMENT ON COLUMN public.channels.default_responder_agent_name IS
  'RR3: the agent handle (channel_sessions.name grammar) that answers an unaddressed HUMAN message in this room when more than one agent is live. ⚠ NULL = not configured; one live agent then answers by itself and two or more answer NOT AT ALL (delivery=none, live handles listed). ⚠ A HANDLE, never a template id — an FK to agent_templates would be a cross-visibility reference from a row members can read. ⚠ Manage-gated in service-writes.ts › MANAGED_CHANNEL_FIELDS.';

-- ═══ 2. `channel_messages.wake_verdict` — THE THREE RESILIENCE ARMS (B1) ═══
--
-- ⚠ **WIDENING ONLY.** Every value the wave-A CHECK admitted still passes, so an
-- older build's inserts are unaffected and no existing row is re-validated
-- against a narrower set. ⚠ The reverse direction is the one that fails: once a
-- row carries 'thread_peer' / 'reciprocal' / 'responder', re-adding the wave-A
-- CHECK errors on it. Reverting this slice means reverting the CODE and leaving
-- the widened CHECK in place, exactly as `20260912120000`'s header says about
-- its own columns.
ALTER TABLE public.channel_messages
  DROP CONSTRAINT IF EXISTS channel_messages_wake_verdict_check;

ALTER TABLE public.channel_messages
  ADD CONSTRAINT channel_messages_wake_verdict_check
  CHECK (
    wake_verdict IS NULL
    OR wake_verdict IN (
      'none', 'member', 'agent', 'thread',
      'thread_peer', 'reciprocal', 'responder'
    )
  );

COMMENT ON COLUMN public.channel_messages.wake_verdict IS
  'WHO the server resolved this message for at write time: none | member | agent | thread | thread_peer | reciprocal | responder. The last three are the B1 RESILIENCE arms — the server repaired an address the author did not write (RR1 thread peer, RR2 reciprocal inside the 15-minute window, RR3 default responder / sole live agent). ⚠ They are separate VALUES so a reader can tell a written address from a repaired one. NULL = written before the resolver existed. Never re-computed on read.';

-- ═══ 3. NO INDEX FOR RR2, AND THAT IS MEASURED RATHER THAN ASSUMED ════════
--
-- RR2 asks: the highest-`seq` row in THIS channel, with no thread tag, newer
-- than 15 minutes, whose `recipient_agent_ids` contains one handle. It runs at
-- most once per unaddressed agent post.
--
-- ⚠ **IT RIDES `channel_messages_channel_seq_idx` ON `(channel_id, seq)`**, which
-- `20260725120000` already creates and which every other read on this table uses.
-- Descending on `seq` inside one channel and stopping at the window's floor is a
-- bounded index scan over the room's last few minutes — a GIN index on
-- `recipient_agent_ids` would be a whole index to maintain on EVERY insert so
-- that a rare read could skip a handful of rows it has already fetched. Add one
-- when a measurement asks for it, and record the measurement here.
