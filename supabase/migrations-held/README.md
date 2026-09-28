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

## ⚠ A held file may sort BEFORE applied ones — releasing it is OUT OF ORDER

`20260923120000` is held while `20260923130000` and `20260923140000` are
applied, so its version sorts **earlier than the newest version on the target**.

⚠ This matters less than it first appears, because **production is not applied
with `supabase db push` at all** — versions there are auto-stamped at apply time
and reconciled by migration NAME (see `docs/RELEASE-MCP-V2-2026-09-02.md` §0).
Releasing a held file means applying it per-file like every other, at which
point its filename version is not consulted. What the ordering *does* affect is
the **local/CI replay**, where `db reset` applies in filename order: this file
replays before every applied file stamped after it, including `20261019`'s
`agent_templates` → `agent_identities` rename. That works because the file is
order-proof (assertion 4): it drops `home_scoped` from both table names with
`IF EXISTS`, and `20261019` touches `home_scoped` only behind an existence guard.

Do **not** fix this by re-stamping the file to a newer version. The stamp is
when it was written, no applied file depends on it (assertion 3), and
re-stamping to dodge a flag is how a history stops matching the order things
actually ran in.

## Releasing a held file

Move it back with `git mv`, in the commit that also makes its precondition true,
and say in the commit message which precondition was met and how it was checked.
Do not edit a held file's version stamp to "make it current" — the stamp is the
order it was written in, and `db push` compares stamps against
`supabase_migrations.schema_migrations` on the target.

---

## Currently held

### `20260923120000_drop_home_scoped.sql`

**Held on ONE unmeasured row count. ⚠ The CODE precondition is met and the old
rationale is gone (re-measured 2026-09-10).** The file drops
`knowledge_bases.home_scoped` and `agent_identities.home_scoped`; its `DO $$`
block RAISEs while any row still carries `home_scoped = true` outside a
`kind='personal'` container, because dropping it there would **publish a personal
row to its whole workspace** — and a `RAISE` inside `db push` aborts the batch
part-way. Only the query in step 3 can say whether such rows exist.

⚠ **WHAT THIS PARAGRAPH USED TO SAY, AND WHY IT MUST NOT BE RESTORED.** It read
*"Precondition P2, unmet: `TENANCY_HOME_SPACE` has never been on … no
personal container exists"*. Both halves are now false. `20260920120000_workspace_kind_personal.sql`
is in `supabase/migrations/` (match by NAME, §12) and the personal container is
live and **UNFLAGGED**: `TENANCY_HOME_SPACE` is read by no code at all —
slice B15 deleted the flag, the dual write and the union read with it, and
`src/shared/tenancy/home-space.ts` now REFUSES a personal write with no
container rather than falling back to a shared workspace. So P2's code half is
satisfied, steps 1 and 2 below describe a flag that does not exist, and the hold
rests entirely on step 3's count. **Deploy state is a measurement, not a claim**
(CLAUDE.md): run the query, do not re-derive an answer from this file.

**To release it, in order:**

1. ~~Ship a release with `TENANCY_HOME_SPACE=1`~~ — **DONE AND GONE.**
   There is no flag; personal writes land in a container or refuse.
2. ~~Leave it on for a full release cycle~~ — **moot for the same reason.** What
   step 3 measures is whether any row PREDATING that state is still stranded.
3. Backfill: mint the containers and move the stranded rows (`20260920120000`
   section 5), then confirm the count is zero:

   ```sql
   SELECT count(*) FROM public.knowledge_bases k
    WHERE k.home_scoped IS TRUE
      AND NOT EXISTS (SELECT 1 FROM public.workspaces p
                       WHERE p.id = k.workspace_id AND p.kind = 'personal');
   -- and the same for public.agent_identities
   ```

4. Only then `git mv` it back and push.

⚠ **The column is also the rollback path.** While `home_scoped` still exists, a
revert to pre-Wave-B code finds the data it expects. Once dropped, the deploy is
one-way.

### The db-cleanup drops — `20261110120000` … `20261110160000`

**Held by Samuel's ruling, not by an unmet precondition** (2026-09-28, overnight
DB audit): *"List + draft drops, don't apply."* The evidence for every object —
code references, row counts, last write — is `docs/db-cleanup-audit.md`, measured
against production on 2026-09-28. Each file's header lists what it drops and why.

| File | Drops | Extra gate before release |
|---|---|---|
| `20261110120000_drop_glasses_prototype.sql` | `glasses_devices`; policies `glasses_messages_owner_update`, `glasses_device_links_owner_select` | none |
| `20261110130000_drop_dead_tables_and_rpcs.sql` | `channel_task_participants` (+ guard fn), `user_preferences`, `increment_ingestion_count` + `profiles.ingestion_count`, `chat_replace_messages`, `channel_agents.engaged_*`, duplicate `chats_owner_select` | the server that no longer deletes `channel_task_participants` rows is DEPLOYED; update the chats policy-pair tests in the same commit |
| `20261110140000_drop_pooled_credit_counter.sql` | `workspace_credit_usage`, `consume_workspace_credits` (F-667) | Samuel's retention call on the 6 historical rows (export query in the header) |
| `20261110150000_drop_profile_legacy_billing_columns.sql` | six dead billing/trial columns on `profiles` + two indexes | archive the old per-user tier rows if wanted (query in the header) |

| `20261110160000_profiles_update_column_grants.sql` | **security, not a drop**: `authenticated` may UPDATE only `display_name`, `bio`, `website_url`, `twitter_handle`, `github_username` on `profiles`; INSERT/UPDATE/DELETE revoked otherwise | ship the verified legacy-Stripe reads (`billing/server/subscriptions.ts`) first — they protect prod until this applies |

They are independent of each other and of `20260923120000`; release any subset.
All four are stamped after every applied file, so replay order is not an issue.
After releasing any of them, re-generate `src/shared/supabase/types.ts`.
