-- ONTOLOGY IN THE HOME SPACE, PART 2 — the READ RULE, written ONCE, and the
-- four SELECT policies that defer to it (2026-09-09, `docs/specs/home-ontology.md`
-- §3.2/§3.3, slice S1).
--
-- ⚠️ **WRITTEN, NOT APPLIED** — this directory's standing gate. Replay is OWED
-- and recorded rather than glossed (Docker is unavailable on the authoring
-- machine; CI's `rls-redteam` job is the replay, INVARIANTS §14).
--
-- 🔒 **APPLY IT BY NAME (`ontology_readable`), NEVER BY FILENAME VERSION**
-- (F-304's re-stamp, INVARIANTS §12).
--
-- **APPLY ORDER: IMMEDIATELY AFTER `ontology_home_shares` (`20261001120000`)**,
-- which creates the table every function below reads. Before that:
-- `agent_template_knowledge_scopes` (`20260930150000`).
--
-- ═══ IDEMPOTENT, AND NO POLICY TOPOLOGY MOVES ══════════════════════════════
--
-- Five `CREATE OR REPLACE FUNCTION`s and four `DROP … ; CREATE POLICY` pairs
-- re-stating the SAME FOUR POLICY NAMES `20260720211005` last wrote. **No policy
-- is added and none is dropped**, so `scripts/check-rls-pair-gate.ts` check 3
-- (live SELECT set EQUALS declared set) stays satisfiable and the write policies
-- are untouched. ⚠ **REPLACED WHOLE, NOT WRAPPED** — a wrapper would be a third
-- place the matrix lives (`20260923140000`'s argument).
--
-- ═══ 🔒 THIS FILE ONLY EVER WIDENS ═════════════════════════════════════════
--
-- Every replaced policy KEEPS its `is_current_workspace_member(workspace_id,
-- 'viewer')` arm verbatim and gains an OR. Ontology has been WORKSPACE-scoped
-- since `20260706120000` (spec R1–R4), so narrowing the container arm would blank
-- every standard-workspace board for a sharing feature those boards do not use.
-- **The narrowing Samuel's matrix asks for is the SERVICE's job** (spec I6/§4:
-- `resolveOntologyAudience`, S2); RLS's job here is that a NON-MEMBER with a
-- share reaches exactly what the share says.
--
-- ═══ 🔒 THE ARM IS AN `OR` BESIDE THE MEMBERSHIP GROUP, NEVER A TERM IN IT ══
--
-- A share's grantee is by definition NOT a member of the ontology's container, so
-- an arm conjoined with `is_current_workspace_member` could only narrow and the
-- share would be a row nothing reads — the defect `20260923140000` §3b records
-- for the knowledge children. Pinned here in both directions.
--
-- ═══ 🔒 NO `workspace_id` TERM IN THE SHARE ARM ════════════════════════════
--
-- The share row is filed under the ONTOLOGY's container while the caller reaches
-- it through the CHANNEL's, so a `workspace_id` predicate would refuse precisely
-- the cross-container lend (`20260914120000` rule 3). The two membership tests
-- inside `dopl_ontology_share_level` are the fence, both caller-pinned.
--
-- ═══ 🔒 A SHARED CREDENTIAL IS NEVER WIDENED BY A SHARE ════════════════════
--
-- `NOT public.dopl_credential_is_shared()` rides the share arm, as it rides
-- `dopl_grant_admits` in `dopl_knowledge_base_readable`: a credential standing for
-- nobody has no membership of the channel to read the share THROUGH. ⚠ A CONJUNCT
-- OF THE ARM, not a term at the top — at the top it would also refuse a shared
-- credential the container arm already admits, narrowing M-10.
--
-- ═══ 🔒 CALLER-PINNED, TWICE, AND NEITHER IS OPTIONAL ══════════════════════
--
--   `is_channel_member(channel_id)`             — is the caller IN THE ROOM.
--   `workspace_members.role` in the channel's container — WHICH CLASS they are,
--                                                 `guest` or member-and-above.
--
-- Both read `(SELECT auth.uid())` and neither takes a user id from the caller —
-- the 3-arg `is_workspace_member` is the membership oracle M-9 closed, and no
-- function here may grow a subject parameter. **That is also why EXECUTE is
-- granted to `authenticated`** rather than revoked like `presence_heartbeat_all`'s
-- (`20260930140000`): that one takes a caller-supplied subject, so its grant IS
-- its fence. These do not, so the fence is the body.
--
-- ═══ THE LADDER, AS A FUNCTION ═════════════════════════════════════════════
--
-- `none(0) < view(1) < edit(2)`, and ANY OTHER WORD IS -1 — the fail-closed
-- reading, and `20260825140000`'s choice when it gave `guest` the floor below
-- `viewer` rather than re-basing the scale. ⚠ IMMUTABLE, so the rank inlines and
-- the CHECK and the comparison cannot disagree about which is higher.
--
-- ═══ 🔒 R5 — AN OBJECT SITS IN SEVERAL CLUSTERS, SO A CHILD'S REACH IS A WALK ══
--
-- `ontology_objects` / `_memberships` / `_relationships` are WORKSPACE-keyed and
-- carry no `cluster_id` (spec R3/R5): a card's membership row names a PARENT
-- OBJECT, and only a column's row names the cluster. So the child policies reach
-- the cluster through `ontology_memberships` — `dopl_ontology_object_clusters`
-- walks UP the parent chain, and the policy asks `dopl_ontology_readable` about
-- EACH cluster it answers (Q9's READ half: readable if ANY is). ⚠ `UNION`, not
-- `UNION ALL` — the de-duplication is what terminates a cycle, and the table's
-- only structural guard is a self-edge CHECK.
--
-- ⚠ **`dopl_ontology_writable` IS NOT CALLED BY ANY POLICY, STATED RATHER THAN
-- HIDDEN.** The write policies stay at `is_current_workspace_member(workspace_id,
-- 'editor')` — moving a write surface is policy topology, not this slice. It
-- exists so the WRITE half of Samuel's matrix is written in SQL beside the read
-- half (TS twin: `ontology/server/service-shared.ts › canEditOntology`; Q9's
-- write half is resolved in the service, the only layer that sees every cluster
-- at once). The closing `DO $$` asserts it exists and is `SECURITY DEFINER`.
--
-- ⚠ **NOT A REALTIME CHANGE** — no column, no publication membership, no replica
-- identity, no table. The closing `DO $$` re-checks the publication and the
-- replica identity anyway: "this migration did not touch it" is worth asserting.
--
-- ⚠ **REALTIME NOW REFUSES LESS, NOT MORE — THE ONE BEHAVIOURAL CONSEQUENCE
-- OUTSIDE THE FENCE.** Realtime evaluates these SELECT policies per subscriber,
-- so a channel peer subscribed to the OWNER's container now receives change
-- frames for a SHARED cluster's rows. Intended, and NOT a fix for spec R7 (a peer
-- still subscribes per WORKSPACE); that narrowing is the client's, in S2/S5.
--
-- ═══ ROLLBACK — PROSE, NOT COMMENTED-OUT SQL ═══════════════════════════════
--
-- No data changes, so rollback is pure DDL with ONE ordering trap: re-run
-- `20260720211005`'s four ontology SELECT policies FIRST, and only then
-- `DROP FUNCTION` the five below. Dropping the functions while the policies call
-- them leaves four policies that 42883 on every read — an outage, not a leak.
-- Rolling back `20261001120000` requires this file rolled back first.

-- ── 1. The ladder ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dopl_ontology_level_rank(p_level text)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_level
           WHEN 'edit' THEN 2
           WHEN 'view' THEN 1
           WHEN 'none' THEN 0
           ELSE -1
         END;
$function$;

COMMENT ON FUNCTION public.dopl_ontology_level_rank(text) IS
  'none(0) < view(1) < edit(2); any other word is -1 and admits nobody. The ORDER half of the ladder — ontology_share_levels_check pins the WORDS.';

-- ── 2. The caller's HUMAN level on one ontology, across every channel ──────
--
-- The MAXIMUM rung across the channels the caller is actually in, for the class
-- they hold in each — spec I5: the same ontology in two channels carries two
-- independent rows, and reaching it through either is reaching it.
CREATE OR REPLACE FUNCTION public.dopl_ontology_share_level(p_cluster_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT CASE max(
           public.dopl_ontology_level_rank(
             CASE WHEN wm.role = 'guest' THEN s.guests_level ELSE s.members_level END
           ))
           WHEN 2 THEN 'edit'
           WHEN 1 THEN 'view'
           ELSE 'none'
         END
    FROM public.ontology_channel_shares s
    JOIN public.channels ch ON ch.id = s.channel_id
    JOIN public.workspace_members wm
      ON wm.workspace_id = ch.workspace_id
     AND wm.user_id = (SELECT auth.uid())
     AND wm.status = 'active'
   WHERE s.ontology_id = p_cluster_id
     -- 🔒 Q3, AT REST: a revoked link or a removed member has no active
     -- `workspace_members` row, and a deleted channel is not a room. Access ends
     -- the moment either is true; the EDITS stay, attributed to their author.
     AND ch.deleted_at IS NULL
     AND public.is_channel_member(s.channel_id);
$function$;

COMMENT ON FUNCTION public.dopl_ontology_share_level(uuid) IS
  'The CALLER''s human level on one ontology: the max rung across the home channels they are in, guests read guests_level and everyone else members_level (Samuel Q1 — an agent inherits its operator''s cell, and that cap is the service''s, not this function''s).';

-- ── 3. Object → the clusters it belongs to (R5's walk) ─────────────────────
--
-- ⚠ SECURITY DEFINER because the walk reads `ontology_memberships`, whose own
-- SELECT policy calls back into this file: an invoker-rights walk would recurse.
-- ⚠ IT IS A UUID→UUID MAPPING AND NOTHING ELSE. A caller who guesses an object
-- id learns opaque cluster ids and no content — `dopl_ontology_readable` still
-- answers false for every one of them. That is the same bound
-- `dopl_grant_admits(text, uuid)` accepts for the same reason.
CREATE OR REPLACE FUNCTION public.dopl_ontology_object_clusters(p_object_id uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  WITH RECURSIVE ancestors(object_id) AS (
    SELECT p_object_id
    UNION
    SELECT m.parent_object_id
      FROM public.ontology_memberships m
      JOIN ancestors a ON m.child_object_id = a.object_id
     WHERE m.parent_object_id IS NOT NULL
  )
  SELECT DISTINCT m.cluster_id
    FROM public.ontology_memberships m
    JOIN ancestors a ON m.child_object_id = a.object_id
   WHERE m.cluster_id IS NOT NULL;
$function$;

-- ── 4. The sentence, twice: may the caller READ it / WRITE it ──────────────
CREATE OR REPLACE FUNCTION public.dopl_ontology_readable(p_cluster_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.ontology_clusters c
     WHERE c.id = p_cluster_id
       AND (
         -- Arm 1 — the container, `20260706120000`'s rule, unchanged in meaning
         -- and caller-pinned. In a `personal` container its only member is the
         -- OWNER, which is why the matrix's "a share never narrows the owner"
         -- needs no arm of its own.
         public.is_current_workspace_member(c.workspace_id, 'viewer'::text)
         -- Arm 2 — the share, OR-ed onto a CLOSED group, carrying the
         -- shared-credential refusal with it.
         OR (
           NOT public.dopl_credential_is_shared()
           AND public.dopl_ontology_level_rank(
                 public.dopl_ontology_share_level(c.id)
               ) >= 1
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.dopl_ontology_writable(p_cluster_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.ontology_clusters c
     WHERE c.id = p_cluster_id
       AND (
         public.is_current_workspace_member(c.workspace_id, 'editor'::text)
         OR (
           NOT public.dopl_credential_is_shared()
           AND public.dopl_ontology_level_rank(
                 public.dopl_ontology_share_level(c.id)
               ) >= 2
         )
       )
  );
$function$;

-- ⚠ NONE of these takes a caller-supplied SUBJECT, so `authenticated` may hold
-- EXECUTE (the `dopl_grant_admits` shape). A function here that ever grows a
-- `p_user_id` must lose that grant in the same change.
REVOKE ALL ON FUNCTION public.dopl_ontology_level_rank(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dopl_ontology_share_level(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dopl_ontology_object_clusters(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dopl_ontology_readable(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dopl_ontology_writable(uuid)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_level_rank(text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_share_level(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_object_clusters(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_readable(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_writable(uuid)        TO authenticated, service_role;

-- ── 5. The four SELECT policies, re-stated whole ───────────────────────────
--
-- ⚠ NO `deleted_at` TERM ANYWHERE BELOW, in either the old bodies or the new:
-- trash is a repository filter, not a fence (the rule
-- `knowledge/server/rls-redteam.test.ts` states for `knowledge_bases`).
DROP POLICY IF EXISTS ontology_clusters_member_select ON public.ontology_clusters;
CREATE POLICY ontology_clusters_member_select ON public.ontology_clusters
  FOR SELECT
  USING (public.dopl_ontology_readable(id));

DROP POLICY IF EXISTS ontology_objects_member_select ON public.ontology_objects;
CREATE POLICY ontology_objects_member_select ON public.ontology_objects
  FOR SELECT
  USING (
    public.is_current_workspace_member(workspace_id, 'viewer'::text)
    OR EXISTS (
      SELECT 1
        FROM public.dopl_ontology_object_clusters(ontology_objects.id) AS cid
       WHERE public.dopl_ontology_readable(cid)
    )
  );

DROP POLICY IF EXISTS ontology_memberships_member_select ON public.ontology_memberships;
CREATE POLICY ontology_memberships_member_select ON public.ontology_memberships
  FOR SELECT
  USING (
    public.is_current_workspace_member(workspace_id, 'viewer'::text)
    OR (cluster_id IS NOT NULL AND public.dopl_ontology_readable(cluster_id))
    OR (parent_object_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM public.dopl_ontology_object_clusters(parent_object_id) AS cid
       WHERE public.dopl_ontology_readable(cid)
    ))
  );

-- 🔒 BOTH ENDPOINTS, AND-ed — Q8's boundary. An edge whose far end sits outside
-- every cluster the caller reaches would otherwise name an object they cannot
-- open, which is the raw-id leak spec R12 records for knowledge attributes.
DROP POLICY IF EXISTS ontology_relationships_member_select ON public.ontology_relationships;
CREATE POLICY ontology_relationships_member_select ON public.ontology_relationships
  FOR SELECT
  USING (
    public.is_current_workspace_member(workspace_id, 'viewer'::text)
    OR (
      EXISTS (
        SELECT 1
          FROM public.dopl_ontology_object_clusters(source_object_id) AS cid
         WHERE public.dopl_ontology_readable(cid)
      )
      AND EXISTS (
        SELECT 1
          FROM public.dopl_ontology_object_clusters(target_object_id) AS cid
         WHERE public.dopl_ontology_readable(cid)
      )
    )
  );

-- ── 6. Verification (INVARIANTS §12) ───────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  IF (SELECT count(*) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('dopl_ontology_level_rank', 'dopl_ontology_share_level',
                         'dopl_ontology_object_clusters', 'dopl_ontology_readable',
                         'dopl_ontology_writable')) <> 5 THEN
    RAISE EXCEPTION 'an ontology predicate function was not created';
  END IF;

  -- The ladder ORDERS, or every `>= 1` comparison above is decoration.
  IF NOT (public.dopl_ontology_level_rank('edit') > public.dopl_ontology_level_rank('view')
      AND public.dopl_ontology_level_rank('view') > public.dopl_ontology_level_rank('none')
      AND public.dopl_ontology_level_rank('none') = 0
      AND public.dopl_ontology_level_rank('sudo') < 0) THEN
    RAISE EXCEPTION 'dopl_ontology_level_rank no longer ranks none < view < edit, or an unknown word is not below the floor';
  END IF;

  -- 🔒 The share arm carries the shared-credential refusal. A policy that admits
  -- what its twin refuses is the whole failure the redteam suite exists to catch.
  IF (SELECT count(*) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('dopl_ontology_readable', 'dopl_ontology_writable')
         AND prosrc LIKE '%dopl_credential_is_shared%') <> 2 THEN
    RAISE EXCEPTION 'an ontology predicate lost the shared-credential refusal on its share arm';
  END IF;

  -- 🔒 Caller-pinned, and no subject parameter anywhere.
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE pronamespace = 'public'::regnamespace
                AND proname LIKE 'dopl_ontology_%'
                AND pg_get_function_identity_arguments(oid) LIKE '%p_user_id%') THEN
    RAISE EXCEPTION 'an ontology predicate grew a caller-supplied subject — revoke EXECUTE from authenticated first (20260930140000''s rule)';
  END IF;
  IF (SELECT count(*) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('dopl_ontology_share_level', 'dopl_ontology_object_clusters',
                         'dopl_ontology_readable', 'dopl_ontology_writable')
         AND prosecdef) <> 4 THEN
    RAISE EXCEPTION 'an ontology predicate lost SECURITY DEFINER — the memberships walk would recurse into its own policy';
  END IF;

  -- 🔒 Every child policy DEFERS to the parent's rule and states none of its own.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ontology_clusters', 'ontology_objects',
                       'ontology_memberships', 'ontology_relationships')
     AND cmd = 'SELECT'
     AND qual LIKE '%dopl_ontology_readable%';
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 ontology SELECT policies reaching dopl_ontology_readable, found %', n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('ontology_clusters', 'ontology_objects',
                         'ontology_memberships', 'ontology_relationships')
       AND cmd = 'SELECT'
       AND qual LIKE '%ontology_channel_shares%'
  ) THEN
    RAISE EXCEPTION 'an ontology SELECT policy reads ontology_channel_shares directly — the share rule is stated ONCE, in dopl_ontology_share_level';
  END IF;

  -- NOT a realtime change, asserted rather than trusted.
  IF (SELECT count(*) FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename IN ('ontology_clusters', 'ontology_objects',
                           'ontology_memberships', 'ontology_relationships')) <> 4 THEN
    RAISE EXCEPTION 'an ontology table left supabase_realtime — this migration must not touch the publication';
  END IF;
  IF (SELECT count(*) FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname IN ('ontology_clusters', 'ontology_objects',
                         'ontology_memberships', 'ontology_relationships')
         AND relreplident <> 'i') <> 0 THEN
    RAISE EXCEPTION 'an ontology table lost REPLICA IDENTITY USING INDEX (20260807150000)';
  END IF;

  RAISE NOTICE 'ontology_readable: 5 functions created, 4 SELECT policies re-stated whole; write policies, publication and replica identity unchanged';
END $$;
