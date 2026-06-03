# Dopl — Functionality Map & Dead Code Report

## Product TL;DR

Dopl is a workspace product where a user can build a personal "knowledge base" of AI/automation setups (knowledge bases + skills + clusters with a brain) and expose it to their AI agent (Claude Code, etc.) through an MCP server, a CLI, and a public REST API. The product surface is an infinite canvas where users drop in panels (entries, knowledge bases, skills, chat) and group them into clusters; each workspace also has dedicated pages for chat, knowledge, skills, integrations, members, and overview.

## Surface Inventory

- **User-reachable pages**: ~24 (landing, login, pricing, docs, community list/detail/posts, browse entries/clusters/saved, entry detail, workspaces list, workspace overview/chat/canvas/knowledge/skills/members/settings/integrations, settings root + 4 sub-pages, invite/[token], privacy, terms)
- **Legacy/redirect pages**: 5 (`/canvas`, `/entries`, `/browse` root, `/[workspaceSlug]/integrations`, `/[workspaceSlug]`)
- **Orphan / no-link pages**: 3 (`/build`, `/design`, `/admin/*`)
- **API endpoints**: ~125 route handlers under `src/app/api/`
- **MCP tools exposed**: ~50 (`packages/mcp-server/src/server.ts` + `tools/{integrations,knowledge,skills}.ts`)
- **CLI commands**: 4 namespaces — `auth` (login/logout/whoami), `workspace` (list/current/use/clear), `packs` (list/files/get), `mcp` (config)
- **Chrome extension**: **MISSING** — docs (`docs/ENGINEERING.md:31, REFACTOR-FINDINGS.md:84,97,100`) reference `packages/chrome-extension/` but the directory does not exist in the repo
- **DB tables (current)**: ~30 (entries, sources, chunks, tags, workspaces, workspace_members, workspace_invitations, workspace_resource_access, canvases, canvas_panels, knowledge_bases, knowledge_folders, knowledge_entries, knowledge_packs, knowledge_pack_files, skills, skill_files, cluster_brains, cluster_brain_memories, cluster_knowledge_bases, cluster_skills, clusters, profiles, api_keys, oauth_connections, oauth_connection_grants, conversion_events, system_events, writeback_audits, etc.)
- **Dropped tables (tombstones)**: `canvases`+`canvas_members`+`canvas_invitations` (old per-canvas model, replaced by workspaces in migration `20260430190046`), the original `oauth_connections` table (dropped+recreated user-level in `20260505010000`)
- **Cron jobs (vercel.json)**: 3 — `/api/cron/trial-reactivation` (hourly), `/api/ingest/cleanup-pending` (daily), `/api/cron/knowledge-trash-purge` (daily)

---

## Functionality Map

### analytics
- **What it does**: Server-only telemetry — logs admin/system events, conversion events, and aggregates "launch funnel" metrics for the admin analytics dashboard.
- **User-facing pages**: none directly (powers `/admin/analytics`)
- **API endpoints**: none directly; consumed by other features (`/api/billing/webhook`, `/api/cron/trial-reactivation`, `/api/user/delete`, ingest/cleanup-pending, etc.)
- **MCP tools**: none (server-only)
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: `system_events`, `conversion_events`, `writeback_audits`, `profiles` (mcp_connected_at column)
- **Status**: ACTIVE

### api-keys
- **What it does**: Lets the user create + view API keys (`sk-dopl-*`) and shows install instructions for the Dopl MCP / CLI. Renders the "Connect your app" card on the workspace overview page and the per-workspace keys list.
- **User-facing pages**: `/[workspaceSlug]/overview`, `/[workspaceSlug]/settings`, `/settings/keys`
- **API endpoints**: `/api/user/keys`, `/api/user/keys/[id]`, `/api/workspaces/[workspaceSlug]/keys`, `/api/workspaces/[workspaceSlug]/keys/[id]`, `/api/admin/keys`, `/api/admin/keys/[id]`, `/api/user/mcp-status` (live-connection ping)
- **MCP tools**: implicit — every MCP call authenticates with an API key
- **CLI commands**: `dopl auth login/logout/whoami`
- **Chrome extension**: would consume same keys if it existed
- **Database tables**: `api_keys`, `profiles.mcp_connected_at`
- **Status**: ACTIVE

### billing
- **What it does**: Stripe-driven subscription gate — 24h free trial, then $7.99/mo Pro. Renders pricing page, embedded Stripe Elements checkout, paywall modal (blocks the canvas when expired), and admin upgrade flows. Exposes Stripe webhook.
- **User-facing pages**: `/pricing`, `/settings/billing`, paywall overlay on `/[workspaceSlug]/[canvasSlug]`
- **API endpoints**: `/api/billing/checkout`, `/api/billing/checkout/status`, `/api/billing/portal`, `/api/billing/status`, `/api/billing/access`, `/api/billing/webhook`
- **MCP tools**: none (subscription tier is checked inside `withMcpAccess` wrapper)
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: `profiles` (trial_expires_at, reactivation_email_sent_at, subscription_status), Stripe records
- **Status**: ACTIVE
- **Sub-notes**:
  - `UpgradeModal` in `src/features/billing/components/upgrade-modal.tsx` is **ORPHANED** (defined, never imported). `PaywallModal`/`PaywallGate` are the live ones.

### builder
- **What it does**: Three-pane "Builder" UI (sidebar cluster picker + center chat + right panel) layered over the canvas store. Renders only at `/build`.
- **User-facing pages**: `/build` only
- **API endpoints**: none direct; reads canvas state via CanvasProvider, posts chats via `/api/chat`
- **MCP tools**: none
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: canvas_panels, clusters, cluster_brains, conversations (via canvas store)
- **Status**: **ORPHANED** — `/build` is only linked from the also-orphan `/design` showcase. Not in the sidebar, not in marketing, not in user-facing nav.

### canvas
- **What it does**: The core infinite-canvas product surface. Users drag panels around, group into clusters, click panels to open chat, etc. The whole canvas-store reducer + provider lives here.
- **User-facing pages**: `/[workspaceSlug]/[canvasSlug]` (also `/canvas` → redirect, `/build` → orphan, `/community/[slug]` reuses canvas-style layout)
- **API endpoints**: `/api/canvas/state`, `/api/canvas/state/migrate` (orphaned localStorage-import endpoint), `/api/canvas/panels`, `/api/canvas/panels/[panelId]`, `/api/canvas/panels/batch`
- **MCP tools**: `canvas_list_panels`, `canvas_add_entry`, `canvas_remove_entry`, `canvas_search_and_add`, `canvas_create_cluster`
- **CLI commands**: none direct
- **Chrome extension**: n/a (panels are app-internal)
- **Database tables**: `canvas_panels`, `canvases`, `clusters`, `cluster_brains`, `cluster_brain_memories`, `cluster_knowledge_bases`, `cluster_skills`
- **Status**: ACTIVE
- **Sub-notes**:
  - `FixedChatSidebar` in `src/features/canvas/fixed-chat-sidebar.tsx` has zero consumers — **ORPHAN**.
  - `/api/canvas/state/migrate` exists for one-time localStorage import but no caller in repo — **POSSIBLY DEAD** (kept around for legacy clients).

### chat
- **What it does**: Conversational chat UI in two surfaces: the workspace `/[workspaceSlug]/chat` page (private mode, full agent toolset incl. integrations) and embedded chat panels on the canvas (workspace mode). Calls Anthropic Claude with a tool catalogue (search, brain, knowledge, skills, integrations, artifacts).
- **User-facing pages**: `/[workspaceSlug]/chat`, embedded in canvas panels
- **API endpoints**: `/api/chat`, `/api/chat/upload`, `/api/chat/attachment-url`, `/api/conversations`, `/api/conversations/[panelId]`, `/api/conversations/title`
- **MCP tools**: none (chat IS the tool host; tools are Anthropic-side, not MCP)
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: `conversations`, `chat-attachments` (storage bucket)
- **Status**: ACTIVE

### clusters
- **What it does**: Per-user cluster CRUD — visual groupings of canvas panels, each with a synthesized "brain" (instructions + memories) and optional attached knowledge bases / skills. The brain is now synthesized client-side; the server only stores results.
- **User-facing pages**: visible inside `/[workspaceSlug]/[canvasSlug]` (clusters render as halos around grouped panels)
- **API endpoints**: `/api/clusters`, `/api/clusters/[slug]`, `/api/clusters/[slug]/brain`, `/api/clusters/[slug]/brain/memories`, `/api/clusters/[slug]/query`, `/api/clusters/[slug]/knowledge-bases`, `/api/clusters/[slug]/knowledge-bases/[kbId]`, `/api/clusters/[slug]/knowledge-bases/[kbId]/entries`, `/api/clusters/[slug]/knowledge-bases/[kbId]/entries/[entryId]`, `/api/clusters/[slug]/skills`, `/api/clusters/[slug]/skills/[skillId]`, `/api/clusters/[slug]/skills/[skillId]/full`, `/api/cluster/synthesize` (now a GET-only prompt template)
- **MCP tools**: `list_clusters`, `get_cluster`, `update_cluster`, `rename_cluster`, `delete_cluster`, `query_cluster`, `get_cluster_brain`, `update_cluster_brain`, `save_cluster_memory`, `update_cluster_memory`, `delete_cluster_memory`, `read_cluster_knowledge_entry`, `read_cluster_skill`, `add_entry_to_cluster`, `check_cluster_updates`
- **CLI commands**: none direct
- **Chrome extension**: n/a
- **Database tables**: `clusters`, `cluster_brains`, `cluster_brain_memories`, `cluster_knowledge_bases`, `cluster_skills`
- **Status**: ACTIVE

### community
- **What it does**: Publish a cluster to a public gallery; browse other people's published clusters; fork one into your workspace. Public landing-style detail page with chat sidebar.
- **User-facing pages**: `/community`, `/community/[slug]`, `/community/posts` (user's own publishes)
- **API endpoints**: `/api/community`, `/api/community/[slug]`, `/api/community/[slug]/fork`, `/api/community/[slug]/panels`, `/api/community/posts`, `/api/community/publish`
- **MCP tools**: none (community is web-only)
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: `published_clusters`, plus reads `clusters`, `canvas_panels`, `entries`
- **Status**: ACTIVE

### entries
- **What it does**: The "catalog" of ingested setups — list/grid view, individual entry detail page (markdown + sources + tags), entry preview slide-out panel, "saved items" tracked in localStorage, smart chat search rail.
- **User-facing pages**: `/browse/entries`, `/browse/saved`, `/entries/[id]`, `/e/[slug]` (canonical public)
- **API endpoints**: `/api/entries`, `/api/entries/[id]`, `/api/entries/[id]/download`, `/api/entries/[id]/check-updates`, `/api/query`
- **MCP tools**: `search_setups`, `get_setup`, `list_setups`, `check_entry_updates`, `update_entry`, `delete_entry`, `read_cluster_knowledge_entry`
- **CLI commands**: none direct (CLI doesn't surface entries; uses packs instead)
- **Chrome extension**: would link to `/e/<slug>` if it existed
- **Database tables**: `entries`, `sources`, `chunks`, `tags`
- **Status**: ACTIVE (but the `/browse/*` UI is not linked from the main sidebar — see Dead Code)
- **Sub-notes**:
  - `FilterSidebar` (`src/features/entries/components/filter-sidebar.tsx`) — **ORPHAN**, no consumers.

### ingestion
- **What it does**: The URL → entry pipeline. Now client-only synthesis: server fetches & extracts content, hands the agent a synthesis prompt, agent posts back generated README/agents.md/manifest. SSE stream for live progress. Two ingest tiers: regular (prepare/submit, gated by trial+access) and skeleton (admin only).
- **User-facing pages**: surfaced inside canvas chat panels (artifacts-panel.tsx during ingest)
- **API endpoints**: `/api/ingest` (tombstoned, 410 Gone), `/api/ingest/prepare`, `/api/ingest/prepare-from-integration`, `/api/ingest/submit`, `/api/ingest/pending`, `/api/ingest/content/[entry_id]`, `/api/ingest/[id]/status`, `/api/ingest/[id]/stream`, `/api/ingest/cleanup-pending`, `/api/admin/skeleton-ingest`, `/api/links/describe`
- **MCP tools**: `ingest_url`, `submit_ingested_entry`, `list_pending_ingests`, `get_ingest_content`, `describe_link`, `skeleton_ingest` (admin only), `ingest_from_integration`
- **CLI commands**: none direct (the agent calls MCP tools)
- **Chrome extension**: would call `/api/ingest/prepare` if it existed
- **Database tables**: `entries`, `sources`, `chunks`, `tags`, `ingestion_logs`
- **Status**: ACTIVE

### integrations
- **What it does**: OAuth-connected third-party providers (notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack, attio) via Composio. Lets users connect once, then list/read objects + execute actions from chat. Used to ingest from integrations too.
- **User-facing pages**: `/settings/integrations` (and `/[workspaceSlug]/integrations` redirects there), `/connect/[provider]/popup-success`, `/connect/[provider]/popup-error`
- **API endpoints**: `/api/integrations/[provider]/connect`, `/api/integrations/[provider]/callback`, `/api/integrations/[provider]/disconnect`, `/api/integrations/[provider]/status`, `/api/integrations/[provider]/actions`, `/api/integrations/[provider]/execute`, `/api/integrations/[provider]/list`, `/api/integrations/[provider]/read`, `/api/integrations/connections`, `/api/integrations/connections/[connectionId]`, `/api/integrations/connections/[connectionId]/grants`, `/api/integrations/workspaces`
- **MCP tools**: `connect_integration`, `integration_status`, `list_my_integrations`, `list_integration_objects`, `read_integration_object`, `list_integration_actions`, `execute_integration_action`, `ingest_from_integration`
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: `oauth_connections`, `oauth_connection_grants`
- **Status**: ACTIVE

### knowledge
- **What it does**: User-owned hierarchical knowledge bases — bases > folders > entries (markdown notes). Has rich editor (TipTap), tree view, drag-drop, soft-delete trash with restore, full-text search, path-based addressing for the MCP. Bases can be marked "agent-writable" so agents can create/edit entries.
- **User-facing pages**: `/[workspaceSlug]/knowledge/[kbSlug]` (KB detail with tree + editor pane), sidebar collapsible KB list
- **API endpoints**: `/api/knowledge/bases`, `/api/knowledge/bases/[baseId]`, `/api/knowledge/bases/[baseId]/entries`, `/api/knowledge/bases/[baseId]/files`, `/api/knowledge/bases/[baseId]/folders`, `/api/knowledge/bases/[baseId]/folders-by-path`, `/api/knowledge/bases/[baseId]/move-by-path`, `/api/knowledge/bases/[baseId]/restore`, `/api/knowledge/bases/[baseId]/tree`, `/api/knowledge/entries`, `/api/knowledge/entries/[entryId]`, `/api/knowledge/entries/[entryId]/move`, `/api/knowledge/entries/[entryId]/restore`, `/api/knowledge/folders/[folderId]`, `/api/knowledge/folders/[folderId]/move`, `/api/knowledge/folders/[folderId]/restore`, `/api/knowledge/search`, `/api/knowledge/trash`, `/api/knowledge/trash/purge`, `/api/cron/knowledge-trash-purge`
- **MCP tools**: ~20 — `kb_list`, `kb_list_bases`, `kb_get`, `kb_get_tree`, `kb_create_base`, `kb_update_base`, `kb_delete_base`, `kb_restore_base`, `kb_list_dir`, `kb_create_folder`, `kb_delete_folder`, `kb_move_folder`, `kb_read_file`, `kb_write_file`, `kb_delete_file`, `kb_move_file`, `kb_list_trash`, `kb_restore_folder`, `kb_restore_file`, `kb_search`
- **CLI commands**: indirectly via the MCP server
- **Chrome extension**: n/a
- **Database tables**: `knowledge_bases`, `knowledge_folders`, `knowledge_entries`
- **Status**: ACTIVE

### knowledge-packs
- **What it does**: Read-only knowledge "packs" — content hosted in a GitHub repo (e.g. dopl/rokid-knowledge), synced into Supabase and exposed to MCP. Different from per-user knowledge bases — these are curated/shipped content.
- **User-facing pages**: none (MCP-only surface)
- **API endpoints**: `/api/knowledge/packs`, `/api/knowledge/packs/[packId]`, `/api/knowledge/packs/[packId]/file`, `/api/knowledge/packs/[packId]/files`, `/api/knowledge/packs/[packId]/sync` (HMAC-signed webhook)
- **MCP tools**: `kb_list_packs` (the rest of kb_* tools resolve packs too via the path syntax)
- **CLI commands**: `dopl packs list`, `dopl packs files`, `dopl packs get`
- **Chrome extension**: n/a
- **Database tables**: `knowledge_packs`, `knowledge_pack_files`
- **Status**: ACTIVE

### marketing
- **What it does**: The mock UI shown on the public landing page — animated demos of the sidebar, MCP install, knowledge tree, skills, teams.
- **User-facing pages**: only `/` (landing)
- **API endpoints**: none
- **MCP tools**: none
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: none
- **Status**: ACTIVE — but contains one orphan file (`page-top-bar.tsx`, see Dead Code)

### members
- **What it does**: Workspace member management — invite by email, accept invite, set role (owner/admin/member), per-resource access matrix (knowledge base / skill / canvas read vs edit). "My access" provider hydrates current user's permissions for the whole page tree.
- **User-facing pages**: `/[workspaceSlug]/members`, `/invite/[token]`, plus inline invitation accept in the sidebar workspace dropdown
- **API endpoints**: `/api/workspaces/[workspaceSlug]/members`, `/api/workspaces/[workspaceSlug]/members/[userId]`, `/api/workspaces/[workspaceSlug]/members/[userId]/access`, `/api/workspaces/[workspaceSlug]/my-access`, `/api/workspaces/[workspaceSlug]/invitations`, `/api/workspaces/[workspaceSlug]/invitations/[id]`, `/api/workspaces/invitations/[token]`, `/api/workspaces/invitations/[token]/accept`, `/api/invitations/pending`
- **MCP tools**: none
- **CLI commands**: none
- **Chrome extension**: n/a
- **Database tables**: `workspace_members`, `workspace_invitations`, `workspace_resource_access`
- **Status**: ACTIVE

### skills
- **What it does**: Skill = a procedural prompt template the agent invokes (SKILL.md + attached files). User-owned, workspace-scoped, supports versioning + soft-delete + trash + restore + file CRUD.
- **User-facing pages**: `/[workspaceSlug]/skills`, `/[workspaceSlug]/skills/[skillSlug]`, sidebar collapsible skill list
- **API endpoints**: `/api/skills`, `/api/skills/[skillSlug]`, `/api/skills/[skillSlug]/files`, `/api/skills/[skillSlug]/files/[fileName]`, `/api/skills/restore/[skillId]`, `/api/skills/files/restore/[fileId]`, `/api/skills/trash`, `/api/skills/trash/purge`
- **MCP tools**: ~11 — `skill_list`, `skill_get`, `skill_create`, `skill_update`, `skill_delete`, `skill_list_files`, `skill_read_file`, `skill_create_file`, `skill_write_file`, `skill_rename_file`, `skill_delete_file`, `skill_authoring_guide`, `get_skill_template`
- **CLI commands**: none direct
- **Chrome extension**: n/a
- **Database tables**: `skills`, `skill_files`
- **Status**: ACTIVE

### workspaces
- **What it does**: Top-level container for everything. Auto-creates a default workspace on first login, supports multiple workspaces per user, public-id-based URLs, slug renames, deletion, settings.
- **User-facing pages**: `/workspaces`, `/[workspaceSlug]/settings`, sidebar workspace switcher
- **API endpoints**: `/api/workspaces`, `/api/workspaces/[workspaceSlug]`, `/api/workspaces/[workspaceSlug]/canvases`, `/api/workspaces/[workspaceSlug]/canvases/[canvasSlug]`, `/api/workspaces/me`
- **MCP tools**: `list_workspaces`, `set_workspace`, `current_workspace`
- **CLI commands**: `dopl workspace list/current/use/clear`
- **Chrome extension**: n/a
- **Database tables**: `workspaces`, `workspace_members`, `workspace_invitations`, `canvases`
- **Status**: ACTIVE

---

## Cross-cutting flows

### Auth / sign-up / login
- `/login` page using Supabase Auth (Google OAuth + magic-link/email)
- `/auth/callback` route exchanges the Supabase code for a session and redirects to `/canvas` (which redirects to the user's default workspace + canvas)
- API auth via `withUserAuth` / `withExternalAuth` / `withMcpAccess` / `withSubscriptionAuth` / `withAdminAuth` in `src/shared/auth/with-auth.ts` — accepts both Supabase session cookies and `sk-dopl-*` API keys

### Onboarding flow
- **Docs claim it exists** (`docs/ENGINEERING.md:55` lists `src/features/onboarding/`), but the directory **does not exist**. Closest things in code:
  - `seedWorkspace` in `src/features/knowledge/server/service.ts` and `src/features/skills/server/service.ts` lazily seeds fixtures on first list call for new workspaces (within 24h of creation)
  - `profiles.onboarded_at` column referenced (migration `20260416120000`), backfill migration `20260504060000_backfill_onboarding_dismissed_for_legacy_users.sql` exists
  - `ConnectAppSection` on `/[workspaceSlug]/overview` walks new users through MCP install
- **Status**: There is no `features/onboarding` module; the ENGINEERING.md doc is stale here.

### Billing / Stripe / pricing
- `/pricing` (public) → embedded checkout → Stripe webhook → `profiles` updated → access gated by `withSubscriptionAuth` + `PaywallGate` overlay on the canvas
- 24h free trial, then $7.99/mo Pro. Single tier.
- Old credits system (`grant_daily_bonus_atomic`, `init_credits_atomic`, `reset_cycle_atomic`, `handle_upgrade_atomic`, `claim_early_supporter_grant`) lives in migrations (`035_webhook_two_phase.sql`, `20260416061700_early_supporter_grant.sql`) but **zero references in current TypeScript**. Functions are still in the DB but unreferenced. Tables `user_credits` / `credit_ledger` referenced by those functions are not in any active TS code.

### Admin surface (`/admin/*` + `/api/admin/*`)
- Pages: `/admin/analytics` (launch funnel), `/admin/health` (system events + retention), `/admin/review` (moderation queue for entries)
- API: `/api/admin/entries` + approve/deny, `/api/admin/keys` + DELETE, `/api/admin/skeleton-ingest` (admin tier ingest)
- **Discoverability**: zero links from user-facing UI; admin must type URLs. Gated by `ADMIN_USER_ID` env var.

### Marketing (`/` + `src/features/marketing/`)
- Single landing page at `/` with 4 animated tab demos (MCP / Knowledge / Skills / Teams)
- Top nav links: Docs, Community, Pricing, Sign in / Sign up
- Mock components in `src/features/marketing/components/*`; constants in `marketing/constants.ts`

### Settings (`/settings/*`)
- `/settings` (profile summary + 4 sub-links + delete-account)
- `/settings/profile`, `/settings/billing`, `/settings/keys`, `/settings/integrations`

### Workspaces / invitations / members
- `/workspaces` lists all the user belongs to + create
- `/invite/[token]` accept-invite landing (public)
- Sidebar workspace-switcher shows pending invites and prompts accept
- Per-workspace `/[workspaceSlug]/members` with table + access matrix

---

## 🪦 Dead / orphaned / suspicious (purge candidates)

### Chrome extension referenced but missing
- **What it is**: ENGINEERING.md and REFACTOR-FINDINGS.md describe `packages/chrome-extension/` with PascalCase filename issues — a whole browser extension. It does not exist.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/docs/ENGINEERING.md:31, :182`, `/Users/samuelwang/Downloads/setup-intelligence-engine/docs/REFACTOR-FINDINGS.md:84, :97, :100`
- **Evidence it's unused**: `ls packages/` returns only `cli  dopl-client  mcp-server`. `find . -name "chrome-extension" -type d` returns nothing. `find . -name manifest.json` (excluding node_modules/.next) returns nothing.
- **Recommendation**: **Verify with Sam** — was the Chrome extension deleted but the docs not updated? Either delete the doc references or restore the package.

### `agents.md` is fully stale (describes pre-refactor architecture)
- **What it is**: Top-level `agents.md` describes paths like `src/components/`, `app/ingest/page.tsx`, `app/search/page.tsx`, `src/lib/ingestion/pipeline.ts`, `app/components/canvas/`, etc. — none of those exist; the code moved to `src/features/*` per ENGINEERING.md.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/agents.md` (top of repo, also at root for visibility)
- **Evidence**: Path `src/components/canvas/` does not exist; current is `src/features/canvas/`. `app/ingest/page.tsx` is referenced in the doc but `/api/ingest/route.ts` is now a 410-Gone tombstone and there's no user-facing `/ingest` page.
- **Recommendation**: **Delete and replace** with a 1-paragraph pointer to `docs/ENGINEERING.md` (which is the source of truth and matches the code).

### `/design` page (design-system showcase)
- **What it is**: A long single-page tour of all the GlassCard / GlassNavbar / Pill / Orb / GlowText primitives.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/design/page.tsx`
- **Evidence it's unused**: The only thing linking to `/design` is `/design` itself (`grep -rn 'href="/design"' src` returns one self-reference). Not in sidebar, not in marketing nav, not in docs.
- **Recommendation**: **Delete** unless Sam wants it kept as an internal reference. If kept, gate it behind `/admin/design`.

### `/build` page + entire `features/builder/` module
- **What it is**: An alternative three-pane "Builder" UI (sidebar + chat + right panel) over the canvas store.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/build/page.tsx`, `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/build/build-client-shell.tsx`, `/Users/samuelwang/Downloads/setup-intelligence-engine/src/features/builder/` (4 files: `builder-layout.tsx`, `builder-sidebar.tsx`, `builder-center-panel.tsx`, `builder-right-panel.tsx`)
- **Evidence it's unused**: The only `href="/build"` reference in the codebase is on the orphan `/design` page (`src/app/design/page.tsx:161`). Not in the sidebar nav. The pricing page used to push to `/canvas` not `/build`. ENGINEERING.md doesn't mention `features/builder/` in §1's project structure listing.
- **Recommendation**: **Delete** — appears to be an abandoned alternate UI.

### `/browse/*` UI is orphaned from main nav
- **What it is**: `/browse/entries`, `/browse/clusters`, `/browse/saved` with a SmartChatPanel rail. These were probably the original "browse the public catalog" UX.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/browse/`, plus `src/features/entries/components/smart-chat-panel.tsx`, `entry-preview-panel.tsx`, `entry-preview-context.tsx`, `entry-grid.tsx`, `entry-tabs.tsx`, `filter-sidebar.tsx`, `repo-file-browser.tsx`
- **Evidence it's unused**: The sidebar's `navItems` (`src/shared/layout/sidebar.tsx:112-122`) lists Overview / Canvas / Chat / Knowledge / Skills / Integrations / Activity / Members / Settings — no Browse. The only inbound links to `/browse` are:
  1. The orphan `/design` page (`href="/browse"`)
  2. `/entries` legacy redirect (`redirect("/browse/entries")`)
  3. `/entries/[id]` "back" link (`Link href="/browse/entries"`)
  4. Internal `/browse/*` self-links
- **Recommendation**: **Verify with Sam** — is the public "browse the catalog" surface intentional but just not in the sidebar yet, or is it deprecated? If deprecated, deleting `app/browse/` removes `entry-grid.tsx`, `filter-sidebar.tsx`, `smart-chat-panel.tsx`, `entry-preview-panel.tsx`, `entry-preview-context.tsx` (some still used by `/community` though — check first).

### `FixedChatSidebar` (canvas)
- **What it is**: A fixed right-side panel listing all canvas chat conversations.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/features/canvas/fixed-chat-sidebar.tsx`
- **Evidence it's unused**: `grep -rn "FixedChatSidebar" src packages --include="*.ts" --include="*.tsx"` returns ONLY the file itself. `canvas-client-shell.tsx` uses `FixedChatPanel` (different) and `FixedBrainPanel`, not `FixedChatSidebar`.
- **Recommendation**: **Delete** the file.

### `UpgradeModal` (billing)
- **What it is**: An "upgrade now" modal component.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/features/billing/components/upgrade-modal.tsx`
- **Evidence it's unused**: `grep -rn "UpgradeModal" src` returns only its own file. `PaywallModal` + `PaywallGate` are the live gates.
- **Recommendation**: **Delete** the file.

### `src/features/marketing/components/page-top-bar.tsx`
- **What it is**: A `PageTopBar` component duplicate.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/features/marketing/components/page-top-bar.tsx`
- **Evidence it's unused**: Zero imports. The live `PageTopBar` everyone imports is at `src/shared/layout/page-top-bar.tsx`.
- **Recommendation**: **Delete** the marketing duplicate.

### `FilterSidebar` (entries)
- **What it is**: A filter sidebar with use_case / complexity / content_type / tags facets.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/features/entries/components/filter-sidebar.tsx`
- **Evidence it's unused**: Zero imports outside its own file. The `/browse/entries` page doesn't render it.
- **Recommendation**: **Delete** the file.

### `Orb`, `BackgroundGrid` design primitives
- **What they are**: Design-system components.
- **Where**: `src/shared/design/orb.tsx`, `src/shared/design/background-grid.tsx`
- **Evidence they're unused**: Exported from the design barrel, never imported anywhere except (Orb is not even in design/page.tsx). `BackgroundGrid` only appears in the barrel + its own file.
- **Recommendation**: **Delete** both.

### `Pill`, `PillBar`, `GlowText`, `Surface`, `GlassNavbar`, `GlassNavLink` design primitives
- **What they are**: Design-system components only used on the orphaned `/design` showcase.
- **Where**: `src/shared/design/pill.tsx`, `pill-bar.tsx`, `glow-text.tsx`, `surface.tsx`, `glass-navbar.tsx`
- **Evidence**: `grep` outside `/design/page.tsx` and `src/shared/design/` returns no results.
- **Recommendation**: **Delete the components** if `/design` is deleted; otherwise keep.

### Credits / tier system (DB-only orphan)
- **What it is**: A whole credits/tier flow exists in SQL migrations: `grant_daily_bonus_atomic`, `init_credits_atomic`, `reset_cycle_atomic`, `handle_upgrade_atomic` (file `035_webhook_two_phase.sql`), `claim_early_supporter_grant` (file `20260416061700_early_supporter_grant.sql`), `skeleton_ingest_tier` migration, etc. Tables `user_credits` and `credit_ledger` are referenced.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/supabase/migrations/035_webhook_two_phase.sql`, `20260416061700_early_supporter_grant.sql`, `20260417000000_skeleton_ingest_tier.sql`
- **Evidence it's unused**: `grep -rn "user_credits\|credit_ledger\|daily_bonus\|grant_daily_bonus_atomic\|claim_early_supporter_grant" src packages` returns zero matches. `/pricing` page comment explicitly says: "Feature tiers and credits UI are gone."
- **Recommendation**: **Verify with Sam, then write a drop migration**. The functions + tables still exist in the live DB but nothing reads them. Safe to drop after a final sanity check that Stripe didn't replace some bookkeeping.

### `/api/ingest` (POST returns 410 Gone)
- **What it is**: Legacy ingest endpoint, fully tombstoned.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/ingest/route.ts`
- **Evidence**: File itself documents that callers must use `/api/ingest/prepare` + `/api/ingest/submit`.
- **Recommendation**: **Keep for a defined window** (current behavior is correct — emit 410 with a helpful migration message) then delete after, say, 6 months of zero 410 hits in logs.

### `/api/cluster/synthesize` POST (returns 410 Gone)
- **What it is**: Old server-side brain synthesis. POST returns 410; GET still serves the prompt template.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/cluster/synthesize/route.ts`
- **Evidence**: File-doc explains: "removed as part of the pivot to client-only synthesis".
- **Recommendation**: **Keep the GET, delete the POST handler** after a logging window confirms no callers.

### `/api/canvas/state/migrate`
- **What it is**: One-time bulk import endpoint to push localStorage panel state into Supabase.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/canvas/state/migrate/route.ts`
- **Evidence it's unused**: `grep -rn 'canvas/state/migrate' src packages` returns only the route file itself. No client code calls it.
- **Recommendation**: **Delete** — the localStorage migration era is past. (Worth a quick check of git log to confirm the migration window has closed.)

### `/api/embed` and `/api/tags`
- **What they are**: Public-ish endpoints — `/api/embed` returns an OpenAI embedding for arbitrary text, `/api/tags` returns the global tag cloud.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/embed/route.ts`, `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/tags/route.ts`
- **Evidence**: No internal callers in `src/` or `packages/`. Not in `dopl-client`. `agents.md` (the stale doc) is the only file that mentions them as "Public routes".
- **Recommendation**: **Verify with Sam** — both look like leftover from the original API-key-accessed catalog. If no external partner is using them, delete. `withMcpAccess("mcp_list", ...)` on `/api/embed` suggests it's billed as an MCP credit — but it isn't in the MCP tool registry, so it can't be invoked that way today.

### `/api/admin/skeleton-ingest` and skeleton ingest as a whole
- **What it is**: An admin-only ingest tier that creates "skeleton" entry stubs without running the full pipeline.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/admin/skeleton-ingest/route.ts`, called via `dopl-client.skeletonIngest()` and the MCP tool `skeleton_ingest` (gated to admin in `server.ts:1432`)
- **Evidence**: Active — Sam runs it. Not orphan; flagged here only because it's admin-only and not in the user UI.
- **Recommendation**: **Keep** — actively used by the content-seeding-playbook.md flow.

### Top-level `/canvas` and `/entries` legacy redirects
- **What they are**: Old-URL redirects to the new workspace-scoped routes.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/canvas/page.tsx`, `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/entries/page.tsx`
- **Evidence**: Both render `redirect(...)`. The only inbound references are from the pricing page (`/canvas`) and the entry detail page (`/browse/entries`).
- **Recommendation**: **Keep** — they're 3-line shims that don't hurt. Delete when Sam is confident no external bookmark/marketing material points here.

### Stale `/api/conversations/title` server-side LLM call
- **What it is**: Generates a conversation title via a single Claude call. Used only by `use-private-chat.ts`.
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/conversations/title/route.ts`
- **Evidence**: Has exactly one caller. Comment in `use-chat-name.ts:8` mentions a similar function that was deleted.
- **Recommendation**: **Keep** — actively used, but worth a code-review pass to consolidate title-derivation logic if Sam is doing a chat refactor.

### Subdir with one orphan: `src/app/api/stats/`
- **What it is**: An empty directory (`api/stats/` exists with no `route.ts`).
- **Where**: `/Users/samuelwang/Downloads/setup-intelligence-engine/src/app/api/stats/`
- **Recommendation**: **Delete the empty directory**.

### Migrations: dropped `oauth_connections` table
- **What**: Migration `20260504070000_oauth_connections.sql` created a workspace-level `oauth_connections` table; `20260505010000_oauth_connections_user_level.sql` immediately drops + recreates it user-level. The intermediate version was alive for ~1 day in history; the recreated version is what's live.
- **Recommendation**: **Tombstone for history only** — nothing to do; this is normal migration churn.

---

## 🟡 Possibly used (verify with Sam)

### `/browse/*` pages
External traffic might still hit these (the `/entries` redirect sends bookmarks here). Worth a quick log check before deleting. They share components (`EntryGrid`, `CommunityCard`) with `/community/*` which IS used.

### `/api/embed` and `/api/tags`
External MCP clients or third-party tools may rely on these. They have API-key auth wrappers. Confirm in logs that nothing is hitting them.

### `/api/ingest/route.ts` (the 410-Gone shim)
Useful only if external tools still call the old endpoint. Check logs.

### `/api/cluster/synthesize` POST (also 410-Gone)
Same — check logs for hits.

### `/admin/*` pages
Sam-only. They're "discovered by URL knowledge". Keep.

### Scripts directory
- `backfill-title-summary.ts` — Idempotent backfill, says safe to re-run. Was a migration helper.
- `check-knowledge-type-drift.ts` — A dev-time linter. Could be part of CI; otherwise dead.
- `scope-api-key.ts` — Documented as "until Item 5 ships a UI" — workaround script.
- `seed-knowledge-bases.ts` — `--all` backfill script, still callable.
- `seed-rokid-pack.ts` — Seeds a specific knowledge pack. Likely still relevant during pack onboarding.
- `smoke-knowledge-*.ts` (4 files) — smoke tests for the knowledge feature. Manual QA scripts.
- `test-pack-sync.ts` — manual QA.
- `test-pipeline.ts` — **DEAD** — calls `${BASE_URL}/api/ingest` which is the 410-Gone endpoint. Use `prepare/submit` now.
- `test-rls.ts` — RLS verifier script, still works.
- `upgrade-samuel-to-pro.ts` — one-off documented as such. Already-run, dead.
- `verify-rokid-pack.ts` — paired with seed-rokid-pack.
- **Recommendation**: Delete `test-pipeline.ts` (calls dead endpoint) and `upgrade-samuel-to-pro.ts` (one-off, already run). Keep the rest as ops tooling.

---

## 🟢 Recently-active surfaces (confidently used)

- The whole workspace-scoped tree under `/[workspaceSlug]/{overview,chat,knowledge,skills,integrations,members,activity,settings,[canvasSlug]}` — actively rendered + linked from the sidebar
- `/community`, `/community/[slug]`, `/community/posts` — linked from landing nav + sidebar (via canvas publish dialog)
- `/pricing`, `/login`, `/settings/*`, `/workspaces`, `/invite/[token]`, `/docs`
- All MCP tools in `packages/mcp-server/src/server.ts` and `tools/*.ts` — Sam uses these daily
- All CLI commands — `dopl auth/workspace/packs/mcp`
- All `/api/canvas/*`, `/api/clusters/*`, `/api/knowledge/*`, `/api/skills/*`, `/api/community/*`, `/api/integrations/*`, `/api/workspaces/*`, `/api/billing/*`, `/api/chat`, `/api/conversations*`, `/api/user/*` — wired into client code or MCP
- 3 cron endpoints in `vercel.json`
- `/api/og/tweet` + `/api/og/github` — used by ingestion to render preview images
- `/api/links/describe` + `/api/build` + `/api/query` — public catalog reads used by MCP

---

## Recommended purge plan (safest-first)

1. **Delete empty directory** `src/app/api/stats/` — zero risk.
2. **Delete `src/app/api/canvas/state/migrate/route.ts`** — no callers, localStorage era is over.
3. **Delete `src/features/canvas/fixed-chat-sidebar.tsx`** — zero imports.
4. **Delete `src/features/billing/components/upgrade-modal.tsx`** — zero imports.
5. **Delete `src/features/marketing/components/page-top-bar.tsx`** — duplicate of `src/shared/layout/page-top-bar.tsx`, zero imports.
6. **Delete `src/features/entries/components/filter-sidebar.tsx`** — zero imports.
7. **Delete `src/shared/design/orb.tsx` and `background-grid.tsx`** (and remove the barrel exports) — zero imports.
8. **Delete `scripts/test-pipeline.ts`** — points at the dead `/api/ingest` endpoint.
9. **Delete `scripts/upgrade-samuel-to-pro.ts`** — one-off, doc says so.
10. **Replace `agents.md`** with a 1-paragraph pointer to `docs/ENGINEERING.md`. The current contents are wholly stale (pre-refactor architecture).
11. **Delete `/design` page + `Pill`, `PillBar`, `GlowText`, `Surface`, `GlassNavbar`, `GlassNavLink`** — keep GlassCard / GlassDivider / MonoLabel / StatusDot (still used). Verify with Sam first since `/design` is sometimes kept as an internal reference.
12. **Delete `/build` route + `src/features/builder/`** — only reachable via the orphan `/design`. Verify with Sam that this Builder UI is not on the roadmap.
13. **Update `docs/ENGINEERING.md`** to (a) remove the `packages/chrome-extension/` references and the §4 "Known naming inconsistency" note about it, and (b) remove the `features/onboarding/` line from §1's file tree. Update REFACTOR-FINDINGS.md F-007 too.
14. **Decide on `/browse/*`** — if deprecated, delete `src/app/browse/`, then drop `smart-chat-panel.tsx`, `entry-preview-panel.tsx`, `entry-preview-context.tsx`, `entry-grid.tsx` (carefully — `EntryGrid` may be reused by `/community`). Update `src/app/entries/page.tsx` redirect to point at `/community` instead. Update `entries/[id]/entry-page-client.tsx` "back" links.
15. **Write a drop migration for the dead credits system** — drop functions `grant_daily_bonus_atomic`, `init_credits_atomic`, `reset_cycle_atomic`, `handle_upgrade_atomic`, `claim_early_supporter_grant`, and the `user_credits` + `credit_ledger` tables if they exist. Verify there's no Stripe webhook handler still calling them first.
16. **Add a logging window**, then delete the 410-Gone tombstones (`/api/ingest` POST, `/api/cluster/synthesize` POST) once you've confirmed zero hits.
17. **Decide on `/api/embed` and `/api/tags`** — check Vercel logs for 30-day traffic. If zero external callers, delete.

---

## Appendix — Files I'd take a second look at (not necessarily dead)

- `src/types/api.ts` — large legacy type file. Per ENGINEERING.md §11 types should live in features; check what still belongs at the top level.
- `src/types/entry.ts` — same.
- `src/features/canvas/canvas-store/reducer.ts` (~800 lines) — already noted as a §2 exception; not orphan, just big.
- `packages/mcp-server/src/server.ts` (~2000 lines) — also a known §2 exception, planned to be split.
- `src/features/knowledge/server/service.ts` (~960 lines) — known split candidate.

All five are tracked in `docs/REFACTOR-FINDINGS.md` / `docs/TRACKED-DEBT.md` and not in scope for this purge sweep.
