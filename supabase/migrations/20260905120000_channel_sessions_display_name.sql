-- =============================================================================
-- CHANNEL_SESSIONS.DISPLAY_NAME — the operator-given agent name, PEER-VISIBLE
-- (2026-08-31, Samuel's ruling: "the other user should see that I'm running a
-- Bug Reviewer").
--
-- WHAT IT IS. The name the operator gave one agent instance ("Bug Reviewer",
-- "Dopl Main"), as of the desktop's last push. Until now that name lived ONLY in
-- the operator's local electron-store (`main/agent-names.js` — "IDENTITY LIVES
-- ON THIS MACHINE"), and this table's `name` column could not carry it anyway:
-- its CHECK is the machine-handle charset (`^[a-z][a-z0-9-]{1,30}$`), which a
-- human name cannot pass. That file's own header named this exact change as the
-- sanctioned path: "widening channel_sessions with a human-charset column is a
-- separate, additive change". This is that change.
--
-- ⚠ A SNAPSHOT OF A LOCAL FACT, NOT A NEW SOURCE OF TRUTH. The local store stays
-- authoritative; the desktop re-pushes on rename (the row diff sees the column —
-- `repository-sessions.ts › SESSION_DIFF_COLUMNS`), and a row outliving its
-- session is deleted by the replace-set push exactly like every other column.
--
-- ⚠ PEER-VISIBLE ON PURPOSE — the whole point is that the OTHER member can see
-- what the agent is called, so it goes in the column GRANT below and in
-- `collab-dto.ts › mapPeerSessionStateRow` (the load-bearing fence; this grant
-- is the belt, per 20260822150000's own header). It is operator-AUTHORED text on
-- a peer's screen, so it is bounded like `channel_name`: length, trim, no
-- control characters, no zero-width characters. NULL = the operator never named
-- it (the render falls back to the handle), or a desktop older than this field.
--
-- ADDITIVE ONLY: one nullable column + its grant. No rows touched, no policy
-- moved. Rollback: ALTER TABLE public.channel_sessions DROP COLUMN display_name;
-- =============================================================================

ALTER TABLE public.channel_sessions
  ADD COLUMN display_name TEXT CHECK (
    display_name IS NULL OR (
      char_length(display_name) BETWEEN 1 AND 60
      AND display_name = btrim(display_name)
      AND display_name !~ '[[:cntrl:]]'
      AND display_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

COMMENT ON COLUMN public.channel_sessions.display_name IS
  'Operator-given agent name, PEER-VISIBLE by design (2026-08-31). NULL = never named; render falls back to #<handle>.';

-- The belt half of peer visibility (the fence is mapPeerSessionStateRow —
-- construction-based, so this column reaches a peer only because its name is
-- typed there too). 20260822150000 REVOKEd table-wide SELECT and granted the
-- public columns; a new PUBLIC column joins that list — RESTATED IN FULL, the
-- shape `schema-sql.test.ts` pins: the LAST grant in the migration chain is
-- read as the effective public column set, so a delta grant would make the
-- suite (and the next reader) believe the older columns were withdrawn.
GRANT SELECT (
  id,
  channel_id,
  workspace_id,
  user_id,
  session_key,
  task_id,
  name,
  state,
  detail,
  channel_name,
  thread_title,
  display_name,
  created_at,
  updated_at
) ON public.channel_sessions TO anon, authenticated;
