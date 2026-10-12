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

Two of the three held files (`20261110140000`, `20261110150000`) sort before the
`20261114…` drops released on 2026-09-29; `20261122120000` sorts after every
applied file. Production is not applied with
`supabase db push` — versions there are stamped at apply time and reconciled by
migration NAME (see `docs/RELEASE-MCP-V2-2026-09-02.md` §0) — so this only
affects the local/CI replay, which is safe because a held file is order-proof
(assertion 4).

## ⚠ PICK A VERSION FROM EVERY LIVE BRANCH, NEVER FROM THIS DIRECTORY

`migration-versions.test.ts` guards a duplicate stamp WITHIN `migrations/` and
WITHIN `migrations-held/`, and `migrations-held.test.ts` guards one ACROSS the
two. **None of them can see another branch**, and that is where the slot
actually gets taken: a version read off the tree is correct when a branch is cut
and stale by the time it merges. `migration-versions.test.ts` says so in its own
header — *"Nobody is careless; the information expires."*

This is the F-id rule applied to migrations (CLAUDE.md: allocate from the highest
claimed on ANY LIVE BRANCH, never from `master`'s). Re-derive before stamping:

```
git log --all --name-only --pretty=format: -- 'supabase/migrations*' \
  | grep -oE '^[0-9]{14}' | sort -u | tail -5
```

Measured 2026-10-12: `20261122120000` was stamped only after that command showed
`20261121120000` already claimed by `channel_member_tally_rpc.sql` on
`cleanup/c13-tally` and `fix/c13-tally-r` — a collision no test on either branch
could have reported, because neither branch can read the other.

⚠ **A `git log --all` CHECK IS DELIBERATELY NOT A TEST.** CI clones shallow and
single-branch, so such a test would see no branches and pass vacuously — the
fail-open class this repo has already paid for. The command above is run by the
person choosing the stamp.

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

### Per-channel numbering — `20261122120000`

**Held by Samuel's ruling, not by an unmet precondition** (2026-10-12): *"write
them, NEVER apply them."* The only held file here that **adds** rather than
drops, so it is absent from the drop-completeness list in
`migrations-held.test.ts` by design.

| File | Adds | Extra gate before release |
|---|---|---|
| `20261122120000_channel_per_channel_numbering.sql` | `channel_messages.channel_seq` (NOT NULL) + `.thread_seq` (nullable), two unique indexes, and `channel_message_insert` allocating both under the advisory lock it already holds | Samuel's word to apply, **and** the five-step release checklist in the file's own header — the `CHANNEL_MESSAGE_COLS` step is the one that breaks page reads if it happens in the wrong order |

⚠ **IT IS A `CREATE OR REPLACE` OF `channel_message_insert`, COPIED FROM
`20260912120000` §4.** If any migration applied after that one redefines the
function, releasing this file would silently revert it — re-derive the body
first (`grep -rln channel_message_insert supabase/migrations/`).

The design, including the inventory this was built from and the two decisions
still on Samuel's card, is the Dopl knowledge base, `codebase-cleanup` ›
"Per-Channel Numbering Design".

## Released

- 2026-09-28: `20261110160000_profiles_update_column_grants.sql` (security), on
  Samuel's word.
- 2026-09-29 (Samuel: apply the safe drops): `20261114120000_drop_glasses_prototype.sql`
  (was `20261110120000`), `20261114130000_drop_dead_tables_and_rpcs.sql` (was
  `20261110130000`), `20261114140000_drop_home_scoped.sql` (was `20260923120000`).
