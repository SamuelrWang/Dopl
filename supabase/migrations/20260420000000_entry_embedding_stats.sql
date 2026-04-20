-- Record per-entry embedding coverage so ops can spot entries with
-- partial indexes. `chunkAndEmbed` embeds with allSettled semantics —
-- if 7/10 chunks land, the entry is marked complete but retrieval
-- quality is degraded. These columns surface that without changing
-- the "≥1 chunk = complete" policy.
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS chunks_attempted int,
  ADD COLUMN IF NOT EXISTS chunks_embedded int;

-- Partial index for the quick "show me entries with patchy indexes"
-- query — most rows will have chunks_attempted = chunks_embedded so
-- filtering on inequality is sparse and cheap.
CREATE INDEX IF NOT EXISTS entries_chunks_partial_idx
  ON entries (id)
  WHERE chunks_attempted IS NOT NULL
    AND chunks_embedded IS NOT NULL
    AND chunks_embedded < chunks_attempted;
