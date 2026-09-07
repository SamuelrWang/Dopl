-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- PER-MEMBER "UNADDRESSED MESSAGES" — Samuel's ruling on items 10 and 11 (2026-09-06)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS REPLACES. `channels.default_responder_agent_name` (added `20260918120000`, B4) let
-- a room MANAGER pin ONE specific agent, ROOM-WIDE, to answer every member's untagged messages.
--
-- His reasoning for killing it, verbatim: *"if there's another member in the room, their last
-- agent address would be different from my last agent address."* One room cannot hold one
-- answer to a per-person question.
--
-- ⚠ **AND IT IS A RULE NOW, NOT A NAME.** The replacement offers exactly two values and
-- deliberately no "pin a specific agent": agents are EPHEMERAL — they end, and their ids are
-- minted per launch — so a stored handle decays into naming nothing. That decay is the defect
-- the old column had, not an implementation detail of it.
--
--   'last_addressed'  the agent THIS member most recently ADDRESSED in this channel, if it is
--                     still live. Never "most recently posted", and never an agent another
--                     member addressed (`lib/agent-post-stamp.ts › recentAgentsAddressedBy`).
--   'none'            nobody answers this member's untagged messages. ⚠ This kills EVERY
--                     fallback, not just recency: `lib/agent-mentions.ts ›
--                     resolveDefaultResponder` short-circuits on its first line, so a room with
--                     exactly one live agent does not auto-answer either.
--
-- ── ⚠ THE DEFAULT IS `last_addressed`, AND IT IS A STANDING RULING, NOT A PREFERENCE ────────
--
-- B1 (2026-09-04) says a forgotten `@` must never stall a conversation, made off a live
-- incident: a person wrote in a room with two live agents and no default, the post stored
-- `verdict=none`, fed 0 of 2, and he had to send it again with a tag. Defaulting to 'none'
-- would silently reverse that for every member who never opens Settings. 'none' stays
-- available as a deliberate act.
--
-- ⚠ SO THE COLUMN IS `NOT NULL DEFAULT 'last_addressed'`. A nullable column would create a
-- third state — "never chose" — that every reader would have to map back to the default
-- anyway, and one of them eventually would not.
--
-- ── ⚠ IT IS PRIVATE, ON `agent_tool_profile`'S PRECEDENT (`20260810120000`) ─────────────────
--
-- **NO GRANT TO `authenticated` OR `anon`.** That file's rule is "role yes, specific
-- permissions no", and this is a per-member SETTING rather than a roster fact. Two reasons it
-- lands on the private side of that line:
--
--   1. It is nobody else's business whether a given member's agents auto-answer them. The
--      roster tells you WHO is here; this would tell you how somebody works.
--   2. That migration's REALTIME CDC concern applies unchanged — `realtime.apply_rls` runs
--      `has_column_privilege(...)` per column per subscriber role, so an ungranted column is
--      the only way to keep a value out of a peer's change feed. A column granted "just for
--      the UI" is a column broadcast to every subscriber.
--
-- ⚠ **EVERY IN-TREE READ IS `supabaseAdmin()` (service_role), WHOSE GRANTS ARE UNTOUCHED** —
-- grants are per-role. `server/repository.ts` and `repository-collab.ts` are the only readers,
-- and the DTO returns this field to the VIEWER ONLY, exactly as `agent_tool_profile` is nulled
-- for everyone but the viewer in `mapMemberRow`.
--
-- ⚠ **AND THE 42501 WARNING FROM THAT FILE CARRIES OVER**: an authenticated `select("*")`
-- against `channel_members` errors rather than returning a partial row. That is the correct
-- loud failure, and it means a future direct browser read must name its columns.
--
-- ── ⚠ WHAT IS *NOT* DONE HERE, AND WHY ─────────────────────────────────────────────────────
--
-- **`channels.default_responder_agent_name` IS NOT DROPPED AND ITS VALUES ARE NOT MIGRATED.**
--
--   • NOT DROPPED — the standing non-destructive posture: the application stops reading it in
--     this same change, so it is inert, and dropping it would make the previous release
--     unrunnable against this database.
--
--   • NOT MIGRATED — and this one is a JUDGEMENT worth stating rather than an omission. There
--     is no honest translation. The old value is a ROOM-WIDE pin of a SPECIFIC agent; the new
--     one is a PER-MEMBER rule with no way to name an agent at all. Turning "the room answers
--     with agent X" into "every member follows their own last-addressed" is not a data
--     migration, it is a different setting — and turning it into 'none' for everyone would
--     silently mute rooms that had explicitly configured an answerer. Every member starts at
--     the default, which is the behaviour B1 rules for, and anyone who wants otherwise says so.
--
-- ── TO REVERT ──────────────────────────────────────────────────────────────────────────────
-- The old column and its data are untouched, so a revert is application-side plus dropping the
-- column added below. ⚠ A REVERTER MUST RE-READ THE RULING FIRST: restoring the room-wide field
-- restores one member's ability to decide who answers ANOTHER member's untagged messages, which
-- is a scope change and not a rollback.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.channel_members
  ADD COLUMN IF NOT EXISTS unaddressed_responder TEXT NOT NULL DEFAULT 'last_addressed';

-- ⚠ THE CHECK IS THE CLOSED SET, AND IT IS THE TWIN OF
-- `lib/agent-mentions.ts › UnaddressedResponderSetting`. Two spellings of one enum, in two
-- trees that cannot import each other — the same arrangement `channels_default_responder_check`
-- had with the handle grammar. Adding a third value means editing both.
ALTER TABLE public.channel_members
  DROP CONSTRAINT IF EXISTS channel_members_unaddressed_responder_check;

ALTER TABLE public.channel_members
  ADD CONSTRAINT channel_members_unaddressed_responder_check
  CHECK (unaddressed_responder IN ('none', 'last_addressed'));

COMMENT ON COLUMN public.channel_members.unaddressed_responder IS
  'PER-MEMBER: who answers THIS member''s untagged messages in this channel. ''last_addressed'' (default, per B1 2026-09-04 — a forgotten @ must never stall a conversation) = the agent they most recently ADDRESSED here, if still live. ''none'' = nobody, and it kills every fallback including the single-live-agent one. ⚠ PRIVATE — deliberately NOT granted to authenticated/anon, on agent_tool_profile''s precedent (20260810120000): it is a setting, not a roster fact, and an ungranted column is the only way to keep it out of a peer''s realtime change feed. Replaces the room-wide channels.default_responder_agent_name, which is retired and unread.';

COMMENT ON COLUMN public.channels.default_responder_agent_name IS
  'RETIRED 2026-09-06 (Samuel''s ruling, items 10/11) — READ BY NOTHING. Was: a room-wide pin of ONE specific agent to answer every member''s untagged messages, set by a channel manager. Replaced by the PER-MEMBER channel_members.unaddressed_responder, because "if there''s another member in the room, their last agent address would be different from my last agent address". Values are NOT migrated — there is no honest translation from a room-wide pin to a per-member rule. Kept non-destructively; do not read it, and see 20260928130000 before restoring it.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Assert the privilege outcome instead of trusting it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Mirrors `20260819120000_channel_members_favorited_at.sql`, and for its reason: the whole
-- point of adding no GRANT is that the column is unreadable to the client roles. That is an
-- ABSENCE, and an absence is what silently stops being true — restoring the table-wide grant
-- (the documented rollback of `20260810120000`) would hand this column out with no error
-- anywhere, and with it the per-member setting this file argues is nobody else's business.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.channel_members', 'unaddressed_responder', 'SELECT')
     OR has_column_privilege('anon', 'public.channel_members', 'unaddressed_responder', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: channel_members.unaddressed_responder is SELECT-able by anon/authenticated — a table-wide GRANT is back (see 20260810120000 ROLLBACK) and it is handing out agent_tool_profile and favorited_at too; fix that before shipping this column';
  END IF;

  IF NOT has_column_privilege('service_role', 'public.channel_members', 'unaddressed_responder', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot SELECT channel_members.unaddressed_responder — every repository select("*") on this table would 42501';
  END IF;

  RAISE NOTICE
    'channel_members.unaddressed_responder added: service_role-only, no index, publication and replica identity unchanged';
END
$$;
