-- ============================================================================
-- RLS PHASE 2 — the policy becomes the fence for the next FOUR tables
-- (Wave B slice B12 / `v2/b-rls-real-2`; Samuel's ruling B5)
-- ============================================================================
--
-- ⚠ NEVER APPLIED. Docker is down on the authoring machine (`docker info`
-- fails), so `supabase start` could not run and this file has NOT been replayed
-- against a database. Written to be idempotent and to be applied with the rest
-- of Wave B's migrations, after Wave A's seven, which are also unapplied. The
-- live redteam cases are skipped-with-reason for exactly this reason, as
-- `20260919120000`'s were.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS COVERS, AND THE RUNNING TOTAL
-- ---------------------------------------------------------------------------
-- Phase 1 (`20260919120000`) covered `knowledge_bases`, `knowledge_folders`,
-- `knowledge_entries`. This file covers `skills`, `agent_templates`, `chats`
-- and `resource_grants` — the spec's target of SEVEN — plus the one CHILD
-- table that restates a covered parent's matrix inline (`chat_messages`; the
-- `skill_files` half was WITHDRAWN — that table was dropped in July 2026 and a
-- policy on it would have aborted the apply, F-586). The child is not new
-- coverage; it is the same rule,
-- and leaving them behind would leave a child policy WIDER than the parent it
-- guards, which is the 2026-08-26 entry-body incident (INVARIANTS §4) in a new
-- table. `chat_messages` is not optional in a second way: `chats/server/
-- repository.ts › listVisibleChats` selects `*, chat_messages(count)`, so under
-- a caller-scoped client the EMBEDDED count is filtered by that child policy —
-- a wider child would publish a message count for a transcript the caller may
-- not read.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FIXES — four policy-WIDER-than-predicate gaps, all the same shape
-- ---------------------------------------------------------------------------
-- Each of these tables states its visibility rule TWICE: once as a TS predicate
-- that is the real fence (every repository read goes through the service role,
-- which bypasses RLS), once as a policy that decides nothing. Measured against
-- the replayed final state at `1a0283f7`:
--
--  1. **`skills` admits a SHARED CREDENTIAL to a private row.** The live body is
--     `is_current_workspace_member(workspace_id,'viewer') AND (visibility =
--     'public' OR created_by = auth.uid())` (`20260720211005`). `service-shared.ts
--     › canSeeSkill` arm 2 refuses a credential standing for NOBODY IN
--     PARTICULAR (M-10/F-336) before it ever reaches the creator arm.
--  2. **`skills` says nothing about `access_mode = 'teams'`.** A `public` +
--     `teams` skill is narrowed by `canSeeSkill` to its creator, workspace
--     admins and members of a granted team; the policy hands it to every viewer.
--     `20260708150001` said so at the time — *"skills_member_select stays (public
--     OR owner) — team scoping [is] enforced in the service"* — which was true
--     while the service was the only reader and is a leak the moment it is not.
--  3. **`chats` hands EVERY PRIVATE TRANSCRIPT to a workspace admin.**
--     `chats_member_select` leads with a blanket
--     `is_current_workspace_member(workspace_id,'admin')`; `canSeeChat` returns
--     false for `visibility <> 'public'` BEFORE its admin arm, so the API has
--     never returned those rows. `20260916120000`'s probe P2 records the arm as
--     deliberate — it is corrected here, not deleted, because ruling B5 asks the
--     policy to EQUAL the predicate and `agent_templates` already made the same
--     correction (`20260915120000`: *"the admin arm is INSIDE the 'team' branch
--     … moving it out is a widening"*). ⚠ NO PRODUCT BEHAVIOUR MOVES: no read
--     path has ever returned an admin someone else's private chat.
--  4. **`chats_owner_select` is an unfenced `owner_id = auth.uid()`** — no
--     membership floor and no credential axis, so a shared credential minted for
--     a user, or a user removed from the workspace, reads that user's private
--     transcripts. Both policies are restated onto the one predicate below.
--  5. **`agent_templates` has no shared-credential arm.**
--     `can_current_user_read_agent_template` (`20260915120000`) states
--     `canSeeTemplate`'s arms 1, 3, 4, 5 and 6 and omits arm 2. It is REPLACED
--     in place (one `CREATE OR REPLACE`; no policy moves), which is the whole
--     reason B1 made it a function.
--
-- `resource_grants` needs no repair: `resource_grants_member_select`
-- (`20260914120000`) was written this wave with the caller lane in mind and
-- already carries the guest floor and the channel-scope narrowing. It is covered
-- by this slice's read moves, its redteam case and its pair-gate row, not by a
-- rewrite.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES *NOT* DO — unchanged from phase 1, and for the same reasons
-- ---------------------------------------------------------------------------
-- * **No policy is deleted.** Every SELECT policy keeps its NAME and is replaced
--   in place. A policy is the record of a leak that was once possible
--   (`20260716150000` is this repo's standing example, and it is a CHATS one);
--   tenancy risk 1 says they are corrected, never removed.
-- * **No TS predicate is deleted.** `canSeeSkill`, `canSeeTemplate`, `canSeeChat`
--   and `canSeeBaseRow` all stay until the flag has been on for a release; B16
--   deletes each one behind its own green redteam test.
-- * **INSERT / UPDATE / DELETE policies are untouched.** Writes stay on the
--   service role until RLS plan phase 4. ⚠ F-573 named two `skill_files` write
--   policies still on the 3-arg `is_workspace_member(ws, auth.uid(), …)` form;
--   they went with the table in July 2026 (F-586) and the finding is moot.
-- * **The AGENT AUDIENCE CEILING is still not in any policy** (F-524): a
--   per-request bound keyed on the container's kind, its live member count and a
--   session-scoped header is not a property of a row, and folding it in would put
--   a forgeable narrowing input into a policy. `service-audience.ts ›
--   audienceAdmits` MUST NOT be deleted with `canSeeBase`.
--
-- ⚠ PERFORMANCE. Every predicate below is SECURITY DEFINER, so the planner will
-- not inline it: one PK lookup per candidate row, plus — only on the arm that
-- reaches it, because Postgres short-circuits `OR`/`AND` — one indexed probe of
-- `resource_grants` (`resource_grants_resource_idx`) joined to `team_members`
-- (`team_members_user_idx`). Both indexes already exist, as do the two PKs and
-- `chat_messages`' own `chat_id` index, so
-- this file adds none. The RLS plan's "measure with realistic data" gate applies
-- at rollout; the flag is the mitigation if it does not hold.
--
-- ROLLBACK: turn `RLS_CALLER_SCOPED_READS` off — every read returns to the
-- service-role client and nothing below is consulted. To revert the SQL itself,
-- recreate `skills_member_select` with the body
-- in `20260720211005`, `chats_member_select` and
-- `chat_messages_select` with the bodies in `20260916120000`, `chats_owner_select`
-- with `20260720211005`'s, and re-run `20260915120000`'s
-- `can_current_user_read_agent_template`.
-- ============================================================================


-- ===========================================================================
-- STEP 1 — THE `public`/`teams` MATRIX, WRITTEN ONCE
-- ===========================================================================
-- `canSeeSkill` and `canSeeChat` are the SAME matrix over differently-named
-- columns — both files say so in their own docblocks ("Same model as
-- canSeeChat") — so it is one function here rather than two policy bodies:
--
--   1. `public` + workspace mode          -> every viewer, shared credential
--                                            included (nothing personal in it)
--   2. a SHARED credential                -> NOTHING further (M-10/F-336)
--   3. the owner/creator                  -> always
--   4. anything not `public`              -> nobody else, ADMINS INCLUDED
--   5. `public` + `teams`                 -> workspace admin, or a member of a
--                                            granted team
--
-- ⚠ ARM 4 BEFORE ARM 5 IS THE WHOLE OF "PRIVATE MEANS PRIVATE", and it is the
-- arm `chats_member_select` did not have. An admin administers SHARING, which is
-- why they pass on a teams-mode row; that is not a licence to read a member's
-- private transcript. `canSeeTemplate` and
-- `can_current_user_read_agent_template` already order it this way.
--
-- ⚠ ARMS 4+5 REUSE `dopl_teams_mode_visible()` (`20260919120000` STEP 3) RATHER
-- THAN RESTATING ITS `EXISTS`. That function is the teams axis, `scope_type`
-- term and all — without that term a CHANNEL grant on the same resource would
-- answer a workspace-wide read (F-468). Its own creator arm is redundant here
-- (arm 3 already fired) and left alone: one function, one statement.
--
-- ⚠ IT IS CALLED INSIDE THE BOOLEAN CHAIN, NEVER PASSED AS AN ARGUMENT.
-- Postgres evaluates arguments eagerly, so a `p_teams_visible boolean` parameter
-- would run the grant probe for every `public`/`workspace` row in the workspace.
-- Short-circuiting is why this takes the resource's identity instead.
CREATE OR REPLACE FUNCTION public.dopl_public_teams_admits(
  p_workspace_id  uuid,
  p_visibility    text,
  p_access_mode   text,
  p_owner         uuid,
  p_resource_type text,
  p_resource_id   uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
AS $function$
  SELECT
    (p_visibility = 'public' AND p_access_mode IS DISTINCT FROM 'teams')
    OR (
      NOT public.dopl_credential_is_shared()
      AND (
        p_owner = (SELECT auth.uid())
        OR (
          p_visibility = 'public'
          AND public.dopl_teams_mode_visible(
                p_workspace_id, p_resource_type, p_resource_id, p_owner
              )
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.dopl_public_teams_admits(uuid, text, text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_public_teams_admits(uuid, text, text, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_public_teams_admits(uuid, text, text, uuid, text, uuid) TO service_role;


-- ===========================================================================
-- STEP 2 — "May the caller read this skill?" (`canSeeSkill`, one for one)
-- ===========================================================================
-- ⚠ `deleted_at` IS DELIBERATELY ABSENT, as in phase 1: soft-delete is a
-- repository filter, not a visibility rule, and a policy that hid trashed rows
-- would break restore for every caller at once.
CREATE OR REPLACE FUNCTION public.dopl_skill_readable(p_skill_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.skills s
     WHERE s.id = p_skill_id
       AND public.is_current_workspace_member(s.workspace_id, 'viewer')
       AND public.dopl_public_teams_admits(
             s.workspace_id, s.visibility, s.access_mode, s.created_by,
             'skill', s.id
           )
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_skill_readable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_skill_readable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_skill_readable(uuid) TO service_role;


-- ===========================================================================
-- STEP 3 — "May the caller read this chat?" (`canSeeChat`, one for one)
-- ===========================================================================
-- ⚠ THE OWNER IS `owner_id`, NOT `created_by` — the only difference between this
-- and STEP 2, which is why the matrix is a parameter list and not a copy.
CREATE OR REPLACE FUNCTION public.dopl_chat_readable(p_chat_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.chats c
     WHERE c.id = p_chat_id
       AND public.is_current_workspace_member(c.workspace_id, 'viewer')
       AND public.dopl_public_teams_admits(
             c.workspace_id, c.visibility, c.access_mode, c.owner_id,
             'chat', c.id
           )
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_chat_readable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_chat_readable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_chat_readable(uuid) TO service_role;


-- ===========================================================================
-- STEP 4 — the template matrix gains its MISSING arm, in place
-- ===========================================================================
-- `canSeeTemplate` has a THIRD visibility vocabulary (`workspace | team |
-- private`) and no `access_mode`, so it keeps its own predicate rather than
-- being bent into STEP 1. Two changes, both stated by `canSeeTemplate` and
-- neither previously in the SQL:
--
--   * **ARM 2, the missing one.** A SHARED credential stops after arm 1: it may
--     read a `workspace` template (nothing personal in one) and NOTHING else —
--     not the row it "created", not a team's. Without this, a container key
--     passed between humans read the key-minter's private templates by name.
--   * **the teams axis is now the shared function**, not a fourth inline
--     `EXISTS` over `resource_grants`. Same arms, same order, admin arm still
--     INSIDE the `team` branch — `20260915120000` is right that moving it out is
--     a widening, and this file does not move it.
CREATE OR REPLACE FUNCTION public.can_current_user_read_agent_template(
  p_template_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.agent_templates t
     WHERE t.id = p_template_id
       AND public.is_current_workspace_member(t.workspace_id, 'viewer'::text)
       AND (
         t.visibility = 'workspace'
         OR (
           NOT public.dopl_credential_is_shared()
           AND (
             t.created_by = (SELECT auth.uid())
             OR (
               t.visibility = 'team'
               AND public.dopl_teams_mode_visible(
                     t.workspace_id, 'agent_template', t.id, t.created_by
                   )
             )
           )
         )
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_current_user_read_agent_template(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_current_user_read_agent_template(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_current_user_read_agent_template(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_current_user_read_agent_template(uuid) TO service_role;


-- ===========================================================================
-- STEP 5 — the five SELECT policies, repaired in place
-- ===========================================================================
-- ⚠ SAME NAMES, SAME cmd, SAME (default) ROLES, so policy TOPOLOGY does not move
-- and the `canSee*` ↔ policy pair gate (`scripts/check-rls-pair-gate.ts`) keeps
-- finding its twin.
-- ⚠ The two `agent_templates` policies are NOT restated: both already call
-- `can_current_user_read_agent_template`, which STEP 4 replaced under them. That
-- is the payoff B1 bought by making the matrix a function.

-- ---- skills ---------------------------------------------------------------
DROP POLICY IF EXISTS skills_member_select ON skills;
CREATE POLICY skills_member_select ON skills
  FOR SELECT
  USING (public.dopl_skill_readable(id));

-- ---- skill_files: 🔒 THE TABLE DOES NOT EXIST (F-586) ----------------------
-- ⚠ **AND A `CREATE POLICY` ON IT WOULD HAVE ABORTED THIS MIGRATION** with
-- `relation "skill_files" does not exist`, on the first database it ever met.
-- `20260716064733_collapse_skill_files_into_skills.sql` §e ran
-- `DROP TABLE IF EXISTS skill_files CASCADE` — *"CASCADE takes its triggers +
-- RLS policies + realtime-publication membership"* — and nothing re-creates it.
-- `skills/types.ts` has said so in one line ever since: *"No `skill_files`
-- table — body lives in [skills]"*.
--
-- ⚠ **WHAT MADE IT SURVIVE REVIEW IS WORTH MORE THAN THE FIX.** Every reader of
-- this file — the header prose, `check-rls-pair-gate.ts`, the redteam suite,
-- two findings (F-570, F-573) — replayed only `CREATE POLICY` / `DROP POLICY`
-- and never `DROP TABLE`, so a policy on a dead table read as a LIVE FENCE to
-- all of them. The gate now tracks `DROP TABLE` and asserts `ENABLE ROW LEVEL
-- SECURITY` per covered table, which is what found this.
-- ⚠ F-573 is moot with it: those two write policies died in July 2026, with the
-- table.

-- ---- chats ----------------------------------------------------------------
-- ⚠ BOTH POLICIES CALL THE SAME PREDICATE, AND THAT IS THE POINT. Permissive
-- policies are OR-ed, so an unfenced `chats_owner_select` sitting beside a
-- repaired `chats_member_select` would re-open every gap the repair closes. The
-- owner arm has not been dropped — it is arm 3 of `dopl_chat_readable`, where
-- the credential axis can reach it.
DROP POLICY IF EXISTS chats_owner_select ON chats;
CREATE POLICY chats_owner_select ON chats
  FOR SELECT
  USING (public.dopl_chat_readable(id));

DROP POLICY IF EXISTS chats_member_select ON chats;
CREATE POLICY chats_member_select ON chats
  FOR SELECT
  USING (public.dopl_chat_readable(id));

-- ---- chat_messages --------------------------------------------------------
-- A message is readable exactly when its chat is — the same bargain
-- `agent_template_knowledge_bases_member_select` keeps with its template, and
-- the same one `knowledge_entries_member_select` keeps with its base.
DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT
  USING (public.dopl_chat_readable(chat_id));

-- ---- knowledge_entry_chunks (F-575) ---------------------------------------
-- ⚠ **RLS WAS ENABLED ON THIS TABLE WITH NO POLICY AT ALL** since
-- `20260612090000_knowledge_embeddings.sql` ("No policies on purpose:
-- service-role only"). That FAILS CLOSED — `authenticated` gets zero rows — so
-- nothing is leaking and nothing is broken while the embeddings repository still
-- reads as the service role. The trap is directional and it is the mirror of the
-- failure `caller-jwt.ts` refuses to have: the day a chunk read moves to
-- `readClient()`, search goes quietly EMPTY behind a fence that reports itself
-- armed.
--
-- 🔒 **AND IT STAYS DENY-ALL UNTIL PHASE 3 — THE POLICY THIS FILE ONCE ADDED IS
-- WITHDRAWN** (2026-09-02, review of batch 2; Desktop Agent default, Samuel may
-- reverse). The rest of phase 2 NARROWS four tables; this one arm WIDENED a
-- table from "nobody" to "every viewer whose base is readable", and it did so
-- **regardless of `RLS_PHASE_2`**, because a policy is not behind a flag. The
-- wave's own rule is that no net widening happens while the flag is off, and a
-- widening that closes a documentation gap is still a widening.
--
-- ⚠ NOTHING IS LOST BY WAITING. The trap F-575 records is DIRECTIONAL: the
-- table fails CLOSED today, so the cost of no policy is an EMPTY search the day
-- a chunk read moves to `readClient()` — never a leak. That move is phase 3's,
-- and the policy belongs in the same change as the reader it unblocks, where a
-- redteam suite can run against both. Writing it a phase early buys nothing and
-- spends the one property this phase promised.
--
-- ⚠ **F-575 STAYS FILED AND OPEN.** The covered-table count is TEN, not eleven;
-- `scripts/check-rls-pair-gate.ts › POLICY_ONLY` does not list this table, and
-- the entry that re-adds it here is the same entry that adds the reader.
--
-- ⚠ The `knowledge_base_id` index this file also added is withdrawn with it —
-- and it was a DUPLICATE in any case:
-- `20260720185006_covering_fk_indexes.sql › knowledge_entry_chunks_knowledge_base_id_idx`
-- is already exactly `(knowledge_base_id)`.
DROP POLICY IF EXISTS knowledge_entry_chunks_member_select ON knowledge_entry_chunks;


-- ===========================================================================
-- STEP 6 — assert the outcome instead of trusting it (INVARIANTS §12)
-- ===========================================================================
-- ⚠ THE BEHAVIOURAL PROBES ARE OWED, NOT RUN — no database on this branch.
-- Owed, all inside `BEGIN; … ROLLBACK;`, as the caller (`SET LOCAL ROLE
-- authenticated` + a request JWT carrying `dopl_credential`):
--   P1  creator reads own `private` skill                        → 1 row
--   P2  the same, with `dopl_credential.shared = true`           → 0 rows
--   P3  admin reads a member's `private` skill                   → 0 rows
--   P4  viewer reads a `public`/`teams` skill, no grant          → 0 rows
--   P5  P4 with a `resource_grants` row on the viewer's team     → 1 row
--   P6  P5 with the grant's `scope_type` flipped to 'container'  → 0 rows
--   P7  guest reads a `public`/`workspace` skill                 → 0 rows
--   P8  the seven again against `chats` / `chat_messages`, with
--       ADMIN-READS-A-PRIVATE-CHAT explicitly 0 rows (it was 1)
--   P9  shared credential reads its minter's `private` template  → 0 rows (was 1)
--   P10 shared credential reads a `workspace` template           → 1 row
-- ⚠ REPLAY (`supabase db reset` → exit 0) IS THE GATE, OWED.
-- ⚠ NEW FILE — never an edit to an applied migration.
--
--   SELECT policyname, qual FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('skills','skill_files','chats','chat_messages',
--                        'agent_templates','resource_grants')
--      AND cmd = 'SELECT';
DO $$
BEGIN
  -- 🔒 Every SELECT policy on a covered table must go through ONE predicate. A
  -- policy that still spells a matrix inline is a second copy, which is the
  -- defect this file closes — and on `chats` it is specifically how the blanket
  -- admin arm survived three rewrites.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd = 'SELECT'
       AND (
         (tablename = 'skills'
            AND qual::text NOT LIKE '%dopl_skill_readable%')
         OR (tablename IN ('chats','chat_messages')
            AND qual::text NOT LIKE '%dopl_chat_readable%')
         OR (tablename IN ('agent_templates','agent_template_knowledge_bases')
            AND qual::text NOT LIKE '%can_current_user_read_agent_template%')
       )
  ) THEN
    RAISE EXCEPTION 'a phase-2 SELECT policy still states its matrix inline';
  END IF;

  -- 🔒 And each predicate must ask the credential axis. An absent claim reads as
  -- "not shared" by design (`20260919120000` STEP 1), so a predicate that never
  -- asks is indistinguishable from one whose answer is always "no".
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('dopl_public_teams_admits',
                       'can_current_user_read_agent_template')
       AND prosrc NOT LIKE '%dopl_credential_is_shared%'
  ) THEN
    RAISE EXCEPTION 'a phase-2 predicate does not ask the credential axis';
  END IF;
END $$;
