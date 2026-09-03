-- ============================================================================
-- THE CHILDREN FOLLOW THE ROW — repairing `20260920120000`'s personal-container
-- move, which changed a parent's tenancy and left every child stamped with the
-- old one (F-664).
-- ============================================================================
--
-- ⚠ **THIS IS A REPAIR OF AN APPLIED MIGRATION, NOT A NEW FEATURE.**
-- `20260920120000_workspace_kind_personal.sql` §5 moved every `home_scoped`
-- knowledge base and agent template into its AUTHOR's personal container with
-- two `UPDATE … SET workspace_id` statements. Both are correct about the row
-- they name and neither touched the rows BELOW it:
--
--   * `knowledge_folders`, `knowledge_entries` and `knowledge_entry_chunks`
--     each carry their own `workspace_id`, denormalised off the base;
--   * `agent_template_knowledge_bases` carries one denormalised off the
--     TEMPLATE, which is the parent its reads key on
--     (`repository-knowledge-links.ts › listKnowledgeLinksForTemplates`
--     filters `.eq("workspace_id", …).in("template_id", …)`).
--
-- So after the move a base sat in the personal container while its folders and
-- entries still named the workspace it came from.
--
-- ── 🔒 WHY IT WAS INVISIBLE UNTIL A READ CROSSED THE SEAM ──────────────────
--
-- Nothing 500s on a mismatched child until something COMPARES the two, and the
-- only thing that compares them is `service-shared.ts › assertSameWorkspace`,
-- reached from `path.ts` once a caller resolves a path inside the moved base.
-- Every list read is keyed on `knowledge_base_id` and never noticed. The
-- symptom was therefore not "the move was wrong" but "read_file on this one
-- base is broken", which is F-604's shape a second time: the parent is fine and
-- the contents are not.
--
-- ⚠ **AND IT IS A CLASS, NOT AN INCIDENT.** Any future statement that changes a
-- row's `workspace_id` owes the same repair. `scripts/check-tenancy-move-gate.ts`
-- is the gate: it refuses a migration that re-stamps a parent without
-- re-stamping every child table declared to derive from it.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────
--
-- Four `UPDATE`s, each derived from the PARENT rather than from a computed
-- container, so the statement is true whatever moved the parent and whenever.
--
-- 🔒 **DERIVED, NEVER RE-DERIVED FROM `created_by`.** Recomputing "the author's
-- personal container" here would repair rows the move never touched — a base
-- shared into a workspace by a user who also has a personal container would be
-- dragged onto their shelf. The parent's `workspace_id` is the only correct
-- source, and it is also the invariant the gate enforces.
--
-- ⚠ IDEMPOTENT. Every statement is `WHERE child.workspace_id <> parent.workspace_id`,
-- so a second run matches nothing. Safe to replay on a database where
-- `20260920120000` moved nothing.
--
-- ⚠ NO POLICY MOVES AND NO OBJECT IS CREATED OR DROPPED, so the RLS pair gate,
-- the policy topology and every `canSee*` twin are untouched. This file changes
-- DATA only.
--
-- ROLLBACK: none is meaningful. The pre-state is a child row whose tenancy
-- disagrees with its parent's — that is the defect, not a configuration. The
-- revert of `20260920120000` moves the parents back and these statements are
-- then re-run to follow them.
-- ============================================================================

-- ── 1. knowledge_folders ────────────────────────────────────────────────────
UPDATE public.knowledge_folders c
   SET workspace_id = b.workspace_id
  FROM public.knowledge_bases b
 WHERE b.id = c.knowledge_base_id
   AND c.workspace_id <> b.workspace_id;

-- ── 2. knowledge_entries ────────────────────────────────────────────────────
UPDATE public.knowledge_entries c
   SET workspace_id = b.workspace_id
  FROM public.knowledge_bases b
 WHERE b.id = c.knowledge_base_id
   AND c.workspace_id <> b.workspace_id;

-- ── 3. knowledge_entry_chunks ───────────────────────────────────────────────
-- ⚠ KEYED ON THE BASE, NOT ON THE ENTRY. The chunk carries BOTH ids
-- (`20260612090000`), and the base is the row whose tenancy actually moved;
-- going through the entry would make this statement depend on §2 having run
-- first, which is a dependency between two `UPDATE`s in one file and the kind
-- of ordering nobody re-derives correctly later.
UPDATE public.knowledge_entry_chunks c
   SET workspace_id = b.workspace_id
  FROM public.knowledge_bases b
 WHERE b.id = c.knowledge_base_id
   AND c.workspace_id <> b.workspace_id;

-- ── 4. agent_template_knowledge_bases ───────────────────────────────────────
-- 🔒 **THE TEMPLATE IS THE PARENT, AND THE JUNCTION HAS TWO.** This row is the
-- TEMPLATE's attachment list — that is the key its reads and its replace-set
-- write both use — and the base it points at may legitimately live in a
-- different container, because an attachment is a REFERENCE and never a copy
-- (`20260822200000`). Deriving from the base would re-file the junction under
-- somebody else's tenancy and hide the attachment from the template that owns
-- it.
UPDATE public.agent_template_knowledge_bases c
   SET workspace_id = t.workspace_id
  FROM public.agent_templates t
 WHERE t.id = c.template_id
   AND c.workspace_id <> t.workspace_id;

-- ===========================================================================
-- VERIFICATION (INVARIANTS §12) — the invariant, asserted rather than assumed
-- ===========================================================================
-- ⚠ A `DO` BLOCK RATHER THAN A COMMENT WITH A QUERY IN IT. The statements above
-- are the only thing standing between a moved parent and a 500 on its contents,
-- so a replay that silently leaves a straggler must fail the replay.
DO $$
DECLARE
  stragglers bigint;
BEGIN
  SELECT
      (SELECT count(*) FROM public.knowledge_folders c
         JOIN public.knowledge_bases b ON b.id = c.knowledge_base_id
        WHERE c.workspace_id <> b.workspace_id)
    + (SELECT count(*) FROM public.knowledge_entries c
         JOIN public.knowledge_bases b ON b.id = c.knowledge_base_id
        WHERE c.workspace_id <> b.workspace_id)
    + (SELECT count(*) FROM public.knowledge_entry_chunks c
         JOIN public.knowledge_bases b ON b.id = c.knowledge_base_id
        WHERE c.workspace_id <> b.workspace_id)
    + (SELECT count(*) FROM public.agent_template_knowledge_bases c
         JOIN public.agent_templates t ON t.id = c.template_id
        WHERE c.workspace_id <> t.workspace_id)
  INTO stragglers;

  IF stragglers <> 0 THEN
    RAISE EXCEPTION
      'personal_container_child_rows: % child row(s) still disagree with their parent''s workspace_id', stragglers;
  END IF;
END $$;
