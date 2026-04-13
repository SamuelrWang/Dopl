-- Track which user ingested an entry (informational, not access control)
-- All entries remain visible to all authenticated users
ALTER TABLE entries ADD COLUMN ingested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
