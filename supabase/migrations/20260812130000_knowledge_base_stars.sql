-- PER-USER STARS ON KNOWLEDGE BASES — a favourite, not a workspace property.
--
-- The knowledge home grid sorts starred bases to the front. A star belongs to
-- ONE person: two members looking at the same workspace see different orders,
-- and nothing about a base's own row changes when somebody stars it. That is
-- the whole reason this is a join table on `auth.users` rather than a column on
-- `knowledge_bases` — a column would be a workspace-wide fact and the first
-- star would reorder the grid for everybody.
--
-- ── PRECEDENT: `agent_presence` (20260726130000), NOT `user_preferences` ──
--
-- Two per-user shapes already exist in this schema and they answer different
-- questions:
--
--   * `user_preferences` (baseline, §1 `026_user_preferences.sql`) is a generic
--     `(user_id, key) -> JSONB` store with own-row policies on all four verbs
--     and live client grants. It is the right home for a SETTING — onboarding
--     state, a dismissed banner — a value with no referent.
--   * `agent_presence` is a dedicated table keyed `(user_id, <thing>)`, RLS on,
--     client DML revoked, every write through the feature service on the
--     service-role client.
--
-- A star is not a setting; it is a RELATION to a row, so it takes the second
-- shape. The deciding property is the FK: `knowledge_base_id REFERENCES
-- knowledge_bases ON DELETE CASCADE` means a deleted base takes its stars with
-- it, atomically, in the statement that deletes it (deletes are permanent —
-- `repository-bases.ts › hardDeleteBase`). A `{"starredBases": [...]}` blob
-- under a preference key has no referent the database understands: every
-- delete would strand an id, and the array would rot into a list of ghosts
-- that the read path has to filter and no writer ever cleans.
--
-- ── WRITE POSTURE: SERVICE ROLE ONLY, matching every other knowledge write ──
--
-- Verified against the tree at write time: every knowledge table read or
-- written by this product goes through `supabaseAdmin()` in
-- `features/knowledge/server/repository-*.ts` —
--
--   grep -rn 'from("knowledge_' src apps packages dopl-desktop-app
--
-- — no browser, SPA or Electron path issues a PostgREST call against one. The
-- immediately preceding migration (20260812120000 §5) took the `UPDATE` grant
-- on `knowledge_bases` away from the client roles for exactly this reason. A
-- new knowledge table that shipped with client INSERT/DELETE grants would be
-- the only one in the feature, and the difference would be invisible until
-- somebody used it.
--
-- So the SELECT policy below is DEFENCE IN DEPTH, not the fence. The fence is
-- `service-stars.ts`, which scopes every read to the caller's own user id and
-- intersects it with the post-visibility base list. Service role bypasses RLS
-- entirely (INVARIANTS §2), so on the path this table is actually used the
-- policy evaluates for nobody. It is written anyway because the cost is zero
-- and the failure it covers — a future client-side read of "my stars" landing
-- on an ungoverned table — is silent.
--
-- ── NOT PUBLISHED TO REALTIME, DELIBERATELY (INVARIANTS §7) ──
--
-- The publication list is an invariant, not a description: a published table
-- with no subscriber costs WAL decode plus a per-subscription RLS evaluation on
-- every write, forever. Nothing subscribes to stars. The toggle is optimistic
-- in the client and the star is per-user, so there is no second surface to tell
-- — a member's other window learns about it on its next list read. Do NOT add
-- this table to `supabase_realtime`.

-- ════════════════════════════════════════════════════════════════════
-- 1. The table
-- ════════════════════════════════════════════════════════════════════
--
-- No `id` column and no `workspace_id`. The composite primary key IS the
-- identity of the fact ("this user starred this base"), which makes the
-- unstar a plain DELETE on the key and the star an INSERT ... ON CONFLICT DO
-- NOTHING — both idempotent, so a retried request cannot produce a second row
-- or a 409. `workspace_id` would be derivable from the base and therefore a
-- denormalisation that can disagree with it; the workspace fence lives one
-- layer up, where every knowledge read already puts it.
--
-- `created_at` is not read by any surface today. It is here because "when did
-- I star this" is the only question this table could ever be asked that the
-- key cannot answer, and adding a timestamp column later means backfilling
-- rows whose real answer is gone.

CREATE TABLE IF NOT EXISTS public.knowledge_base_stars (
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, knowledge_base_id)
);

-- ════════════════════════════════════════════════════════════════════
-- 2. Indexes — one per FK, as a LEADING column (INVARIANTS §12)
-- ════════════════════════════════════════════════════════════════════
--
-- The primary key already covers `user_id` as a leading column, which serves
-- both the user FK and the ONE query this table has ("which of these bases has
-- this user starred", a `user_id = $1 AND knowledge_base_id IN (...)`).
--
-- `knowledge_base_id` needs its own index and the reason is the CASCADE, not a
-- query: a base delete has to find the star rows referencing it, and without a
-- leading index on the referencing column that is a sequential scan of this
-- table per deleted base. `unindexed_foreign_keys` checks exactly this.

CREATE INDEX IF NOT EXISTS knowledge_base_stars_base_idx
  ON public.knowledge_base_stars (knowledge_base_id);

-- ════════════════════════════════════════════════════════════════════
-- 3. RLS — a user may see their OWN rows and nothing else
-- ════════════════════════════════════════════════════════════════════
--
-- `(SELECT auth.uid())` rather than a bare `auth.uid()`: the subselect form is
-- an InitPlan evaluated once per statement instead of once per row, which is
-- the shape `20260720211005_rls_pin_workspace_member_and_initplan.sql`
-- standardised across this schema.
--
-- SELECT is the only policy, and the absence of the other three is the point:
-- with INSERT/UPDATE/DELETE revoked below there is no client write to govern,
-- and a write policy nobody can reach reads as an invitation to grant the verb
-- later without re-deciding the posture.

ALTER TABLE public.knowledge_base_stars ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.knowledge_base_stars FROM anon, authenticated;

DROP POLICY IF EXISTS knowledge_base_stars_select_own ON public.knowledge_base_stars;
CREATE POLICY knowledge_base_stars_select_own ON public.knowledge_base_stars
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ── VERIFICATION (run on the target database after applying) ────────────────
--
--   -- (a) The table is governed and carries exactly one policy:
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.knowledge_base_stars'::regclass;             -- t
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'knowledge_base_stars';                         -- 1 row, SELECT
--
--   -- (b) No client role may write it:
--   SELECT grantee, privilege_type FROM information_schema.table_privileges
--    WHERE table_name = 'knowledge_base_stars'
--      AND grantee IN ('anon', 'authenticated');                       -- SELECT only
--
--   -- (c) Both FKs cascade, and the referencing column is indexed:
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'public.knowledge_base_stars'::regclass
--      AND contype = 'f';                                              -- both 'c'
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'knowledge_base_stars';                         -- pkey + base_idx
--
--   -- (d) It is NOT in the realtime publication (§7):
--   SELECT 1 FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime'
--      AND tablename = 'knowledge_base_stars';                         -- zero rows
