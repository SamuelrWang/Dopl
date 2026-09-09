-- ONTOLOGY IN THE HOME SPACE, PART 1 — the SHARE ROW and the two columns that
-- go with it (2026-09-09, `docs/specs/home-ontology.md` §3.1, slice S1).
--
-- ⚠️ **WRITTEN, NOT APPLIED** — this directory's standing gate. Replay is OWED
-- and recorded rather than glossed (Docker is unavailable on the authoring
-- machine, so `supabase db reset` cannot start; CI's `rls-redteam` job is the
-- replay, INVARIANTS §14).
--
-- 🔒 **APPLY IT BY NAME (`ontology_home_shares`), NEVER BY FILENAME VERSION.**
-- F-304's re-stamp: `supabase migration list` prints VERSIONS, and every recent
-- wave applied under a re-stamped one. Join on the NAME (INVARIANTS §12).
--
-- **APPLY ORDER: AFTER `agent_template_knowledge_scopes` (`20260930150000`)**,
-- the highest filename version in this directory at write time. Then
-- `ontology_readable` (`20261001130000`), which is the other half of this slice
-- and depends on the table below existing.
--
-- ⚠ `20260923120000_drop_home_scoped.sql` is in `supabase/migrations-held/`,
-- deliberately unapplied. NOTHING HERE DEPENDS ON IT.
--
-- ═══ WHAT SAMUEL ASKED FOR ══════════════════════════════════════════════════
--
-- An ontology (= one `ontology_clusters` row, spec A1) is personal by default
-- and may be LENT to a home channel. Members of that channel and guests of that
-- channel each get their own LEVEL, and the same ontology lent to a second
-- channel carries a second, independent set. So the key is `(ontology, channel)`
-- and the row is a COMPLETE statement about three audiences.
--
-- ═══ 🔒 WHY NOT `resource_grants` ══════════════════════════════════════════
--
-- Reuse is this repo's default answer and it loses here for one structural
-- reason and one vocabulary reason (spec §3, reasons 1–2). `resource_grants` is
-- ONE SENTENCE WITH ONE `level` COLUMN, keyed
-- `(scope_type, scope_id, resource_type, resource_id)`; three independent levels
-- per share need either three rows that key cannot hold or three type-conditional
-- columns on a table five other resource types depend on. And its channel
-- vocabulary (`agent_only | visible`) is TWO AUDIENCES, not rungs — the one
-- invariant `20260923140000_grant_read_arm.sql` is loudest about. Ontology levels
-- ARE rungs. Storing them there falsifies it.
--
-- What IS reused is the SHAPE, not the table: the row is filed under the
-- RESOURCE's container, the read predicate carries no `workspace_id` term, and
-- the SQL predicate has a TypeScript twin — `20260914120000`'s rule 3 and
-- `20260923140000`'s "NO `workspace_id` TERM" paragraph, applied.
--
-- ═══ 🔒 THE LADDER IS ONE COLUMN, AND THAT IS WHY THERE IS NO SECOND CHECK ══
--
-- `none < view < edit` is a LADDER (spec I2: *"`edit` ⇒ `view`: one ladder
-- compared by rank, never two booleans"*). **A single column holding a rung
-- CANNOT be `edit` without being `view`** — the implication is structural, so a
-- second CHECK stating it would be one rule written twice, which is the shape
-- this tree keeps filing bugs about. What CAN drift is the RANKING, so the rank
-- is a function (`dopl_ontology_level_rank`, in `20261001130000`) and its `CASE`
-- is asserted there. The CHECK below pins the WORDS; the rank pins the ORDER.
--
-- ⚠ `agents_may_edit` DEFAULTS `true` because Samuel's solo default is
-- *"automatically viewable and editable by their agents"*; the toggle only ever
-- narrows. It is also the SEED for `owner_agents_level` at the first share
-- (Q2 — the seeding is the writer's job, in S3, not a column default here: a
-- default cannot read another table).
--
-- ⚠ **`DEFAULT` IS THE BACKFILL, TWICE OVER.** `agents_may_edit true` and
-- `last_edited_source 'user'` satisfy every existing row the moment the columns
-- exist — the shape `access_mode`'s `DEFAULT 'workspace'` established in
-- `20260611020000` and `scope_kind`'s in `20260930150000`. No backfill statement,
-- and none is needed.
--
-- ═══ Q1-Q6, AS SAMUEL RULED THEM (2026-09-09) ══════════════════════════════
--
--   Q1  A member's or guest's AGENTS inherit EXACTLY that person's level. No
--       per-member agent column, and no cap column is needed beyond equality.
--       Only the OWNER gets a control: `owner_agents_level` per channel, plus
--       the per-ontology solo toggle (`agents_may_edit`).
--   Q2  First share seeds `owner_agents_level` from the toggle. A SOLO channel
--       that gains a member drops the owner's agents to `view` until the owner
--       says otherwise — hence `DEFAULT 'view'` on that column.
--   Q3  Revocation is IMMEDIATE (the row is DELETEd — `none` is a stored level,
--       never the way to unshare) and edits already made STAY, attributed. That
--       attribution is the `last_edited_by` / `last_edited_source` pair below.
--   Q4  Deleting a shared ontology, or the channel, cascades the share rows by
--       FK. Both FKs are `ON DELETE CASCADE` and the `DO $$` asserts it.
--   Q5  HOME CHANNELS ONLY. A `kind='standard'` workspace channel is refused —
--       and it is refused AT REST, by the trigger, not only by S3's 400. A rule
--       the route alone holds is a rule PostgREST does not hold.
--   Q6  "Version control" for now is `last_edited_by` + `last_edited_source`;
--       a per-edit history table is a later wave.
--
-- ═══ NOT A REALTIME CHANGE, AND IT ASSERTS WHAT IT DID NOT TOUCH ═══════════
--
-- `ontology_clusters` / `_objects` / `_memberships` / `_relationships` are all
-- published (`20260717000000`) and carry `REPLICA IDENTITY USING INDEX`
-- (`20260807150000`). Adding a nullable/defaulted column simply appears in the
-- frames the client already receives. The new table joins NO publication: a
-- share row is settings, and `useOntologyRealtime` subscribes per workspace
-- (spec R7). The closing `DO $$` re-checks both rather than trusting them.
--
-- ═══ ROLLBACK — PROSE, NOT COMMENTED-OUT SQL ═══════════════════════════════
--
-- (`dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this
-- directory WITHOUT stripping comments, so commented-out DDL here is a live
-- statement to that scanner.)
--
-- ⚠ **ORDERING TRAP, and it runs the OTHER way from `20260930150000`'s.** Drop
-- `20261001130000` FIRST — its four SELECT policies call `dopl_ontology_readable`,
-- which reads `ontology_channel_shares`; dropping the table first leaves four
-- policies whose function 42P01s on every read, i.e. the whole ontology feature
-- returns errors instead of rows. So: re-run `20260720211005`'s four ontology
-- SELECT policies, `DROP FUNCTION` the FIVE in `20261001130000` (the ladder, the
-- share level, the cluster walk, and the two predicates — that file's own
-- rollback prose counts them, and "four" here was this header miscounting them),
-- and only THEN `DROP TABLE public.ontology_channel_shares`. The three added columns may be
-- dropped at any time (nothing reads them once the code is rolled back), and
-- dropping them LOSES the attribution Q3 promises — leave them if in doubt.

-- ── 1. The solo toggle, on the ontology itself ──────────────────────────────
ALTER TABLE public.ontology_clusters
  ADD COLUMN IF NOT EXISTS agents_may_edit BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.ontology_clusters.agents_may_edit IS
  'Samuel 2026-09-09 (spec I3/Q2): may the OWNER''s agents edit this ontology in a SOLO channel. Default true — the toggle only narrows. Also the seed for ontology_channel_shares.owner_agents_level at the FIRST share; a channel that later gains a peer never rewrites an existing row.';

-- ── 2. Attribution — Q6, the literal the knowledge lane already stamps ──────
-- ⚠ `('user','agent')` is the SAME two-word CHECK as `knowledge_bases`
-- (`20260501000000`) and `skills` (`20260501090000`). A third word here would be
-- a third vocabulary for one question. Naming WHICH agent is deferred: a template
-- id on an ontology row is a second identity model.
ALTER TABLE public.ontology_clusters
  ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ontology_clusters
  ADD COLUMN IF NOT EXISTS last_edited_source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE public.ontology_objects
  ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ontology_objects
  ADD COLUMN IF NOT EXISTS last_edited_source TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ontology_clusters_last_edited_source_check') THEN
    ALTER TABLE public.ontology_clusters
      ADD CONSTRAINT ontology_clusters_last_edited_source_check
        CHECK (last_edited_source IN ('user', 'agent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ontology_objects_last_edited_source_check') THEN
    ALTER TABLE public.ontology_objects
      ADD CONSTRAINT ontology_objects_last_edited_source_check
        CHECK (last_edited_source IN ('user', 'agent'));
  END IF;
END $$;

-- ⚠ NO INDEX on either column, deliberately (this section's own rule). Nothing
-- queries BY editor: both are read off a row the caller already fetched by id.

-- ── 3. The share row — one per (ontology, channel) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.ontology_channel_shares (
  ontology_id  UUID NOT NULL REFERENCES public.ontology_clusters(id) ON DELETE CASCADE,
  channel_id   UUID NOT NULL REFERENCES public.channels(id)          ON DELETE CASCADE,
  -- 🔒 THE **ONTOLOGY's** CONTAINER, NEVER THE CHANNEL's — `20260914120000`'s
  -- rule 3, restated here because it is the line that makes the cross-container
  -- lend work AND makes the cascade cover a deleted personal container. The
  -- trigger below asserts it rather than trusting the writer.
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id)        ON DELETE CASCADE,
  members_level      TEXT NOT NULL DEFAULT 'view',
  guests_level       TEXT NOT NULL DEFAULT 'none',
  owner_agents_level TEXT NOT NULL DEFAULT 'view',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ontology_id, channel_id),
  -- ⚠ ONE CHECK, THREE COLUMNS, and the ladder needs no second one — see the
  -- header. `none` is a STORED value and is the same answer as an absent row
  -- (spec I4); UNSHARING IS A ROW DELETE, never a level.
  CONSTRAINT ontology_share_levels_check CHECK (
    members_level      IN ('none', 'view', 'edit')
    AND guests_level   IN ('none', 'view', 'edit')
    AND owner_agents_level IN ('none', 'view', 'edit'))
);

COMMENT ON TABLE public.ontology_channel_shares IS
  'One ontology lent to one home channel, at three independent levels (spec §3.1). A REFERENCE, never a copy: one object, and an edit reaches everyone it is lent to. Deleting the row IS the unshare; `none` is a stored level and means the same as absence for that audience.';
COMMENT ON COLUMN public.ontology_channel_shares.workspace_id IS
  'The ONTOLOGY''s container, never the channel''s (20260914120000 rule 3) — enforced by assert_ontology_share_scope().';
COMMENT ON COLUMN public.ontology_channel_shares.owner_agents_level IS
  'The OWNER''s agents in THIS channel. Q1: nobody else gets a per-agent column — a member''s or guest''s agents inherit exactly that person''s level. Q2: seeded from ontology_clusters.agents_may_edit at the first share; DEFAULT ''view'' is the drop a solo channel takes when it gains a peer.';

-- ── 4. Indexes — one named statement each (this section's rule) ─────────────
-- The PK's leading column already serves "every channel this ontology is lent
-- to" (the share popup's one read) and the `ontology_clusters` cascade.
--
--   `_channel_idx`   → `repository-shares.ts › listSharesForChannels` (S2), the
--                      read behind /home's SHARED IN THIS CHANNEL section, plus
--                      the `channels` FK cascade (Q4).
--   `_workspace_idx` → the `workspaces` FK cascade on account/container delete.
--                      An unindexed child of a cascading FK is a seq scan per
--                      parent DELETE — the defect `20260802180000` exists to
--                      close, applied here rather than repeated later.
CREATE INDEX IF NOT EXISTS ontology_channel_shares_channel_idx
  ON public.ontology_channel_shares (channel_id);
CREATE INDEX IF NOT EXISTS ontology_channel_shares_workspace_idx
  ON public.ontology_channel_shares (workspace_id);

-- ── 5. The scope assertion — TWO arms, both refusable AT REST ───────────────
--
-- 🔒 A ROUTE-ONLY RULE IS NOT A RULE: PostgREST is a second door, and both of
-- these are facts about the ROW rather than about the request that wrote it.
--   Arm 1  `workspace_id` IS the ontology's container. A wrong one would file
--          the share under the CHANNEL's container, where the cascade on the
--          owner's personal container would miss it and the row would outlive
--          the ontology's home.
--   Arm 2  Q5 — HOME CHANNELS ONLY. `workspaces.kind = 'link'` is the positive
--          form (INVARIANTS §4A, F-295); asking `<> 'standard'` would silently
--          admit every kind added to the union later, `personal` included.
CREATE OR REPLACE FUNCTION public.assert_ontology_share_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner_workspace uuid;
  v_channel_kind    text;
BEGIN
  SELECT c.workspace_id INTO v_owner_workspace
    FROM public.ontology_clusters c WHERE c.id = NEW.ontology_id;
  IF v_owner_workspace IS NULL THEN
    RAISE EXCEPTION 'ontology_channel_shares: ontology % does not exist', NEW.ontology_id;
  END IF;
  IF NEW.workspace_id <> v_owner_workspace THEN
    RAISE EXCEPTION
      'ontology_channel_shares.workspace_id must be the ONTOLOGY''s container (% ), not %',
      v_owner_workspace, NEW.workspace_id;
  END IF;

  SELECT w.kind INTO v_channel_kind
    FROM public.channels ch
    JOIN public.workspaces w ON w.id = ch.workspace_id
   WHERE ch.id = NEW.channel_id;
  IF v_channel_kind IS NULL THEN
    RAISE EXCEPTION 'ontology_channel_shares: channel % does not exist', NEW.channel_id;
  END IF;
  IF v_channel_kind <> 'link' THEN
    RAISE EXCEPTION
      'ontology_channel_shares: home channels only (Q5) — channel % is in a % container',
      NEW.channel_id, v_channel_kind;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assert_ontology_share_scope() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ontology_channel_shares_assert_scope') THEN
    CREATE TRIGGER ontology_channel_shares_assert_scope
      BEFORE INSERT OR UPDATE ON public.ontology_channel_shares
      FOR EACH ROW EXECUTE FUNCTION public.assert_ontology_share_scope();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ontology_channel_shares_touch_updated_at') THEN
    CREATE TRIGGER ontology_channel_shares_touch_updated_at
      BEFORE UPDATE ON public.ontology_channel_shares
      FOR EACH ROW EXECUTE FUNCTION public.touch_knowledge_updated_at();
  END IF;
END $$;

-- ── 6. RLS — a SELECT twin, and NO write surface ───────────────────────────
--
-- 🔒 THE READ IS THE OWNER'S CONTAINER (spec §3.3, `via`
-- `is_current_workspace_member`), NOT the channel's, and that is the fail-closed
-- reading: the row says who a channel's people may reach, so the row itself is
-- the OWNER's settings. A channel member needs the ontology, never the setting;
-- their read arrives through `dopl_ontology_readable`, which is SECURITY DEFINER
-- and reads this table past its own policy.
--
-- ⚠ `is_current_workspace_member` (2-arg), NEVER `is_workspace_member` (3-arg):
-- the 3-arg form lets the CALLER supply the user id and is the membership oracle
-- M-9 closed (`20260720211005`).
--
-- 🔒 WRITES ARE REVOKED, not policed. There is no write policy and no DML grant,
-- so PostgREST cannot write a share row for ANY login role. The write door is
-- `service-shares.ts` (S3) on the service-role client, fenced `sessionOnly` — an
-- agent token must not widen its own operator's audience.
ALTER TABLE public.ontology_channel_shares ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.ontology_channel_shares FROM anon, authenticated;

DROP POLICY IF EXISTS ontology_channel_shares_member_select ON public.ontology_channel_shares;
CREATE POLICY ontology_channel_shares_member_select ON public.ontology_channel_shares
  FOR SELECT
  USING (public.is_current_workspace_member(workspace_id, 'viewer'::text));

-- ── 7. Verification (INVARIANTS §12) ───────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  -- Q4: BOTH cascades, or a deleted ontology/channel leaves a live share row
  -- pointing at nothing and the "confirm names the channel COUNT" dialog lies.
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'public.ontology_channel_shares'::regclass
     AND contype = 'f' AND confdeltype = 'c';
  IF n <> 3 THEN
    RAISE EXCEPTION
      'ontology_channel_shares: expected 3 ON DELETE CASCADE foreign keys (ontology, channel, workspace), found %', n;
  END IF;

  -- The ladder's three words, all present, on all three columns.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ontology_share_levels_check'
       AND pg_get_constraintdef(oid) LIKE '%''none''%'
       AND pg_get_constraintdef(oid) LIKE '%''view''%'
       AND pg_get_constraintdef(oid) LIKE '%''edit''%'
  ) THEN
    RAISE EXCEPTION 'ontology_share_levels_check lost a rung of the none<view<edit ladder';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ontology_channel_shares_assert_scope') THEN
    RAISE EXCEPTION 'assert_ontology_share_scope trigger missing — workspace_id and Q5 are unenforced at rest';
  END IF;

  -- 🔒 NO WRITE SURFACE, in either of the two ways it could appear.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ontology_channel_shares'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'ontology_channel_shares gained a non-SELECT policy — the write lane is service-role only';
  END IF;
  IF has_table_privilege('authenticated', 'public.ontology_channel_shares', 'INSERT')
     OR has_table_privilege('anon', 'public.ontology_channel_shares', 'INSERT') THEN
    RAISE EXCEPTION
      'ABORT: ontology_channel_shares is still INSERT-able by anon/authenticated after the revoke — something else (PUBLIC, or another granted role) holds the privilege';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ontology_channel_shares', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: service_role cannot read ontology_channel_shares — every repository select would 42501';
  END IF;

  -- NOT a realtime change: the four ontology tables keep their publication
  -- membership and their replica identity, and the new table joins neither.
  IF (SELECT count(*) FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename IN ('ontology_clusters', 'ontology_objects',
                           'ontology_memberships', 'ontology_relationships')) <> 4 THEN
    RAISE EXCEPTION 'an ontology table left supabase_realtime — this migration must not touch the publication';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                AND tablename = 'ontology_channel_shares') THEN
    RAISE EXCEPTION 'ontology_channel_shares joined supabase_realtime — a share row is settings, not a live surface';
  END IF;
  IF (SELECT count(*) FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname IN ('ontology_clusters', 'ontology_objects',
                         'ontology_memberships', 'ontology_relationships')
         AND relreplident <> 'i') <> 0 THEN
    RAISE EXCEPTION 'an ontology table lost REPLICA IDENTITY USING INDEX (20260807150000) — hard-delete frames stop reaching the client';
  END IF;

  RAISE NOTICE 'ontology_home_shares: ontology_channel_shares created (service-role writes, one SELECT twin), agents_may_edit + last_edited_{by,source} added; publication and replica identity unchanged';
END $$;
