# `supabase/migrations-held/` — written, ordered, and DELIBERATELY NOT APPLIED

A file in this directory is a finished migration whose **precondition is not yet
met**. It is here rather than in `supabase/migrations/` for one mechanical
reason: `supabase db push` and `supabase db reset` read that directory and only
that directory. A held file therefore **cannot be applied by accident** — not by
a push, not by the CI replay, not by a `db reset` on a laptop. The hold is
enforced by the filesystem, not by a comment asking people to be careful.

`migrations-held.test.ts` pins the four properties that make this safe:

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
4. **A held file is order-proof.** Every `ALTER TABLE` in it is `IF EXISTS`, and
   a table an applied file renames after the held version is named under both
   names — the held file replays before that rename.

## ⚠ A held file may sort BEFORE applied ones

Both remaining held files (`20261110140000`, `20261110150000`) sort before the
`20261114…` drops released on 2026-09-29. Production is not applied with
`supabase db push` — versions there are stamped at apply time and reconciled by
migration NAME (see `docs/RELEASE-MCP-V2-2026-09-02.md` §0) — so this only
affects the local/CI replay, which is safe because a held file is order-proof
(assertion 4).

## Releasing a held file

Move it into `supabase/migrations/` with a git rename, in the commit that also
makes its precondition true, and say in the commit message which precondition
was met and how it was checked. Re-stamp it after the newest applied file when
its body depends on something applied after its original stamp (as
`drop_home_scoped` did), and update the held-set list in
`src/shared/supabase/migrations-held.test.ts`.

---

## Currently held

### The db-cleanup drops — `20261110140000`, `20261110150000`

**Held by Samuel's ruling, not by an unmet precondition** (2026-09-28, overnight
DB audit): *"List + draft drops, don't apply."* The evidence for every object —
code references, row counts, last write — is `docs/db-cleanup-audit.md`, measured
against production on 2026-09-28. Each file's header lists what it drops and why.

| File | Drops | Extra gate before release |
|---|---|---|
| `20261110140000_drop_pooled_credit_counter.sql` | `workspace_credit_usage`, `consume_workspace_credits` (F-667) | Samuel's retention call on the 6 historical rows (export query in the header) |
| `20261110150000_drop_profile_legacy_billing_columns.sql` | six dead billing/trial columns on `profiles` + two indexes | archive the old per-user tier rows if wanted (query in the header) |

They are independent of each other; release either. After releasing one,
re-generate `src/shared/supabase/types.ts`.

## Released

- 2026-09-28: `20261110160000_profiles_update_column_grants.sql` (security), on
  Samuel's word.
- 2026-09-29 (Samuel: apply the safe drops): `20261114120000_drop_glasses_prototype.sql`
  (was `20261110120000`), `20261114130000_drop_dead_tables_and_rpcs.sql` (was
  `20261110130000`), `20261114140000_drop_home_scoped.sql` (was `20260923120000`).
