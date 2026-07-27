-- Channels v15 — direct (1:1) channels.
-- A direct channel is a private channel between exactly two workspace members,
-- deduped per member-pair per workspace. It reuses the entire channel/message/
-- consent/task stack; the only new state is the is_direct flag + a normalized
-- direct_key for the uniqueness fence.
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS is_direct  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS direct_key TEXT;

-- direct_key = the two member user-ids, lexicographically sorted, joined ':'.
-- One direct channel per (workspace, unordered member pair). Partial so normal
-- channels (direct_key NULL) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS channels_workspace_direct_key
  ON public.channels (workspace_id, direct_key)
  WHERE is_direct = true;

-- Invariant: a direct channel must be private and carry a direct_key; a normal
-- channel must not carry one. (CHECK can't count members; membership-of-2 is
-- enforced in the service layer at create time.)
ALTER TABLE public.channels
  ADD CONSTRAINT channels_direct_shape CHECK (
    (is_direct = false AND direct_key IS NULL)
    OR (is_direct = true AND direct_key IS NOT NULL AND visibility = 'private')
  );
