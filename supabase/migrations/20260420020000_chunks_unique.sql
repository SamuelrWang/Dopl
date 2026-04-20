-- Guard against duplicate chunks on the same (entry, type, index) tuple.
-- Without this constraint, an atomicity slip or a double-run of the
-- backfill script silently inserts duplicate rows, which inflate
-- similarity scores for affected entries at search time.
--
-- Step 1: dedup any existing duplicates (keep the lowest id per group).
-- The DELETE USING self-join is the standard Postgres idiom.
DELETE FROM chunks a
  USING chunks b
 WHERE a.id > b.id
   AND a.entry_id = b.entry_id
   AND a.chunk_type = b.chunk_type
   AND a.chunk_index = b.chunk_index;

-- Step 2: add the constraint.
ALTER TABLE chunks
  ADD CONSTRAINT chunks_entry_type_index_unique
  UNIQUE (entry_id, chunk_type, chunk_index);
