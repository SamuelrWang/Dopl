# `supabase/migrations-held/` — written, ordered, and DELIBERATELY NOT APPLIED

A file in this directory is a finished migration whose **precondition is not yet
met**. It is here rather than in `supabase/migrations/` for one mechanical
reason: `supabase db push` and `supabase db reset` read that directory and only
that directory. A held file therefore **cannot be applied by accident** — not by
a push, not by the CI replay, not by a `db reset` on a laptop. The hold is
enforced by the filesystem, not by a comment asking people to be careful.

`migrations-held.test.ts` pins the three properties that make this safe:

1. **No held file is also in `supabase/migrations/`.** A file in both places is
   not held at all; it is applied with a note beside it saying otherwise.
2. **The hold is complete** — no *applied* migration drops what a held one
   drops. Otherwise holding a file would keep its own `DROP` out of the run
   while some other file performed the same drop, which reads as safety and is
   not.
3. **No applied migration depends on a held one.** Citations in prose do not
   count: `--` lines *and* string literals are stripped before matching, because
   these headers quote each other's versions constantly and a `COMMENT ON …
   IS '… dropped in 20260923120000'` is a reference, not a dependency.

## ⚠ A held file may sort BEFORE applied ones — releasing it is OUT OF ORDER

`20260923120000` is held while `20260923130000` and `20260923140000` are
applied. Its version therefore sorts **earlier than the newest version on the
target**, and `supabase db push` refuses an older-than-remote local migration by
default. Releasing it later needs `supabase db push --include-all`, and that
flag applies **every** pending file — so re-read the pending list before using
it rather than assuming it means "just this one".

Do **not** fix this by re-stamping the file to a newer version. The stamp is
when it was written, the two files after it do not depend on it (assertion 3
above is what proves that), and re-stamping to dodge a flag is how a history
stops matching the order things actually ran in.

## Releasing a held file

Move it back with `git mv`, in the commit that also makes its precondition true,
and say in the commit message which precondition was met and how it was checked.
Do not edit a held file's version stamp to "make it current" — the stamp is the
order it was written in, and `db push` compares stamps against
`supabase_migrations.schema_migrations` on the target.

---

## Currently held

### `20260923120000_drop_home_scoped.sql`

**Precondition P2, unmet: `TENANCY_PERSONAL_CONTAINER` has never been on.**

The file drops `knowledge_bases.home_scoped` and `agent_templates.home_scoped`.
Its own opening `DO $$` block refuses to run while any row still carries
`home_scoped = true` outside a container of `kind = 'personal'`, because dropping
the column there would **publish a personal row to its whole workspace** — a
silent visibility widening, which is the one class of failure this codebase
treats as unrecoverable.

`TENANCY_PERSONAL_CONTAINER` defaults off and has never been turned on in
production, so `ensure_personal_container` has never run and **no personal
container exists**. Every pre-existing `home_scoped = true` row is therefore
stranded by definition, and the guard raises.

That guard is doing its job, but a `RAISE` inside `db push` **aborts the push
part-way through the batch**, leaving the earlier files of the same run applied
and the later ones not. Holding the file keeps that failure out of the release
entirely instead of discovering it against production.

**To release it, in order:**

1. Ship a release with `TENANCY_PERSONAL_CONTAINER=1`, so new personal writes
   land in a personal container instead of a shared workspace.
2. Leave it on for a full release cycle — the precondition is "on for a
   release", not "on for an afternoon" — so no in-flight client is still writing
   the old shape.
3. Backfill: mint the containers and move the stranded rows (`20260920120000`
   section 5), then confirm the count is zero:

   ```sql
   SELECT count(*) FROM public.knowledge_bases k
    WHERE k.home_scoped IS TRUE
      AND NOT EXISTS (SELECT 1 FROM public.workspaces p
                       WHERE p.id = k.workspace_id AND p.kind = 'personal');
   -- and the same for public.agent_templates
   ```

4. Only then `git mv` it back and push.

⚠ **The column is also the rollback path.** While `home_scoped` still exists, a
revert to pre-Wave-B code finds the data it expects. Once dropped, the deploy is
one-way.
