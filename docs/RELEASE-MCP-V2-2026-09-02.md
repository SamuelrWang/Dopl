# RELEASE RUNBOOK — MCP/architecture v2, Waves A+B

**Status at time of writing: NOT RELEASABLE. Two CI gates are red and the
migration history has a duplicate version stamp.** The ordered steps below are
the release when those are cleared; §0 is what must be cleared first.

This is the operator's file. The design rationale lives in
`docs/MCP-V2-WAVE-B-BATCH{1,2,3}-2026-09-02.md`; nothing here restates it.

---

## §0 — HOW PRODUCTION'S HISTORY IS MATCHED, AND WHAT IS STILL BLOCKING

### ⚠ Production versions are AUTO-STAMPED. Match by NAME, never by filename version.

Since ~2026-08-23 every migration has been applied through tooling that stamps
its **own** version at apply time, so repo filenames and production versions
have not corresponded for a month:

| Repo filename | Applied on prod as |
|---|---|
| `20260823130000_channel_sessions_template_name` | `20260823092005` |
| `20260827120000_channel_resource_grants` | `20260826100635` |
| `20260901130000_credit_usage_events` | `20260901193049` |
| `20260901120000_agent_template_home_scoped` | `20260827135014` |
| `20260906120000_chats_source_codex` | `20260901202204` |

🔒 **NEVER RUN `supabase db push` AGAINST PRODUCTION.** It compares filename
versions against `supabase_migrations.schema_migrations`, finds ~25 names it
believes are missing, and re-applies them. Several are destructive. Apply
per-file instead (§2).

Reconciliation is by **migration NAME**. Everything through
`chats_source_codex` and `channel_sessions_display_name` is applied.

### Blockers

| # | Blocker | State |
|---|---|---|
| B1 | Duplicate version `20260901120000` (two files) killed the CI replay on `schema_migrations_pkey` 23505. | ✅ **RESOLVED 2026-09-03** — `credit_usage_events` renamed to `20260901130000`, which preserves chronological truth (prod applied it after `agent_template_home_scoped`). Safe precisely because the repo prefix never matched prod. `schema-sql.test.ts`'s F-526 carve-out is now a clean no-duplicates assertion. |
| B2 | `delivery-composed.test.ts` — `Cannot find module 'electron'` on ubuntu. | ✅ **RESOLVED** — and it was a real defect, not a test artifact: `agent-handles.js › handleIndexFor` caught a failing name lookup and then called `require('./diag')`, which requires `electron` and **threw out of the catch**, taking down the routing path the catch exists to protect. The diagnostic is now non-fatal. |
| B3 | 24 Windows failures across `canonical-sets`, `b10-no-derived-default`, `delivery-composed`. | ✅ **RESOLVED** — native path separators compared against `/`-spelled literals. Normalised at both scan sites. |
| B4 | **The 20 pending migrations have executed NOWHERE.** | ⚠ **OPEN until `rls-redteam` goes green.** That job is the first replay these files have ever had; B1 was stopping it before it reached any of them. **Do not apply to production until it passes** — that run is the only evidence that exists. |
| B5 | No local replay here (Docker unavailable) and no CLI creds (`SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` absent). | Accepted — CI is the replay; §2 applies per-file rather than through the CLI. |

## §1 — THE MIGRATION LEDGER

**22** repo files sort after `20260905120000_channel_sessions_display_name`.
One (`chats_source_codex`) is **already applied** on prod under an auto-stamped
version, and one (`drop_home_scoped`) is **held** — so:

> **22 − 1 applied − 1 held = 20 TO APPLY: 15 expand + 5 contract.**

⚠ Earlier drafts of this file said 19, and the wave was briefed as "17
migrations". Both were wrong; the arithmetic above is the count.

They split into **expand** (safe while the OLD code is still live) and
**contract** (safe only once v2/wave-b is live).

Destructive = drops an object. Data-moving = writes rows.

### EXPAND — apply BEFORE the deploy (phase 1) — 15 files

⚠ `20260906120000_chats_source_codex` is **NOT** in this list: it is already on
prod as `20260901202204`. Do not re-apply it.

| File | Destr. | Data | Reversible | Notes |
|---|---|---|---|---|
| `20260907120000_channel_launch_directives_kind` | no | no | yes | additive cols + CHECK widen |
| `20260908120000_knowledge_pinned_startup_context` | no | no | yes | `DEFAULT FALSE` *is* the no-backfill guarantee |
| `20260909120000_channel_sessions_health` | no | no | yes | 7 nullable cols, service_role only |
| `20260910120000_channel_launch_directives_posture` | no | no | yes | CHECK widen |
| `20260911120000_launch_direction_client_msg_id` | no | no | yes | partial unique indexes |
| `20260912120000_channel_delivery_verdict` | no | no | yes | additive cols |
| `20260913120000_channel_tasks_author_scoped_idempotency` | idx | no | yes | drops `channel_tasks_client_msg_key`, adds author-scoped |
| `20260914120000_resource_grants` | no | **YES** | table drops clean | **backfills from `channel_resource_grants` + `team_resource_access`**; arms the mirror trigger |
| `20260917120000_mcp_token_credential_axes` | no | **YES** | cols drop clean | 2 UPDATEs backfilling `container_id` / `subject_user_id` |
| `20260918120000_channel_default_responder` | no | no | yes | CHECK widen |
| `20260919120000_rls_helpers_and_caller_scope` | no | no | yes | functions only; **inert while `RLS_CALLER_SCOPED_READS` is off** |
| `20260920120000_workspace_kind_personal` | no | no | yes | **inert while `TENANCY_PERSONAL_CONTAINER` is off** |
| `20260921120000_rls_phase2_policies` | no | no | yes | policies bite only caller-scoped reads; service_role bypasses RLS |
| `20260921130000_channel_resource_grants_read_only` | policy | no | yes | drops a WRITE policy; old writes go through service_role, which bypasses it |
| `20260921140000_resource_grant_trigger_arms` | no | no | yes | function replacements |

### CONTRACT — apply only AFTER v2/wave-b is live (phase 2) — 5 files

Each drops something **master's currently-deployed code still reads**. Applying
any of these before the deploy takes production down.

| File | Drops | Live (master) reader that breaks |
|---|---|---|
| `20260915120000_drop_agent_template_teams` | table `agent_template_teams` | `features/agent-templates/server/repository.ts` |
| `20260916120000_drop_team_resource_access` | table `team_resource_access` + 6 fns | `features/teams/server/repository-{grants,resources}.ts`, `mcp-server/tools/members-render.ts` |
| `20260922120000_drop_default_workspace_rpc` | `default_workspace_of`, `ensure_default_workspace` | `features/workspaces/server/{repository,service}.ts` — **the app entry point** |
| `20260923130000_drop_channel_resource_grants` | table `channel_resource_grants` | `api/knowledge/bases/[baseId]/channel-grants/route.ts`, `repository-channel-grants.ts` |
| `20260923140000_grant_read_arm` | — (fn replacements) | none; pairs with the grant model, so it goes last |

`20260923130000` opens with a mirror-exactness guard: every
`channel_resource_grants` row must already exist in `resource_grants`. That is
what `20260914120000`'s backfill and mirror trigger are for — **so phase 1 must
have been applied and the trigger armed, or this raises.**

### HELD — do not apply this release

| File | Why |
|---|---|
| `20260923120000_drop_home_scoped` | **Precondition P2 unmet.** It drops `home_scoped`, and refuses while any `home_scoped = true` row sits outside a `kind='personal'` container. `TENANCY_PERSONAL_CONTAINER` has never been on ⇒ no personal container exists ⇒ every such row is stranded ⇒ the guard raises **mid-push**, leaving the batch half-applied. It is also the rollback path: while the column exists, reverting to pre-Wave-B code finds its data. |

Enforced by moving it to `supabase/migrations-held/` — `db push` and `db reset`
read `supabase/migrations/` and nothing else. `src/shared/supabase/migrations-held.test.ts`
pins that it is not in both places, that no applied file depends on it, and that
no applied file drops `home_scoped` either. See that directory's README.

---

## §2 — GAP VERDICT: neither "deploy then migrate" nor "migrate then deploy"

**It must be EXPAND → DEPLOY → CONTRACT.** Both single-phase orders break
production:

- **Deploy first** → v2/wave-b reads `resource_grants`, which does not exist
  yet. Every reader spells `if (error) throw error` with **no missing-relation
  fallback** (`shared/tenancy/resource-grant-reach.ts › grantedResourceIds`,
  `knowledge/server/repository-audience.ts`, `agent-templates/server/repository.ts`,
  `repository-knowledge-links.ts`, `shared/grants/service.ts`). **500s:** knowledge
  base list, the shared shelf, agent-template list, template team links, and every
  grant write.
- **Migrate first** → the contract files drop four things master still reads.
  **500s:** Teams, agent templates, knowledge channel-grants, and workspace
  resolve/signup — i.e. the app entry point.

Only the contract files are order-sensitive, and they are the reason for the
split. The expand set is invisible to old code.

### Executing the split

**Per file, never `db push`** (§0). Each file is applied with the Supabase MCP:

```
apply_migration(name = <filename minus version and ".sql">, query = <file contents verbatim>)
```

in filename order — the same path the previous ~25 took, which is why prod's
versions are auto-stamped. `list_migrations` before and after each phase; the
name is what reconciles, so keep it exact.

Because files are applied individually, the expand/contract split needs no
directory juggling: **just stop after the 15th.** The held file is not in
`supabase/migrations/` at all and cannot be reached by either phase.

Before the first apply, take a schema snapshot (`db dump` needs CLI creds that
are absent):

```sql
SELECT (SELECT count(*) FROM information_schema.tables  WHERE table_schema='public') AS tables,
       (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)     AS functions,
       (SELECT count(*) FROM pg_policies WHERE schemaname='public')                 AS policies,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public') AS columns;
```

Re-run it after each phase and record the deltas in §6. It is not a backup —
**there is no backup without CLI credentials**, which is its own reason to stop
before the contract phase if anything looks wrong.

⚠ **`20260914120000` and `20260917120000` move DATA.** Run the §5 verify query
immediately after each, before continuing. `20260914120000`'s backfill is what
`20260923130000` later checks for exactness; if the backfill is short, the
contract phase raises and the release stops half-applied.

## §3 — FLAGS

| Var | This release | Why |
|---|---|---|
| `TENANCY_PERSONAL_CONTAINER` | **leave OFF / unset** | No applied migration needs it. Turning it on is what starts P2's clock for a *later* release that can then drop `home_scoped`. |
| `RLS_CALLER_SCOPED_READS` | **leave OFF / unset** | Phase-2 RLS policies land inert; reads stay on service_role, which bypasses RLS. Flipping it and the migrations in one release changes the schema and the client identity at once, with no replay evidence behind either. |
| `SUPABASE_JWT_SECRET` | **do not set** | Required *only* when caller-scoped reads flip. `shared/supabase/caller-jwt.ts` refuses the half-configured state explicitly: *"Unset it and `RLS_CALLER_SCOPED_READS` together, or set both."* |

Everything else is unchanged.

### Rollback

Reverting the Vercel deploy with migrations already applied is **safe for the
expand set and one-way for the contract set.**

- Expand: old code never names the new columns, and the dual-read fallbacks hold
  — `shared/auth/mcp-access-token.ts` carries a sticky `42703` catch for the
  `mcp_tokens` axes, and the `?? EMPTY_X` inline fallbacks are intact at head
  (`knowledge/client/api.ts`, `channels/.../knowledge-lane.ts`, `home/types.ts`).
- Contract: `agent_template_teams`, `team_resource_access`,
  `channel_resource_grants` and `ensure_default_workspace` are **gone**. Old code
  reads all four. **Reverting past phase 2 requires restoring them from the
  pre-release dump**, so take it (step 1) and keep it.
- Held: because `home_scoped` was never dropped, the pre-Wave-B tenancy model is
  still recoverable. That is the main reason to keep holding it.

---

## §4 — THE ORDERED RELEASE

1. **Snapshot** (§2). ⚠ Not a backup — `db dump` needs CLI credentials that are absent. Getting them, and taking a real dump, is the one thing that makes the contract phase reversible. **Do this before step 8, not after.**
2. **`list_migrations`** and reconcile **by name** (§0). Confirm 20 pending: 15 expand + 5 contract, `chats_source_codex` absent from the list, `drop_home_scoped` absent from the repo's apply directory.
3. **CI green**, `rls-redteam` included — its first full replay of all 20. That job is the only evidence these files apply at all. **Do not start step 4 without it.**
4. **Phase 1: apply the 15 expand files** per-file, in filename order (§2).
5. **Verify phase 1** (§5), including the mirror-exactness query that phase 2 depends on.
6. **Merge PR #12** to master — **merge commit, not squash**; the branch carries 370+ commits.
7. **Wait for the Vercel production deploy to report READY.** Do not start phase 2 before it does.
8. **Phase 2: apply the 5 contract files** per-file (§2). ⚠ One-way without a dump — see step 1.
9. **Verify phase 2** (§5).
10. **Smoke**: `GET https://www.usedopl.com/api/version`; then an authenticated MCP `initialize` + `tools/list` — expect **11 tools**, and measure served chars against the 46,851 baseline. That measurement is the point of the wave.
11. **Desktop**: `cd dopl-desktop-app && npm run release -- --dry-run`, then `npm run release` (notary profile `dopl-notary`). Verify per `docs/ENGINEERING.md` §18: `xcrun stapler validate`, `spctl -a -vvv`, and `latest-mac.yml` serving 1.26.0. Tag `v1.26.0`.
12. **Only after the feed serves 1.26.0**, move `DEFAULT_DECLARED_LATEST` to `1.26.0` in its own commit — `src/shared/version/desktop-floor.ts`. Never in the bump commit: a declared latest ahead of the published build disarms the anti-brick clamp. (`DEFAULT_MIN_VERSION` stays `1.21.0`; nothing here is a server contract change a stale build breaks against.)

---

## §5 — VERIFY QUERIES

After phase 1:

```sql
-- the backfill moved every legacy grant, and the mirror is armed
SELECT scope_type, count(*) FROM resource_grants GROUP BY scope_type;
SELECT count(*) AS unmirrored FROM channel_resource_grants o
 WHERE NOT EXISTS (SELECT 1 FROM resource_grants g
                    WHERE g.scope_type='channel' AND g.scope_id=o.channel_id
                      AND g.resource_type=o.resource_type AND g.resource_id=o.resource_id);
-- ⚠ MUST be 0, or 20260923130000 raises in phase 2
SELECT tgname FROM pg_trigger WHERE tgname='resource_grants_channel_mirror';

-- the mcp_tokens axes backfilled and agree
SELECT count(*) FILTER (WHERE container_id IS NOT NULL)    AS fenced,
       count(*) FILTER (WHERE subject_user_id IS NOT NULL) AS personal,
       count(*) AS total FROM mcp_tokens;

-- the flags are still off, so these MUST be 0
SELECT count(*) AS personal_containers FROM workspaces WHERE kind='personal';
```

After phase 2:

```sql
SELECT to_regclass('public.agent_template_teams')     AS should_be_null,
       to_regclass('public.team_resource_access')     AS should_be_null,
       to_regclass('public.channel_resource_grants')  AS should_be_null;
SELECT proname FROM pg_proc WHERE proname IN ('default_workspace_of','ensure_default_workspace');
-- ^ MUST return no rows

-- the HELD file did not sneak in: both columns MUST still exist
SELECT table_name FROM information_schema.columns
 WHERE column_name='home_scoped' AND table_schema='public';
```
