# Security Audit — Plain-English Report

## TL;DR

The app is in **reasonably good shape** for a pre-launch product. The auth architecture is consistent (one set of wrappers, used almost everywhere), API keys are hashed before storage, the Stripe webhook validates signatures, and the ingestion pipeline has a real SSRF guard that blocks AWS metadata IPs / localhost / private networks. There is **no obviously catastrophic hole** (no public service-role key, no `eval`, no broken auth wrapper).

The top three things to fix before more users join:
1. **Legacy admin keys endpoint (`/api/admin/keys/[id]`)** uses a plain string `===` to compare the admin secret. That's a textbook timing-attack target and the sibling endpoint already fixed it — they're inconsistent.
2. **Stripe checkout-status route lets any logged-in user read any other user's checkout-session email** by guessing a session ID. Low realistic impact (Stripe IDs are random-ish), but easy to fix.
3. **No spend cap on Anthropic-backed routes** (chat, conversation title, ingestion). A single paid user can rack up unbounded Anthropic spend. There's a per-API-key request-rate-limit, but no dollar ceiling.

Everything else found is medium or low severity. RLS coverage and the SSRF / file-validation / webhook-verification stories are all solid.

---

## 🔴 Critical (fix before more users join)

_(None found. Read that as "I didn't find an unlocked door" — not "the building is impenetrable.")_

---

## 🟠 High

### Anthropic-backed routes have no spend cap
- **What it is** A logged-in user can keep calling the chat and title endpoints, each of which spends real money against your Anthropic API key. There's no per-user dollar cap, only per-API-key request-per-minute rate limits.
- **Where**
  - `src/app/api/chat/route.ts:258-267` — up to 5 tool-calling iterations per request, `max_tokens: 8192`, no usage tracking
  - `src/app/api/conversations/title/route.ts:74-79` — one Anthropic call per "name this conversation"
  - `src/app/api/ingest/prepare/route.ts` and the broader ingestion pipeline
- **Why it matters** A motivated trial user (or a compromised paid account) can burn through your Anthropic budget in hours. The "free vs paid" gate at `withMcpAccess` controls *whether* they can call the endpoint, not *how much* they can spend once gated in.
- **How to fix** Track per-user Anthropic token spend per day (cheap to log via `usage` on the SDK response), and bounce 402/429 when a user crosses a daily ceiling. As a stopgap, lower the chat's `MAX_ITERATIONS` from 5 and reduce `max_tokens` to ~2-4K.

### Stripe checkout-status leaks another user's email
- **What it is** Any authenticated user can pass a guessed Stripe checkout session ID and get the customer email back.
- **Where** `src/app/api/billing/checkout/status/route.ts:5-14`
- **Why it matters** Even though Stripe session IDs are pseudo-random and not enumerable in practice, the principle is wrong — the endpoint doesn't check that the session belongs to the calling user. If session IDs ever leak (e.g., via a server log or analytics), an attacker logged in as anyone can resolve them to an email.
- **How to fix** Look up the session, compare `session.metadata?.userId` (which you already set during create) to the calling user's ID, and 403 if it doesn't match.

### Admin keys [id] endpoint uses non-constant-time secret comparison
- **What it is** The DELETE endpoint that revokes API keys via the legacy admin shared secret compares strings with `===`, which leaks the secret one byte at a time through response timing.
- **Where** `src/app/api/admin/keys/[id]/route.ts:12` — `return token === secret;`
- **Why it matters** The sibling endpoint at `src/app/api/admin/keys/route.ts` already uses `timingSafeEqual` (lines 67-83) plus an IP-rate-limit map. This one doesn't. The legacy admin path is a low-traffic surface, but the inconsistency tells you the fix was started and not finished.
- **How to fix** Replace the body of `checkAdminAuth` with a call to the `verifyAdminSecret` helper that already exists in the sibling file. Add the same IP rate-limit while you're there.

### Profile email field is exposed by `/api/user/profile` even though it's only the caller's own — but it's surfaced through the workspace members endpoint to all co-members
- **What it is** Any active workspace member can list all other members' emails via `/api/workspaces/[workspaceSlug]/members`.
- **Where** `src/app/api/workspaces/[workspaceSlug]/members/route.ts:43-64`
- **Why it matters** This is *probably intentional* for a collaborative product, but it's worth surfacing: invite someone to your workspace and they see everyone's signup email. If the audience is paid B2B teams this is fine; if any workspace might contain hostile members (e.g., shared community workspaces), the email exposure is a privacy issue.
- **How to fix** Decide explicitly. If you want emails visible, document it on the invite-acceptance screen. If not, drop the email field from the hydrated response and surface only display name + avatar.

---

## 🟡 Medium

### Cron endpoints are protected by a single shared secret with no rotation story
- **Where** `src/app/api/cron/trial-reactivation/route.ts:25-35`, `src/app/api/cron/knowledge-trash-purge/route.ts:21-35`, `src/app/api/ingest/cleanup-pending/route.ts:30-44`
- **Why it matters** All three accept `Authorization: Bearer <CRON_SECRET>`. The check is `auth !== \`Bearer ${secret}\`` — string `!==`. Same timing-attack story as the admin endpoint, with the added complication that these are *destructive* (the trash-purge does hard deletes). The good news: they fail closed when `CRON_SECRET` is unset.
- **How to fix** Switch to `timingSafeEqual`. Optionally tie cron auth to Vercel's signed `Authorization` header pattern (`x-vercel-signature`) instead of a shared secret.

### `published_clusters` user_id is leaked to anonymous users
- **Where** `src/features/community/server/query.ts:78,139` — the listing response includes `author.id = r.user_id`
- **Why it matters** It's a Supabase auth UUID. Knowing user IDs isn't a hard-fail security issue (you can't log in with one), but it does enable enumeration if another endpoint trusts UUIDs as bearer-equivalent (none do today, but it's an attack-surface seed). More concretely: if anyone publishes a cluster, their auth UUID becomes public forever.
- **How to fix** Add a `public_id` column on `profiles` (you've done this for `workspaces`, `knowledge_bases`, `skills` already — see `20260504000000_workspaces_public_id.sql`). Return the public ID instead of `auth.users.id`.

### OAuth callback finalizes without verifying initiator
- **Where** `src/app/api/integrations/[provider]/callback/route.ts:37-66` calls `finalizeConnectionCallback({ brokerConnectionId })` where `brokerConnectionId` is whatever the URL says.
- **Why it matters** The route is intentionally public (it's where the OAuth popup lands), but a request with someone else's `connectedAccountId` would finalize *their* pending OAuth, granting their account to *your* (the attacker's) workspace via the auto-grant logic. Realistic likelihood: low — Composio connection IDs are random and short-lived — but the code doesn't bind the callback to the initiating user via a `state` parameter or a CSRF-style nonce.
- **How to fix** Generate a single-use nonce when you call `connectIntegration` (already exists), include it in the OAuth `state` round-trip, and verify it on the callback before finalizing.

### Service-role Supabase client is a process-wide singleton
- **Where** `src/shared/supabase/admin.ts:16-27`
- **Why it matters** Almost every route does `const supabase = supabaseAdmin()` at module scope (e.g., `src/app/api/canvas/panels/[panelId]/route.ts:7`). One bug in any code path that accidentally exposes the client (e.g., re-exporting it from a barrel that gets bundled to the client) leaks full DB write access. The risk is architectural, not exploited today.
- **How to fix** Continue treating service-role calls as a strictly-server pattern. Tighten the `server-only` import pattern that ENGINEERING.md already mandates. Add an ESLint rule that forbids `supabaseAdmin` imports outside `**/server/**` directories.

### Knowledge-pack sync endpoint uses HMAC with no body uniqueness / replay protection
- **Where** `src/app/api/knowledge/packs/[packId]/sync/route.ts:30-36`
- **Why it matters** The signature is over the empty (or arbitrary) body. An attacker who once captures a valid `X-Dopl-Signature` header can replay the sync call indefinitely (sync is idempotent today, so impact is small, but the pattern is brittle).
- **How to fix** Include a timestamp in the signed body (`{"t": <epoch>}`) and reject signatures older than ~5 minutes. Standard HMAC-with-timestamp pattern.

### `withUserAuth` rejects user_id=null API keys at runtime, but legacy admin endpoint creates them
- **Where** `src/app/api/admin/keys/route.ts:148` — `createApiKey(name.trim())` with no user_id parameter
- **Why it matters** A key minted here has `user_id = null`. It can still authenticate against `withExternalAuth` routes (e.g., `/api/embed`, `/api/tags`, `/api/github/contents`). Those endpoints are read-mostly, but the keys aren't tied to a specific human, which means revoking them on user deletion fails silently.
- **How to fix** Either delete the legacy admin keys endpoint (the workspace-scoped keys endpoint is the modern path) or require it to take a `user_id` in the body so all keys are owned by a real account.

### IP rate-limit map is in-process, not persisted
- **Where** `src/app/api/admin/keys/route.ts:9-13` — `const failedAttempts = new Map<...>()`
- **Why it matters** On Vercel's serverless, each lambda instance has its own map. The 5-attempts-per-minute counter is per-instance, so an attacker hitting from many concurrent connections can multiply attempts by however many warm instances exist. The file's own comment acknowledges this.
- **How to fix** Move to a Postgres-backed counter (you have a `check_and_record_rate_limit` RPC pattern that handles this for API keys — extend it) or accept the limitation and document it.

### Account-deletion endpoint best-effort-cleans-up cascading rows
- **Where** `src/app/api/user/delete/route.ts:153-156` — `Promise.all([...]).catch(() => {})`
- **Why it matters** If a delete fails silently, the user's data lingers. Not a security hole exactly, but a privacy / GDPR exposure: the user thinks their account is gone, but their published clusters or conversations may not be. The cascading FK behaviors are described in a comment but not actually enforced by the migration set checked in here.
- **How to fix** Either drop the swallow (`.catch(() => {})` → log + 500) so the user knows to retry, or add a follow-up cleanup cron that retries failed deletions and alerts on backlog.

### Workspace member listing fans out a separate `auth.admin.getUserById` per member
- **Where** `src/app/api/workspaces/[workspaceSlug]/members/route.ts:43-64`
- **Why it matters** Performance more than security. Each call is a separate API hit to Supabase Auth. A workspace with 100 members causes 100 sequential calls in a single request — easy DoS vector against your own quota. (The code caps at 100, but that's not a small number.)
- **How to fix** Batch via `auth.admin.listUsers({ filter: ... })` or denormalize email/display name into the `workspace_members` table.

---

## 🟢 Low / nitpicks

- **Console-error spam includes broker connection IDs and entry IDs in `[integrations]` and `[prepare]` paths.** Not secrets, but adds noise that could mask real issues.
- **`Math.random()` is used in `touchApiKey` to decide whether to run cleanup** (`src/shared/auth/api-keys.ts:109`). Fine for sampling, just flagging it isn't `crypto.randomInt` if any future caller copy-pastes the pattern for a security-sensitive coin flip.
- **The `proxy.ts` middleware allows `/api/admin/*` to bypass session checks** because admin routes have their own ADMIN_SECRET or `withAdminAuth` gating. This is correct, but the comment at `src/proxy.ts:112-115` is the only doc; if someone adds a non-admin-gated route under `/api/admin/`, the bypass will silently expose it.
- **`/api/community` accepts `?limit=` up to 50 with no other guardrail.** A single request returns 50 published clusters with thumbnail URLs. Fine, but if the field set ever grows (e.g., adding `panels` to the listing), reconsider.
- **Email sent by Resend in trial-reactivation cron uses a static discount code `COMEBACK30`.** Not a security issue, but if someone scrapes the page that mentions the code, they can use it without ever having had a trial. Tie the code to the user via Stripe's `customer_discounts` API.
- **OG image routes are `runtime: "edge"`** and slice user-supplied query params to small caps. Already safe — flagging because edge runtime has different reachability semantics if you ever add secrets here.
- **`src/app/api/admin/keys/route.ts` accepts a `name` field with no length/charset validation** before storing it. Worst case is a giant name string in the DB — no XSS surface because the field is only ever rendered in the admin dashboard, but worth bounding.
- **`canvas_state.clusters` is a JSONB blob accepted as-is from the client.** It's scoped to the user's own workspace_id, so the worst case is they corrupt their own canvas state.
- **No automated dependency scanning.** `lucide-react: ^1.7.0` looks like a typo or a pinned fork — the real lucide-react is at v0.x. Worth verifying in package-lock.json.

---

## What's actually well-defended

- **The auth wrapper pattern is consistent.** I checked all ~100 route handlers; the only ones lacking a wrapper are either intentionally public (community read endpoints, Stripe webhook, OAuth callback, invitation lookup-by-token, OG images) or use a different but appropriate auth model (CRON_SECRET for crons, ADMIN_SECRET for legacy admin, HMAC for pack-sync). Nothing was an oversight.
- **API keys are hashed with SHA-256 before storage** (`src/shared/auth/api-keys.ts:22-24`) and only the prefix is ever shown in listings.
- **The Stripe webhook validates signatures with the official SDK before trusting the payload** (`src/app/api/billing/webhook/route.ts:25` → `constructWebhookEvent`), and event IDs are deduped via a `webhook_events` table with a two-phase commit (lines 36-59). Good idempotency.
- **The SSRF guard (`src/features/ingestion/server/url-safety.ts`) is unusually thorough** — covers 169.254.x metadata, all RFC1918 ranges, IPv6 link-local, IPv4-mapped IPv6 addresses, and CGNAT 100.64/10. It's wired into `/api/ingest/prepare`, `/api/admin/skeleton-ingest`, `describeLink`, and the simple-HTTP web extractor. Firecrawl/Jina paths delegate the URL fetch to the upstream service, which is fine.
- **File uploads in `/api/chat/upload` magic-byte-validate every file** against the claimed MIME type, not just the extension (`route.ts:37-76`). NUL-byte detection catches binary smuggled as text. This is the right pattern.
- **Open-redirect on the login `redirectTo` param is properly handled** via `src/shared/lib/url/safe-redirect.ts` — rejects `//evil.com`, `/\\evil.com`, and absolute URLs.
- **RLS is enabled on workspace-scoped tables** (`workspaces`, `workspace_members`, `workspace_invitations`, `canvases`, `canvas_panels`, `canvas_state`, `clusters`, `conversations`, `cluster_brains`, `cluster_brain_memories`, `knowledge_bases`, `knowledge_folders`, `knowledge_entries`, `skills`, `skill_files`, `cluster_knowledge_bases`, `cluster_skills`, `oauth_connections`, `oauth_connection_grants`, `workspace_resource_access`, `writeback_audits`, `chat_attachments`, `conversion_events`). Policies are workspace-membership-aware via a `is_workspace_member()` SECURITY DEFINER function with explicit grant ordering. The `WITH CHECK` clauses on UPDATE policies prevent workspace-id smuggling.
- **Workspace-scoped API keys can't be used cross-workspace** — `withWorkspaceAuth` rejects mismatched `X-Workspace-Id` headers (lines 88-100 of `src/shared/auth/with-workspace-auth.ts`).
- **Admin routes return 404 instead of 403 to non-admins** (`src/shared/auth/with-auth.ts:439`), so admin endpoints aren't enumerable.
- **Boot-time warnings if `ADMIN_USER_ID` / `ADMIN_SECRET` are unset** (`src/shared/auth/with-auth.ts:410-420`) — fails closed and tells you about it loudly.
- **Workspace invitation tokens are 256 bits of crypto-random entropy** (`src/features/workspaces/server/invitations.ts:31`).
- **No `eval`, `new Function`, or user-controlled `dangerouslySetInnerHTML` in production paths.** The two `dangerouslySetInnerHTML` uses are both static (a pre-hydration script and a marketing constant).
- **Account-deletion correctly cancels the Stripe subscription FIRST** so users can't accidentally keep getting billed after deletion (`src/app/api/user/delete/route.ts:84-108`).
- **The chat tool surface is allowlisted server-side** — only the specific tools in `WORKSPACE_TOOLS` / `PRIVATE_TOOLS` can be executed, regardless of what the model emits (`src/app/api/chat/route.ts:231`).
- **Account-deletion blocks if the user owns workspaces with other active members** (`src/app/api/user/delete/route.ts:28-82`). Prevents accidental nuking of co-members' data.

---

## Notes on scope

- The migrations folder only contains April 2026 onward. Earlier table definitions (`entries`, `api_keys`, `profiles`, `chunks`, `sources`, `published_clusters`, etc.) live in the Supabase project but aren't in the repo. I verified those tables are accessed exclusively via the `supabaseAdmin` service-role client from server routes that do their own ownership checks — so app-layer authorization is correct even if RLS is missing on them. **If you ever expose the anon key to a client and let it talk directly to those tables, you need to verify RLS is enabled in the cloud project.** A `select count(*) from pg_tables t left join pg_policies p on p.tablename = t.tablename where t.schemaname = 'public' and p.policyname is null;` against your live DB will tell you exactly which tables have RLS off.
- I did not run the test-rls.ts script (`scripts/test-rls.ts`) since you asked for read-only analysis. Running it against a clean Supabase project would confirm the policy coverage end-to-end.
- The repo's `packages/` directory mentions a Chrome extension in ENGINEERING.md, but the actual `packages/` folder only contains `cli`, `dopl-client`, and `mcp-server`. No browser-extension CORS surface to audit.
