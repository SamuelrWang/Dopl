-- channels.info_card — THE CURATED MAIN-INFO CARD (Samuel, 2026-08-25).
--
-- ⚠ DEPLOY STATE IS A MEASUREMENT. Re-derive with `supabase migration list` (or
-- the MCP `list_migrations`) JOINED ON THE NAME (`channel_info_card`), never on
-- the filename prefix — every file in the recent wave applied under a re-stamped
-- version (INVARIANTS §12, F-304).
--
-- ── WHAT IT HOLDS ─────────────────────────────────────────────────────────
-- /home's Info tab shows a channel's "Main info" rows. Samuel's ruling makes
-- that list EDITABLE: each built-in row carries a hover-only ×, and a discreet
-- ghost row at the end adds a custom `label: value` pair. Both edits must
-- persist, so both live here:
--
--   {"hidden": ["email"],
--    "rows":   [{"id": "...", "label": "Phone", "value": "+1 555 0101"}]}
--
--   hidden — built-in row KEYS the operator removed. The row still has a fact
--            behind it; it is the CARD that stopped showing it, which is why
--            this is a card field and not a nulled column somewhere.
--   rows   — custom `label: value` pairs, in render order.
--
-- The shape is stated ONCE, in `src/features/channels/info-card.ts` (zod +
-- the same module's pure helpers). This column stores whatever that schema
-- accepted and asserts only that it is a bounded JSON OBJECT.
--
-- ── WHY A COLUMN ON `channels`, AND NOT A TABLE ───────────────────────────
-- It is per-CHANNEL, one row per channel, read on every path that already
-- reads the channel and written through the PATCH that already writes the
-- channel header (`PATCH /api/channels/[channelId]`). A side table would buy a
-- second read, a second write lane, a second RLS statement and a second fence
-- for a field that is 1:1 with a row we already have in hand.
--
-- ── WHY THE SIZE CHECK IS LOAD-BEARING, NOT DECORATION ────────────────────
-- `channels` is (a) read by `repository.ts › listChannels`, which selects `*`
-- — INVARIANTS §9's rule is "a whole-workspace list read never hauls the
-- JSONB", and this column is the first JSONB on the table — and (b) UPDATEd on
-- every message post by `› touchChannel`, so it rides the WAL new-tuple image
-- of the hottest write in the schema. 4 KiB is the answer to both: the field is
-- bounded by construction, so the list read cannot become size-of-workspace and
-- the WAL cannot grow without limit. **The application cap is far tighter**
-- (12 rows × 40/200 chars — `info-card.ts`); this constraint is the floor under
-- it, not the product rule.
--
-- ⚠ NOT a REALTIME change (INVARIANTS §7/§12): no SELECT policy, no replica
-- identity, no column grant is touched. `channels` stays REPLICA IDENTITY
-- DEFAULT, so a DELETE frame is unchanged; an UPDATE frame carries the new
-- tuple, which is exactly what the 4 KiB bound exists to cap.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The column, its default and its NOT NULL:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='channels'
--      AND column_name='info_card';
--
--   -- 2. The constraint:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.channels'::regclass
--      AND conname='channels_info_card_check';
--
--   -- 3. THE BEHAVIOUR the catalog cannot confirm — inside a rolled-back
--   --    transaction, each of these must RAISE, and a small object must not:
--   --      UPDATE channels SET info_card = '[]'::jsonb   WHERE id = <id>;
--   --      UPDATE channels SET info_card = to_jsonb(repeat('x', 5000))
--   --                                                   WHERE id = <id>;
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
-- In a NEW migration: `ALTER TABLE public.channels DROP CONSTRAINT
-- channels_info_card_check;` then `... DROP COLUMN info_card;`. ⚠ It is a
-- ONE-WAY loss and there is no ordering trap, only a data one: the column IS
-- the record of which rows an operator removed and what they typed in their
-- place, and nothing else in the schema holds either. Dropping it silently
-- restores every hidden built-in row and deletes every custom one. Prose rather
-- than commented-out SQL, per the precedent in
-- 20260822160000_channel_launch_directives.sql.

-- ===========================================================================
-- The column
-- ===========================================================================
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS info_card JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.channels.info_card IS
  'The channel Info tab''s CURATED Main-info card: {"hidden": [<built-in row key>], "rows": [{"id","label","value"}]}. `hidden` names built-in rows the operator removed from the CARD (the fact behind the row is untouched); `rows` are custom label/value pairs in render order. Shape and per-field bounds are stated once in src/features/channels/info-card.ts; the DB asserts only that it is a bounded JSON object. Empty object = the card as shipped.';

-- ⚠ TWO CLAUSES, TWO DIFFERENT JOBS. `jsonb_typeof` refuses an ARRAY or a
-- SCALAR, which the reader would otherwise have to defend against on every
-- read; `octet_length` is the §9/§7 bound argued in the header. NOT VALID is
-- deliberately NOT used — the table has no pre-existing values to validate
-- against, because the column is being created with a conforming default in
-- this same statement.
ALTER TABLE public.channels
  ADD CONSTRAINT channels_info_card_check
  CHECK (
    jsonb_typeof(info_card) = 'object'
    AND octet_length(info_card::text) <= 4096
  );

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'channels'
       AND column_name = 'info_card'
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'channels.info_card missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.channels'::regclass
       AND conname = 'channels_info_card_check'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'channels_info_card_check missing or not validated';
  END IF;

  -- ⚠ THE DEFAULT IS ASSERTED BY VALUE, not by the presence of a default:
  -- every reader treats `{}` as "the card as shipped", and a column that
  -- defaulted to NULL or to `[]` would break that on the first channel created
  -- after this ran, with no error anywhere.
  IF EXISTS (
    SELECT 1 FROM public.channels
     WHERE info_card IS NULL OR jsonb_typeof(info_card) <> 'object'
  ) THEN
    RAISE EXCEPTION 'channels.info_card holds a non-object row';
  END IF;
END
$$;
