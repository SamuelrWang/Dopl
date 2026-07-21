-- Covering indexes for unindexed foreign keys on hot paths (M-12).
--
-- The performance advisor flagged these FK columns as lacking a covering index:
-- every join/filter on them, and every cascade check when the referenced row is
-- deleted, does a sequential scan. Add a plain btree on each. All target tables
-- are currently small (largest, mcp_tool_calls, ~1k rows), so a plain in-txn
-- CREATE INDEX takes a negligible lock — no CONCURRENTLY needed. If mcp_tool_calls
-- (append-only usage log) grows large before this ships, apply that one index
-- CONCURRENTLY out-of-band instead; the rest stay trivial.
--
-- Purely additive (indexes only), no data change, idempotent. NOTE: does not touch
-- the knowledge-embedding HNSW index — that is a correct scale-ahead index, not a
-- drop candidate.

CREATE INDEX IF NOT EXISTS mcp_tool_calls_user_id_idx
  ON public.mcp_tool_calls (user_id);

CREATE INDEX IF NOT EXISTS chats_owner_id_idx
  ON public.chats (owner_id);

CREATE INDEX IF NOT EXISTS skills_created_by_idx
  ON public.skills (created_by);

CREATE INDEX IF NOT EXISTS skills_last_edited_by_idx
  ON public.skills (last_edited_by);

CREATE INDEX IF NOT EXISTS skills_body_edited_by_idx
  ON public.skills (body_edited_by);

CREATE INDEX IF NOT EXISTS skill_versions_author_id_idx
  ON public.skill_versions (author_id);

CREATE INDEX IF NOT EXISTS team_members_user_id_idx
  ON public.team_members (user_id);

CREATE INDEX IF NOT EXISTS knowledge_entry_chunks_knowledge_base_id_idx
  ON public.knowledge_entry_chunks (knowledge_base_id);
