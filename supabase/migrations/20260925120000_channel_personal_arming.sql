-- ============================================================================
-- ARMING A ROOM FOR A PERSONAL SHELF — the switch behind task 11's security
-- half (design #1077, Samuel's press at #1080, option 1 "approve the package").
-- ============================================================================
--
-- ⚠ **WHAT IT IS.** One row = "OWNER has armed CHANNEL, so an AGENT SESSION of
-- theirs running in that room may reach their personal shelf". No row is the
-- normal state and the closed one: `shared/tenancy/personal-reach.ts` treats an
-- absent row as out of reach, so this table only ever OPENS something.
--
-- 🔒 **IT IS THE FAIL-CLOSED BACKFILL, AND THE BACKFILL IS THAT THERE IS NONE**
-- (ruling (c)). Every existing shared-room session loses personal reach the
-- moment this ships, because no room has been armed yet. That is the only
-- user-visible regression in the whole change and it was approved as such —
-- people are told once, in the app, rather than having the reach quietly kept.
--
-- ⚠ **PER (ROOM, OWNER), NOT PER (ROOM, BASE)** — ruling (b). The finer control
-- already exists as the per-channel base grant (`resource_grants`), so this stays
-- the coarse switch and the two do not overlap: a grant lends ONE base into a
-- room for everyone's agents there; an arming row lets ONE person's agents reach
-- THAT PERSON's whole shelf in that room. Neither implies the other.
--
-- ⚠ **A HUMAN ACT, PER ROOM, REVOCABLE.** Only the owner may write their own
-- row, disarming is a `DELETE`, and there is no expiry: a switch that silently
-- re-closed would teach people to arm rooms they have stopped watching.
--
-- 🔒 **NOT AN ORACLE.** Nothing may read another person's arming rows — not to
-- render, not to explain a refusal. An unarmed room answers what an empty room
-- answers (404-never-403), which is what stops the arming state from being
-- readable through the surfaces it gates.
--
-- ROLLBACK: `DROP TABLE public.channel_personal_arming;`. The TS fence then
-- answers `unarmed_room` for every agent in a shared room — closed, never open,
-- so a rollback cannot widen reach.
-- ============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_personal_arming (
  channel_id uuid NOT NULL
    REFERENCES public.channels(id) ON DELETE CASCADE,
  -- ⚠ THE OWNER, and the shelf is theirs by construction: `owner_id` is both the
  -- person who armed the room and the person whose personal container opens.
  -- There is no third party to name, which is why there is no `granted_by`.
  owner_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  armed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, owner_id)
);

-- ⚠ THE READ IS "which channels has THIS OWNER armed, inside THIS container",
-- so the owner is the leading column of the index the probe uses; the primary
-- key already covers the (channel, owner) direction.
CREATE INDEX IF NOT EXISTS channel_personal_arming_owner_idx
  ON public.channel_personal_arming (owner_id, channel_id);

COMMENT ON TABLE public.channel_personal_arming IS
  'Per (room, owner) switch: the owner''s agent sessions in this channel may reach the owner''s personal container. Absent = out of reach (fail-closed). See shared/tenancy/personal-reach.ts.';

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.channel_personal_arming ENABLE ROW LEVEL SECURITY;

-- 🔒 OWNER-ONLY IN EVERY DIRECTION. No admin arm, no member arm, no read arm for
-- anybody else: the row is a fact about one person's own shelf, and a second
-- reader would make "is Samuel's shelf armed here" answerable by the room.
DROP POLICY IF EXISTS channel_personal_arming_select_own ON public.channel_personal_arming;
CREATE POLICY channel_personal_arming_select_own
  ON public.channel_personal_arming
  FOR SELECT
  USING (owner_id = auth.uid());

-- ⚠ ARMING REQUIRES AN ACTIVE MEMBERSHIP OF THE ROOM, checked in the policy and
-- not only in the service: a switch that could be flipped for a room the owner
-- is not in would open their shelf to a session they can never watch.
DROP POLICY IF EXISTS channel_personal_arming_insert_own ON public.channel_personal_arming;
CREATE POLICY channel_personal_arming_insert_own
  ON public.channel_personal_arming
  FOR INSERT
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.channel_members m
       WHERE m.channel_id = channel_personal_arming.channel_id
         AND m.user_id = auth.uid()
    )
  );

-- ⚠ DISARMING CARRIES NO MEMBERSHIP TEST, DELIBERATELY. Leaving a room must not
-- strand an armed row that its owner can no longer delete — closing is always
-- allowed, and a policy that could refuse a close is a policy that keeps reach
-- open.
DROP POLICY IF EXISTS channel_personal_arming_delete_own ON public.channel_personal_arming;
CREATE POLICY channel_personal_arming_delete_own
  ON public.channel_personal_arming
  FOR DELETE
  USING (owner_id = auth.uid());
