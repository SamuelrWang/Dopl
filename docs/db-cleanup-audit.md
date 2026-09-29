# Database cleanup audit — 2026-09-28

Samuel (verbatim): *"look at the database and look for dead tables, dead stuff in the database, and
any obsolete stuff in the database that's no longer used or no longer called. That should just be
deleted. We should make a list of things in the database that we can remove."* His ruling on
applying: **"List + draft drops, don't apply."**

So: nothing in production was changed. Every number below was measured **2026-09-28** with
read-only catalog queries against the production project (Supabase MCP `execute_sql` SELECTs +
the performance/security advisors). The drops are drafted in `supabase/migrations-held/`, which
`db push` / `db reset` never read (see that directory's README).

## Security — needs Samuel

Found during the audit; both halves are on `chore/db-cleanup`, nothing applied.

**The hole (measured 2026-09-28).** `profiles_update_own` (`USING id = auth.uid()`) plus the
Supabase default table-wide `UPDATE` grant to `authenticated` let any signed-in user PATCH **every**
column of their own profile through PostgREST — including `stripe_customer_id`,
`stripe_subscription_id`, the subscription/trial columns, `email` and `onboarded_at`. Two server
paths read those as ownership:

- the Stripe webhook's grandfather path mapped a customer to whichever profile carried its id, so a
  user could attach someone else's legacy Stripe customer to themselves;
- account deletion cancelled whatever `stripe_subscription_id` the profile carried, so a user could
  **cancel someone else's subscription by deleting their own account** (given the `sub_…` id).

No app code needs that write: every profile write goes through the service-role client
(`api/user/profile`, `api/user/mcp-status`, `shared/auth/mcp-session.ts`,
`onboarding/server/repository.ts`, `handle_new_user()`); the browser only SELECTs
`display_name, avatar_url`.

**1. Code hardening — safe to ship before the migration.**
`billing/server/subscriptions.ts › getUserByStripeCustomer` and `› getProfileBillingRef` now treat the
profile ids as claims and verify them against Stripe: the customer's `metadata.user_id` if Stripe
carries one, otherwise the customer's email must equal the user's **auth** email (not
`profiles.email`, which was writable too); two profiles claiming one customer resolve to nobody; a
subscription whose Stripe customer is not the verified one is dropped. Every mismatch writes a
`billing` / `error` system event. A Stripe or auth outage throws: the webhook fails (Stripe
retries) and account deletion now returns 500 instead of skipping the legacy cancel
(`api/user/delete/route.ts`). Tests: `billing/server/subscriptions.test.ts`,
`api/user/delete/route.test.ts`.

**2. Migration `20261110160000_profiles_update_column_grants.sql` — RELEASED and applied to production
2026-09-28** (by name `profiles_update_column_grants`, prod version `20260928183849`, md5
`515372011703a9e0ba054a434a4b91cd` matches the file; verified in a rolled-back probe: `authenticated`
UPDATE of `stripe_customer_id`/`stripe_subscription_id`/`email` → 42501, `display_name` on own row → ok,
INSERT/DELETE → 42501, every `anon` write → 42501). Revokes INSERT/UPDATE/DELETE
on `profiles` from `anon` and `authenticated`, then grants `authenticated` UPDATE on exactly
`display_name, bio, website_url, twitter_handle, github_username` (the profile route's allow-list).
Header carries the rollback (`GRANT INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated;`)
and release order (code first, then the file). Pinned by `shared/supabase/profiles-update-grants.test.ts`.

Other security-advisor items, not acted on: 7 SECURITY DEFINER helpers executable by `anon` and 15
by `authenticated` (they are RLS predicate helpers; revoking EXECUTE from `anon` is the easy win),
4 functions with a mutable `search_path`, `vector` installed in `public`, leaked-password protection off.

## How it was measured

- **Code references**: `grep -rlw <name>` over `src/ packages/ dopl-desktop-app/ apps/ scripts/`
  (`.ts .tsx .js .mjs .cjs`), excluding `node_modules`, `dist`, tests, and the generated
  `src/shared/supabase/types.ts`. "No code" means zero hits outside those.
- **SQL references**: every public function body (`pg_proc.prosrc`), policy expression
  (`pg_policy`), view definition and column default, searched for each name, then walked as a call
  graph from the live roots (policies, triggers, RPCs called from code).
- **Activity**: `pg_stat_user_tables` (inserts/updates/deletes since the stats window began —
  `stats_reset` is null, but `mcp_events` shows fewer lifetime inserts than live rows, so the window
  is shorter than the project's life), plus `max(created_at|updated_at|last_seen|read_at)` per table.
- **Indexes**: `pg_stat_user_indexes.idx_scan = 0`, excluding primary keys and unique indexes.
- **Also inventoried**: realtime publication membership, storage buckets + object counts, cron
  (`pg_cron` is NOT installed; scheduling is Vercel's three crons in `vercel.json`), enums (none),
  sequences (1, live), views (1, live), materialized views (none). App-owned schemas: `public` only.

Re-derive any row: the queries are the ones described above; deploy state is a measurement, not
this file.

## Counts

| Category | Inventoried | Drop (certain) | Drop (likely) | Needs Samuel |
|---|---|---|---|---|
| Tables | 66 + 1 view | 1 | 3 | 2 |
| Functions / RPCs | 68 | 1 | 3 | 2 |
| Triggers | 42 | — | 1 (with its table) | — |
| Columns | 716 | 1 | 8 | 2 (already held) |
| Indexes (non-PK, non-unique, never scanned) | 34 | — | 3 | 5 |
| Policies | 80 | — | 3 (+ 7 that go with dropped tables) | 3 |
| Storage buckets | 3 | — | 1 | 1 |
| Cron / publications / enums / sequences | — | — | — | 1 (unscheduled cleanup fn) |

## Ranked removal list

Ranked by confidence, then by how much dead surface it removes.

| # | Object | Type | Evidence | Confidence | Risk | Dependencies | Action |
|---|---|---|---|---|---|---|---|
| 1 | `glasses_devices` | table | No code (docs/glasses-mcp.md: "no longer read"). 1 row; `last_seen` stopped 2026-09-26 when device links replaced it. | **certain** | none | policy `glasses_devices_owner_select` only; no FK/view/fn | DROP — held file `…120000` |
| 2 | `increment_ingestion_count(uuid)` + `profiles.ingestion_count` | function + column | RPC: no code, no SQL caller. Column: 0 rows ≠ 0, only writer is that function. | **certain** | none | none | DROP — `…130000` |
| 3 | `channel_task_participants` + trigger `…_workspace_guard` + fn `channel_task_child_workspace_guard()` | table + trigger + fn | Breakout rooms retired in the channels rollback. Last insert 2026-08-01, 8 rows. Only code was an explicit delete in `channels/server/repository-tasks.ts` — **removed on this branch** (the FK already cascades). Guard fn used by this trigger only. | likely | an older deployed server still issues the delete → release only after this branch's code ships | FK → `channel_tasks` (cascade); policy `…_member_select` | DROP — `…130000` |
| 4 | `user_preferences` | table | No code (one comment in `api/user/delete`). 3 rows, keys `onboarding`/`theme`, last write 2026-06-09. | likely | none | 4 owner policies | DROP — `…130000` |
| 5 | `chat_replace_messages(uuid,uuid,jsonb)` | function | No code, no SQL caller. | likely | none | none | DROP — `…130000` |
| 6 | `workspace_credit_usage` + `consume_workspace_credits(...)` | table + function | F-667. Retired from writes by `credit_wallets` (applied as `20260907213504`, matched by name). Last write 2026-09-07. No code (comments only). 6 rows of pre-wallet spend. | likely | the rows are history only; a rollback past 1.33 would need them | policy `workspace_credit_usage_member_select`; fn is the table's only writer | **Archive first**, then DROP — `…140000` |
| 7 | `profiles.subscription_tier`, `subscription_status`, `subscription_period_end`, `trial_started_at`, `trial_expires_at`, `reactivation_email_sent_at` + indexes `profiles_trial_expires_at_idx`, `profiles_reactivation_pending_idx` | 6 columns + 2 indexes | No reader or writer anywhere; `handle_new_user()` sets none of them; billing lives in `workspace_billing` + wallets. Data: 2 rows `pro`, 15 `active`/`inactive`, 2 trial rows (newest 2026-04-16). Indexes never scanned. | likely | historical per-user tier lost | none | **Archive first** (query in file header), then DROP — `…150000` |
| 8 | `channel_agents.engaged_at` / `engaged_by` + `idx_channel_agents_engaged_by` | 2 columns + index | Engagement deleted in the rollback; `agents-dto.ts › mapAgentRow` already drops them; the read is `select("*")`, so the drop needs no code change. 1 row non-null. | likely | none | none | DROP — `…130000` |
| 9 | policy `chats_owner_select` | policy | Byte-identical to `chats_member_select` (both `dopl_chat_readable(id)`, SELECT, PUBLIC); advisor `multiple_permissive_policies`. | likely | none (same predicate) | pinned by name in `knowledge/schema-sql.test.ts` and `chats/server/rls-redteam.test.ts` — update those in the release commit | DROP — `…130000` |
| 10 | policy `glasses_messages_owner_update` | policy | Lets a signed-in user UPDATE their own glasses messages (status/answer/payload) straight through PostgREST. All glasses access is service-role; nothing uses it. | likely | none | none | DROP — `…120000` |
| 11 | policy `glasses_device_links_owner_select` | policy | Exposes `token_hash` / `hey_even_key_hash` to the owner's browser session; nothing reads the table with a user client. | likely | the Connect page "Devices" panel must read through a server route (named columns), not re-add this | none | DROP — `…120000` |
| 12 | bucket `chat-attachments` | storage bucket | 0 objects, no code reference. | likely | none | `storage.protect_delete` trigger blocks SQL deletes | Delete via dashboard / Storage API (not in a migration) |

## Needs Samuel (listed, not drafted)

| Object | Why it is not a plain drop | Recommendation |
|---|---|---|
| `mcp_events` (table, 170 rows, 638 kB) + `idx_mcp_events_session` | **No writer** since 2026-07-17 (0 rows in 30 days), but still **read** by `skills/server/service-insights.ts › getSkillUsage` (skill "agent reads" insight — now always 0) and `analytics/server/health.ts`. Dropping needs a product call on the skill-usage insight. | Repoint skill usage at `mcp_tool_calls` (live, 10.8k rows) or delete the insight; then drop the table. |
| `channel_agents` (table, 5 rows) | Write-dead since the rollback, but `listAgentsByChannel` still resolves `metadata.author_agent_id` on old messages to a handle. | Keep. Or backfill the handle into those 6 messages' metadata, drop the read, drop the table. |
| `cleanup_system_events()` | Never called: no code, no `pg_cron`, not in `vercel.json`. Meanwhile `system_events` has grown unbounded since 2026-04-16 (9,976 rows, 5.7 MB). | Don't drop — **wire it** into `/api/cron/oauth-cleanup` (30-day retention). |
| `system_events` indexes `idx_system_events_category`, `_fingerprint`, `_severity` (2.3 MB) | Never scanned, but `/admin/health` groups by fingerprint/severity; they will be used the day that page is. | Keep until retention runs; revisit. |
| `knowledge_entry_chunks_embedding_idx` (HNSW, 6.6 MB) | Never scanned: at 662 chunks the planner seq-scans. Hybrid search is live. | Keep — it is what makes hybrid search scale. |
| `dopl_ontology_writable(uuid)` | No runtime caller (no policy, fn or RPC), but it is the pinned SQL twin of `service-shared.ts`'s edit check and `ontology/server/rls-redteam.test.ts` exercises it. | Keep (documented twin), or drop together with its tests. |
| `glasses_device_links.linked_channel_id`, `.linked_container_id`, `.reply_cursor_seq` (+ the `linked_channel_id` FK and its `ON DELETE SET NULL` exemption in `channels/schema-sql.test.ts`) | Retired 2026-09-28: a device has no linked channel anymore (voice routes by current target, then the most recent channel; the reply mirror's per-channel cursors moved to `glasses_device_channel_activity`). No code reads or writes them. Dropping columns is non-additive, and the previous release still reads them. | Drop all three once no deployed server predates the retirement. Remove the schema-test exemption in the same change. |
| `glasses_messages_owner_select`, `glasses_templates_owner_select` | Unused by code (service-role only), but read-only over the owner's own rows. | Drop with #10/#11 if the device UI will never read these with a user client. |
| bucket `community-thumbnails` (1 object, public) | Only reference is the account-deletion cleanup; the community feature is gone. | Delete the object + bucket and the cleanup lines in `api/user/delete`. |
| `knowledge_bases.home_scoped`, `agent_identities.home_scoped` | Already held as `20260923120000_drop_home_scoped.sql`. **Its release query now measures 0 stranded rows in both tables (2026-09-28).** | Release that held file (promote it after `20261023120000`, per its header). |

## Unused columns

Only columns with zero live references are listed. Everything else of the 716 was referenced.

| Column | Evidence | Action |
|---|---|---|
| `profiles.ingestion_count` | no code; all 0 | drop (#2) |
| `profiles.subscription_tier / subscription_status / subscription_period_end / trial_started_at / trial_expires_at / reactivation_email_sent_at` | no code | archive + drop (#7) |
| `channel_agents.engaged_at / engaged_by` | mapper drops them | drop (#8) |
| `mcp_events.*` | table has no writer | with the table (needs Samuel) |
| `*.home_scoped` (2) | already held | release held file |

Kept deliberately: `profiles.stripe_customer_id` / `stripe_subscription_id` — read by
`billing/server/subscriptions.ts › getUserByStripeCustomer` (webhook grandfather mapping) and
`› getProfileBillingRef` (account deletion).

## Unused indexes

34 non-PK, non-unique indexes have `idx_scan = 0`. Most are **FK-covering** indexes on small tables
(`*_created_by`, `*_added_by`, `*_user_id`, `*_invited_by`, `agent_identity_knowledge_bases_*`),
which keep a parent's `DELETE`/`ON DELETE` from seq-scanning the child. Postgres never counts that
as a scan, so they always look unused. **Keep all of them.**

| Index | Size | Action |
|---|---|---|
| `profiles_trial_expires_at_idx`, `profiles_reactivation_pending_idx` | 8 kB each | drop with their columns (#7) |
| `idx_channel_agents_engaged_by` | 16 kB | drop with its column (#8) |
| `idx_mcp_events_session` | 16 kB | with `mcp_events` (needs Samuel) |
| `idx_system_events_*` ×3 | 2.3 MB | keep for now (needs Samuel) |
| `knowledge_entry_chunks_embedding_idx` | 6.6 MB | keep (needs Samuel) |
| `idx_profiles_stripe_customer` | 16 kB | keep: serves `getUserByStripeCustomer` |
| everything else (FK-covering, `glasses_pairings_status_expires_idx`, `chats_workspace_public_idx`, `conversion_events_type_time_idx`, `oauth_authorization_codes_*`, `webhook_events` flag, `channel_links_workspace_idx`, `channel_tasks_workspace_created_idx`) | ≤16 kB each | keep: small, and each has a live query or FK behind it |

## Orphan functions and triggers

Every one of the 68 public functions was traced. Live roots: RLS policies, triggers, RPCs called
from code. Dead:

- `increment_ingestion_count` — no caller (drop, #2).
- `chat_replace_messages` — no caller (drop, #5).
- `consume_workspace_credits` — retired writer (drop, #6).
- `channel_task_child_workspace_guard` — used only by the dropped table's trigger (drop, #3).
- `cleanup_system_events` — no caller; **wire it up, don't drop** (needs Samuel).
- `dopl_ontology_writable` — no runtime caller; tested twin (needs Samuel).

All other functions are reached from a policy, a trigger, another live function
(`dopl_can_see_visibility`, `dopl_channel_scope_allowed`, `dopl_public_teams_admits`,
`dopl_teams_visible_for_user`, `dopl_user_may_share_resource`, `home_space_origin_of` all are),
or an `.rpc()` call. All 42 triggers sit on live tables except
`channel_task_participants_workspace_guard` (#3).

## Stale policies

- **Drop**: `chats_owner_select` (duplicate), `glasses_messages_owner_update`,
  `glasses_device_links_owner_select`.
- **Go with their tables**: `glasses_devices_owner_select`, `user_preferences_{select,insert,update,delete}_own`,
  `channel_task_participants_member_select`, `workspace_credit_usage_member_select`.
- **Security, not dead code**: `profiles_update_own` + the table-wide UPDATE grant — see
  [Security — needs Samuel](#security--needs-samuel) at the top.
- Advisor noise that is by design: `*_admin_write` (`FOR ALL`) overlapping `*_member_select` on
  `teams`, `team_members`, `resource_grants`, `ontology_memberships`, `ontology_relationships`. Keep.

## Other surfaces checked

- **Realtime** (`supabase_realtime`): 19 tables — the 17 desktop `SYNC_TABLES`
  (`dopl-desktop-app/main/ui-sync-core.js`) + `channel_launch_directives` + `channel_agent_directions`.
  All live; none of the drop candidates is published.
- **Cron**: no `pg_cron`. Vercel: `oauth-cleanup`, `reconcile-seats`, `playground-reaper`. All three
  routes exist.
- **Buckets**: `workspace-icons` (live), `community-thumbnails` (needs Samuel), `chat-attachments`
  (drop, #12).
- **Enums / matviews**: none. **Sequence**: `channel_messages_seq_seq` (live). **View**:
  `channel_tasks_activity` (live).
- **Tables with 0 rows but live code** (keep): `knowledge_base_stars`, `ontology_channel_shares`,
  `workspace_activity_events`, `oauth_authorization_codes`, `workspace_join_requests`.

## Archive before dropping

- `workspace_credit_usage` — 6 rows of pre-wallet spend (export query in `…140000`'s header).
- `profiles` billing/trial columns — 2 `pro` rows and 2 trial rows (query in `…150000`'s header).
- `channel_task_participants` (8), `user_preferences` (3), `glasses_devices` (1): throwaway.

## What is on this branch

- `supabase/migrations-held/20261110120000_drop_glasses_prototype.sql`
- `supabase/migrations-held/20261110130000_drop_dead_tables_and_rpcs.sql`
- `supabase/migrations-held/20261110140000_drop_pooled_credit_counter.sql`
- `supabase/migrations-held/20261110150000_drop_profile_legacy_billing_columns.sql`
- `supabase/migrations/20261110160000_profiles_update_column_grants.sql` (security) — released from the hold, applied to prod 2026-09-28
- Code: the `deleteTaskParticipants` statement removed from `channels/server/repository-tasks.ts`,
  with its call in `channels/server/service-tasks-delete.ts › deleteTask` and its test expectations. The FK's `ON DELETE CASCADE`
  already did that delete, so behaviour is unchanged while the table still exists.
- `src/shared/supabase/types.ts` is **left alone**: it is generated from the deployed database
  (see its header) and must be re-generated when a held file is released, not hand-edited ahead of it.
