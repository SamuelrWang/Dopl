-- 021_cluster_fork_attribution.sql — Track fork lineage on clusters

ALTER TABLE clusters ADD COLUMN IF NOT EXISTS forked_from_slug TEXT;
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS forked_from_title TEXT;

-- Helper function for atomic fork count increment
CREATE OR REPLACE FUNCTION increment_fork_count(pc_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE published_clusters
  SET fork_count = fork_count + 1
  WHERE id = pc_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
