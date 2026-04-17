# Manual testing

Step-by-step checks to run before shipping features that don't have automated coverage yet. Grouped by feature so you can jump to whichever section matters for what you're shipping.

Prerequisites that apply to every section:

- Dev server running: `npm run dev` (Next.js app) and, for MCP tests, the MCP server connected to your local Claude Code via the config in your `~/.claude/`.
- Migrations applied: `supabase db push` (or whatever your workflow is).
- Signed in with a real user account that has either an active trial or a paid subscription — queuing URLs is free but the downstream ingestion claim is access-gated.

---

## Pending ingestion — queue path

The site chat creates `pending_ingestion` skeleton entries; the user's connected MCP agent picks them up via the `_dopl_status` footer on every Dopl tool response.

### 1. Migration sanity

Run these in the Supabase SQL editor (or `psql`) right after applying the migration.

```sql
-- Partial index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'entries'
  AND indexname = 'entries_pending_ingestion_idx';
-- Expect: 1 row with WHERE (status = 'pending_ingestion'::text) in the def.

-- Entries is in the realtime publication
SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'entries';
-- Expect: 1 row.
```

### 2. Realtime RLS — CRITICAL check

Supabase realtime honors RLS on the subscribing client. Without a SELECT policy covering own-rows, `use-entries-realtime.ts` will subscribe fine and receive zero events. **If the amber tile never flips to processing after your agent claims it, this is almost always why.**

```sql
-- A) Is RLS enabled on entries?
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'entries';
-- If relrowsecurity = false: RLS is off, realtime will deliver everything
--   to every authed client. Works but not ideal from a privacy angle.
-- If relrowsecurity = true: continue to (B).

-- B) List every policy on entries
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'entries'::regclass
ORDER BY polname;
-- You need at least one SELECT policy (polcmd = 'r') whose USING expression
-- lets signed-in users see their own rows, e.g.:
--   (auth.uid() = ingested_by)
-- or:
--   (moderation_status = 'approved' OR auth.uid() = ingested_by)

-- C) Simulate a signed-in user reading their own pending row
-- Replace <USER_UUID> with a real user's auth.users.id.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '<USER_UUID>';
SELECT id, status, ingested_by
FROM entries
WHERE status = 'pending_ingestion'
  AND ingested_by = '<USER_UUID>'::uuid
LIMIT 5;
RESET ROLE;
-- Expect: the rows the user queued. If you get 0 rows here but the row
-- exists via the service-role query, add a SELECT policy and retry.
```

If (C) returns nothing when it shouldn't, add a policy like this (tune to your product's privacy model):

```sql
-- Example only — adapt to your existing moderation model
CREATE POLICY "entries_select_own_or_approved"
  ON entries FOR SELECT
  USING (auth.uid() = ingested_by OR moderation_status = 'approved');
```

### 3. Queue a URL from the site chat

1. Go to `/canvas`. Open a chat panel.
2. Paste a URL that is NOT already in your DB (e.g. a fresh GitHub repo link).
3. Observe:
   - **Chat badge** reads `Queued for ingestion` (NOT `Done` or `Started ingestion`).
   - **Canvas** spawns a new entry panel with an amber-tinted border and a banner reading `Queued — your connected MCP agent will pick this up...`.
   - **Entries page** (`/entries`) shows an amber strip at the top: `Your queued URLs (1)` with the URL listed.

Verify the DB row:

```sql
SELECT id, source_url, status, ingested_by, created_at
FROM entries
WHERE source_url = '<the URL you pasted>'
ORDER BY created_at DESC LIMIT 1;
-- Expect: status = 'pending_ingestion', ingested_by = your user id.
```

### 4. Chat summary bug regression

This was broken before — the chat used to render `Done` even when the tool refused. Paste any URL and confirm the tool_activity badge never shows a misleading status.

| Tool outcome            | Expected badge copy           |
| ----------------------- | ----------------------------- |
| New skeleton created    | `Queued for ingestion`        |
| Pasted twice (same user)| `Queued for ingestion`        |
| Pre-existing complete   | `Already ingested`            |
| In-flight processing    | `Started ingestion`           |
| Error (bad URL, SSRF)   | `Ingestion error`             |

### 5. Dedup on re-paste

1. Paste the same URL again (same user, same chat or a new one).
2. Expect: same `entry_id` returned, one amber tile on the canvas (not two), badge reads `Queued for ingestion`.
3. SQL check:

```sql
SELECT COUNT(*) FROM entries
WHERE source_url = '<the URL>'
  AND ingested_by = '<your user id>'::uuid
  AND status = 'pending_ingestion';
-- Expect: 1
```

### 6. MCP `_dopl_status` footer

With at least one queued URL in the DB:

1. In your connected agent (Claude Code, Cursor, whatever speaks MCP), call any Dopl tool — `search_setups` with a trivial query works.
2. Inspect the raw tool response. It should end with a footer like:

```
---
_dopl_status:
  pending_ingestions: 1
  hint: "Call `list_pending_ingests` to see queued URLs, then `prepare_ingest(url)` to claim and process."
```

Zero-state check: drain the queue (or test as a user with none), call the same tool, confirm **no** footer appears. Footer on zero-state is the noise regression to guard against.

### 7. Agent claim flow (the core UX)

1. Leave `/canvas` open in your browser so you can watch the amber tile.
2. In your connected agent, say something casual like `hi` or `any pending work?`. With the server instructions + footer, it should proactively offer: "You have N URL(s) queued on Dopl — want me to process them?"
3. Say `yes`.
4. Watch the agent call `list_pending_ingests`, then `prepare_ingest(url)` for each queued URL.
5. **In the browser, the amber tile should flip to the purple ingesting state within ~1s** of the `prepare_ingest` call (realtime update). If it doesn't flip, go back to §2 and check RLS.
6. SQL confirmation:

```sql
SELECT status, updated_at FROM entries WHERE id = '<entry_id>';
-- Expect: status = 'processing' (then 'complete' once submit_ingested_entry finishes).
```

### 8. Claim race

Open two MCP client sessions (two Claude Code windows, or Claude Code + Cursor). With one URL queued:

1. In both sessions, fire `prepare_ingest(url)` with the same URL at roughly the same moment (easiest: prep both prompts, hit Enter in both as fast as you can).
2. Expect: exactly one session returns the prepare bundle (`status: "ready"`); the other returns `already_exists` with a message like "Another request just claimed this pending ingestion."
3. DB row count stays at 1 — no duplicate was created.

### 9. Content-guard revert (paywalled URL)

This tests the bug fix from the last review — a claimed pending row should revert on empty-content failure, not silently vanish.

1. Queue a paywalled or auth-walled URL (e.g. a private gist, a WSJ article you're not logged into).
2. Have the agent process it via `prepare_ingest`.
3. `prepare_ingest` should throw with the `Content appears empty or inaccessible` message.
4. SQL check:

```sql
SELECT status FROM entries WHERE id = '<entry_id>';
-- Expect: status = 'pending_ingestion' (reverted, NOT deleted).
```

The amber tile should still be on the canvas, and the agent can try again (or the user can delete it manually).

### 10. 7-day TTL cron

The cleanup endpoint is wired to Vercel Cron at `/api/ingest/cleanup-pending`, running at `17 4 * * *` (4:17am UTC daily).

**Manual trigger (bypass the schedule):**

```bash
# Replace with your actual CRON_SECRET and host.
curl -i "https://<your-host>/api/ingest/cleanup-pending" \
  -H "Authorization: Bearer $CRON_SECRET"
# Expect: 200 { "status": "ok", "deleted": N, "cutoff": "..." }
```

**Simulate a 7-day-old row locally:**

```sql
-- Backdate one of your pending rows
UPDATE entries
SET created_at = now() - interval '8 days'
WHERE status = 'pending_ingestion'
  AND id = '<entry_id>';

-- Then hit the endpoint with Bearer CRON_SECRET
-- Then confirm:
SELECT * FROM entries WHERE id = '<entry_id>';
-- Expect: 0 rows.
```

**Auth regression:**

```bash
# No auth header
curl -i "https://<your-host>/api/ingest/cleanup-pending"
# Expect: 401

# Wrong secret
curl -i "https://<your-host>/api/ingest/cleanup-pending" \
  -H "Authorization: Bearer wrong"
# Expect: 401

# With CRON_SECRET env var unset (staging only)
# Expect: 503
```

### 11. No-MCP fallback UI

Sign in as a user who has never connected an MCP agent.

1. Paste a URL. Expect: amber tile appears same as authed-with-MCP case.
2. The banner on the entry panel should say `Queued — your connected MCP agent will pick this up... No connected agent? Connect one.` with the last bit linking to `/settings/connections`.
3. The tile persists indefinitely (well, until the 7-day TTL). The user can leave and come back — the queue is durable.

### 12. Multi-tab behavior (known limitation)

Open `/canvas` in two tabs for the same user.

- Paste a URL in tab A → amber tile appears in tab A (chat-dispatched). Tab B does NOT show the new tile live — realtime subscribes only to UPDATE events, not INSERT.
- Have the agent process the URL → tile flips to processing in **both** tabs (that's an UPDATE).

This is per the approved design, not a bug. Mentioning it so nobody files it as one.

---

## Other sections

(Add more testing groups here as features ship — e.g. `Canvas sync`, `Cluster brain editing`, `Billing / access gate`.)
