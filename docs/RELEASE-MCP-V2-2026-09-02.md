# RELEASE RUNBOOK — MCP/architecture v2, Waves A+B

**Status at time of writing: NOT RELEASABLE. Two CI gates are red and the
migration history has a duplicate version stamp.** The ordered steps below are
the release when those are cleared; §0 is what must be cleared first.

This is the operator's file. The design rationale lives in
`docs/MCP-V2-WAVE-B-BATCH{1,2,3}-2026-09-02.md`; nothing here restates it.

---

## §0 — BLOCKERS (all must clear before step 1)

| # | Blocker | Evidence | Who |
|---|---|---|---|
| B1 | **Duplicate migration version `20260901120000`** — two files carry it (`_agent_template_home_scoped`, `_credit_usage_events`). The replay dies on `schema_migrations_pkey` (SQLSTATE 23505). | CI job *RLS redteam*, run 33725307319 | needs a ruling — see below |
| B2 | **`delivery-composed.test.ts` fails on Linux**: `Cannot find module 'electron'` via `dopl-desktop-app/main/diag.js` ← `main/agent-handles.js`. A `src/` test imports desktop main code. | CI job *node 22 / ubuntu-latest*, 1 failed / 5674 passed | needs a fix |
| B3 | **The 17 wave migrations have executed NOWHERE.** Their own headers say so. `rls-redteam` is the first-ever replay and it has never reached the SQL — B1 stops it in the first seconds. | file headers; CI | clears with B1 |
| B4 | **No local replay possible here**: Docker unavailable, so `supabase start` / `db reset` cannot run. | `docker info` | clears with B1 (CI becomes the replay) |

**B1 is the one that matters.** Until the replay runs end to end, *no evidence
exists that any of these 17 files can apply at all*. Applying them to production
would be their first execution anywhere.

Two ways to resolve B1 — this is a **decision, not a cleanup**:

- **Re-stamp** one of the two `20260901120000` files to a free version. Correct
  going forward, but both are **already applied on production** under whatever
  stamps the CLI minted, so a re-stamp needs a matching
  `supabase migration repair --status applied <version>` or the next push tries
  to re-run it.
- **Repair history only**, leaving filenames alone. Keeps production truthful
  and leaves the replay red forever — which forfeits B3's entire point.

⚠ Related and unresolved: production's applied list reportedly contains
`20260901202204 chats_source_codex` while the repo holds
`20260906120000_chats_source_codex.sql` — **same name, different version**, the
F-526 class. If that is the same migration, `20260906120000` is *already applied*
and the true pending count is 18, not 19. **This was not verified**: no
`SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` is present in this environment,
so `supabase migration list --linked` could not run. Verify before step 1.

---

## §1 — THE MIGRATION LEDGER

19 repo files sort after production's last applied version
(`20260905120000_channel_sessions_display_name`). One is held; the rest split
into **expand** (safe while the OLD code is still live) and **contract** (safe
only once v2/wave-b is live).

Destructive = drops an object. Data-moving = writes rows.

### EXPAND — apply BEFORE the deploy (phase 1)

| File | Destr. | Data | Reversible | Notes |
|---|---|---|---|---|
| `20260906120000_chats_source_codex` | no | no | yes | ⚠ may already be applied as `20260901202204` — verify |
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

### CONTRACT — apply only AFTER v2/wave-b is live (phase 2)

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

`db push` applies every pending file in version order and cannot skip a middle,
and `20260915`/`20260916` sort *before* the rest of the expand set. So phase 1
is done by temporarily holding the contract files:

```bash
# phase 1 — hold the contract set, push expand only
git mv supabase/migrations/2026091{5,6}120000_*.sql supabase/migrations-held/
git mv supabase/migrations/20260922120000_*.sql     supabase/migrations-held/
git mv supabase/migrations/202609231{3,4}0000_*.sql supabase/migrations-held/
#   ⚠ update the "held set is exactly" assertion in migrations-held.test.ts
supabase db push --linked --dry-run     # paste the plan into the release notes
supabase db push --linked

# → deploy (§4)

# phase 2 — release the contract set
git mv supabase/migrations-held/2026091{5,6}120000_*.sql supabase/migrations/
git mv supabase/migrations-held/20260922120000_*.sql     supabase/migrations/
git mv supabase/migrations-held/202609231{3,4}0000_*.sql supabase/migrations/
supabase db push --linked --dry-run
supabase db push --linked --include-all   # out-of-order: they sort before 20260923140000
```

⚠ `--include-all` applies **every** pending file. Re-read the dry-run plan and
confirm `20260923120000_drop_home_scoped` is not in it — it is held, so it must
not be.

---

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

1. **Back up.** `supabase db dump --linked -f backups/prod-pre-mcp-v2-$(date +%Y%m%d%H%M).sql` — confirm `backups/` is gitignored first.
2. **Verify the true pending list.** `supabase migration list --linked`. Reconcile the `chats_source_codex` version mismatch (§0) and re-count. Do not proceed on the assumption of 19.
3. **CI green**, `rls-redteam` included. That job is the only replay evidence that exists.
4. **Phase 1 push** (§2), dry-run first, plan pasted into this file.
5. **Verify phase 1** (§5).
6. **Merge PR #12** to master — **merge commit, not squash**; the branch carries 370+ commits.
7. **Wait for the Vercel production deploy to report READY.** Do not start phase 2 before it does.
8. **Phase 2 push** (§2), dry-run first.
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
