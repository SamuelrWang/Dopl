# MCP multi-workspace TODO

Captured 2026-05-03 from analysis of `packages/mcp-server`.

**Problem:** Each Dopl user gets one API key per workspace. A user with 3 workspaces today must register 3 separate MCP server instances in their client config — one process per workspace. That works (the backend already enforces per-key workspace locking via `api_keys.workspace_id` + `X-Workspace-Id`) but produces ~180 tool entries in the agent's tool list, 3× node processes, and no way to do a single tool call that targets a different workspace.

Goal: one MCP server instance can serve all workspaces the user has access to, without the tool-list explosion.

---

## M-1 — Add `workspace` parameter to every tool

**Why:** Today every tool is implicitly scoped to the workspace fixed at server boot ([packages/mcp-server/src/server.ts:327](packages/mcp-server/src/server.ts), `canvasContext.slug`). The agent has no way to say "do this in workspace B" without restarting the server. This is the root cause of the multi-instance workaround.

**Shape:**

- Add an optional `workspace` arg (slug or UUID) to every tool's zod schema in [packages/mcp-server/src/server.ts](packages/mcp-server/src/server.ts) and [packages/mcp-server/src/tools/knowledge.ts](packages/mcp-server/src/tools/knowledge.ts).
- Centralize workspace resolution in `registerTool` ([server.ts:346](packages/mcp-server/src/server.ts)) so each handler doesn't reimplement it. Resolve order: explicit arg → session default → user's default workspace.
- Per-call workspace ID flows through `DoplClient` request headers — extend `transport.ts` ([packages/dopl-client/src/transport.ts](packages/dopl-client/src/transport.ts)) to accept a one-shot override that takes precedence over the client's stored `workspaceId` for a single request.
- Backend (`with-workspace-auth.ts`) already validates the header against the key's lock — no server-side change needed if we keep using workspace-scoped keys. If we want one user-scoped key to drive all workspaces, see M-3.

**Blast radius:** every tool definition gets one new optional field. Backwards compatible if the param is optional and falls back to the boot-time workspace.

---

## M-2 — `set_workspace` / `list_workspaces` / `current_workspace` tools

**Why:** Even with M-1, the agent needs a way to discover which workspaces exist and switch the session default without the user editing config. Today `getActiveWorkspace` is called once at boot and never re-queried.

**Shape:**

- New tool `list_workspaces` → returns `[{ id, slug, name, role }]` for every workspace the authenticated user is a member of. Backend endpoint may already exist (check `src/app/api/workspaces/`); if not, add a `GET /api/workspaces` that returns the caller's memberships.
- New tool `set_workspace(slug_or_id)` → updates `client.workspaceId` for the rest of the session. Cheap mutation; no DB write.
- New tool `current_workspace` → returns the active session workspace (id, slug, role). Helps the agent self-correct after a `set_workspace` call.
- Description copy must explicitly tell the agent: "If the user mentions a workspace by name, call `set_workspace` first or pass `workspace=` to subsequent tools."

**Depends on:** M-1 (since `set_workspace` is meaningless without per-call resolution).

---

## M-3 — Allow user-scoped keys (one key, all workspaces)

**Why:** Right now keys generated through the workspace settings page are workspace-locked (`api_keys.workspace_id` non-null). For the single-instance flow to actually be a single key, we need a "user-scoped" key option that lets the same key drive any workspace the user belongs to.

**Shape:**

- The DB column already supports it: `workspace_id IS NULL` means user-scoped ([src/shared/auth/api-keys.ts:33-62](src/shared/auth/api-keys.ts)). The auth wrapper at [src/shared/auth/with-workspace-auth.ts:74-88](src/shared/auth/with-workspace-auth.ts) already routes user-scoped keys to the header-supplied workspace.
- Add a "personal API key" UI in account settings (separate from per-workspace keys) that creates a `workspace_id = NULL` row.
- Onboarding/CLI should default new MCP setups to a personal key, not a workspace-scoped key.
- Document the security tradeoff: a personal key has access to every workspace the user joins, including future ones. Some users may prefer per-workspace keys for least-privilege; keep both options.

**Open question:** do we deprecate workspace-scoped keys entirely, or keep them for service accounts / CI? Lean toward keep — they're the right shape for non-human callers.

---

## M-4 — Hint workspace context in tool descriptions

**Why:** Without M-1/M-2, the agent has no signal for which `mcp__dopl-acme__...` server corresponds to which workspace beyond the literal config key. With M-1/M-2 this becomes "did the agent remember to pass `workspace=` or call `set_workspace`?"

**Shape:**

- Inject the active workspace into the `_dopl_status` footer (already attached to every tool response by `withDoplStatus` in [packages/mcp-server/src/server.ts:357](packages/mcp-server/src/server.ts)) so the agent sees `Active workspace: acme (cluster X)` after every call. Reinforces context without per-tool description bloat.
- Optionally surface available workspaces in the SERVER_INSTRUCTIONS block (the `instructions` field at [server.ts:338](packages/mcp-server/src/server.ts)) so the agent knows the multi-workspace shape on first turn.

---

## M-5 — Skill files: cleanup orphan workspace slug dirs

**Why:** SKILL.md files are written to per-workspace slug subdirectories (`~/.claude/skills/dopl-{slug}/`). When a user leaves a workspace or it's deleted, the on-disk dir lingers and CLAUDE.md auto-loads stale skills.

**Shape:**

- On `pingMcpStatus`, the server gets back the user's current workspace memberships. Use that list to compute orphan slugs in `~/.claude/skills/dopl-*/` and delete them (with a one-time confirmation log, not silent rm).
- Alternative: stamp each `dopl-{slug}` dir with the workspace UUID in a `.workspace` sidecar file so we can detect ownership changes precisely.

**Lower priority** than M-1/M-2/M-3 — only matters when users leave workspaces.

---

## M-6 — `dopl mcp config` CLI subcommand

**Why:** Even after the single-instance refactor, users still need a one-line copy-paste to set up their `mcp.json`. Today the only example is in `--help` output ([packages/mcp-server/src/index.ts:45-57](packages/mcp-server/src/index.ts)).

**Shape:**

- New CLI subcommand in the `dopl` package: `dopl mcp config` prints the JSON block for the user's current shell environment (with their personal key already substituted). Optional `--workspace <slug>` to emit the workspace-scoped form for users who want least-privilege.
- Optional `--write` flag that drops the block straight into `~/.claude/mcp.json` (or detects Cursor / Claude Desktop and writes to the right path).

**Depends on:** M-3 (so we have personal keys to substitute).

---

## M-7 — Rip out the post-signup welcome flow

**Why:** New users currently land on `/welcome` after sign-up and have to walk through a typewriter intro + MCP connection card before reaching their workspace. The workspace and main canvas are *already* created in the auth callback before `/welcome` even renders ([src/app/auth/callback/route.ts:51-57](src/app/auth/callback/route.ts)), so the welcome flow is pure friction — it doesn't unblock anything that wouldn't otherwise work. Goal: signup → land directly in an auto-created "Untitled" workspace, no intermediate screen.

**Shape:**

- Change the post-auth redirect default from `/welcome` to `/canvas`:
  - [src/app/auth/callback/route.ts:16](src/app/auth/callback/route.ts) — `redirectTo` default
  - [src/app/login/page.tsx:22](src/app/login/page.tsx) — `redirectTo` default
- Rename the auto-created workspace from `"My Workspace"` to `"Untitled"` at [src/features/workspaces/server/service.ts:87](src/features/workspaces/server/service.ts) (inside `ensureDefaultWorkspace`).
- Delete the welcome surface:
  - `src/app/welcome/` (page.tsx, welcome-content.tsx, welcome-mcp-step.tsx)
  - `src/app/api/welcome/` (the `/api/welcome/complete` endpoint)
- Drop the `profiles.onboarded_at` gate (the column can stay for now; just stop reading/writing it). Remove the migration's index if no longer queried.
- Audit other call sites that reference `/welcome`, `onboarded_at`, or `WelcomeContent` — grep before deleting. The `mcp_connected_at` touch in [src/shared/auth/api-keys.ts:139-153](src/shared/auth/api-keys.ts) was added specifically to advance the welcome step; the touch itself is harmless to keep but the comment block needs an update once /welcome is gone.

**Where MCP connect lives instead:** the welcome flow's most useful piece — the "copy this command to install your MCP" tab — should move to the workspace settings page (somewhere reachable from the canvas), so users who *want* to connect their agent can find it on demand. Without that, removing /welcome silently removes the only documented MCP install path. Confirm a settings/keys page exists or add one as part of this PR.

**Blast radius:** every brand-new signup since the welcome flow shipped will land in a different place. Existing onboarded users are unaffected (they already redirect past /welcome). One PR, mechanical.

---

## M-8 — Permission icon on each KB/skill row in the panel list

**Why:** Today the rows for knowledge bases and skills in the canvas panels show the title, an `AgentBadge`, and (for skills) an invocation count. Nothing tells the user whether they have read-only or edit access on each item. With workspace memberships and per-resource overrides already in the data model (`workspace_resource_access` table, levels `"read"` / `"edit"`), the access info is one query away — the UI just doesn't surface it.

**Shape:**

- Add a small icon at the right edge of each row: eye icon for `read`, pencil icon for `edit`. Owners/admins always show the edit icon (per `getResourceAccess` ownership shortcut).
- **Knowledge list:** `KnowledgeCard` at [src/features/canvas/panels/knowledge/knowledge-panel.tsx:160-188](src/features/canvas/panels/knowledge/knowledge-panel.tsx) — slot the icon next to the existing `AgentBadge` (lines 174-179).
- **Skills list:** `SkillRow` at [src/features/canvas/panels/skills/skills-panel.tsx:160-207](src/features/canvas/panels/skills/skills-panel.tsx) — slot the icon in the right-side flex container (lines 197-202).
- **Data wiring:** the panel-list endpoints currently return KB/skill rows without per-user access level. Either:
  - Extend the existing list query to LEFT JOIN `workspace_resource_access` filtered by `auth.uid()`, OR
  - Add a sibling endpoint that returns `{ resource_id → level }` and the panel client merges.
  - Resolution logic already exists in [src/features/members/server/access.ts:37-61](src/features/members/server/access.ts) (`getResourceAccess`) and the role-default fallback in [src/features/members/access-defaults.ts](src/features/members/access-defaults.ts) — reuse, don't reimplement.
- **Tooltip on hover:** "View only — ask <owner> for edit access" vs "You can edit this." Short and clear.

**Blast radius:** additive — one icon per row, one extra column or batch query. No schema changes.

---

## M-9 — Inline rename/create instead of `window.prompt()`

**Why:** Every "new folder," "new entry," "new skill file," and "rename" action currently fires a native browser prompt. It's ugly, breaks keyboard flow, and feels like 2007. The user wants: click "+ new entry" → a row appears immediately with a focused inline `<input>` containing a placeholder name → user types → Enter commits, Escape cancels (and deletes the just-created stub).

**Shape:**

- Build a small reusable `InlineEditableLabel` (or `TreeRowEditingState`) component. No equivalent exists in the codebase today — every rename path goes through `window.prompt`. Keep it tight: controlled input, autofocus on mount, select-all on focus, commit on blur/Enter, cancel on Escape.
- **Create flow:** the parent (folder, KB root, skill) calls the create API immediately with a default name (`"Untitled folder"`, `"Untitled entry"`, `"untitled.md"`). The new row mounts in editing state. Commit issues a rename to the user-typed value; cancel issues a delete of the stub. Tradeoff: this round-trips twice (create + rename) on the happy path. Acceptable — the alternative is buffering the row client-side and hoping every server-side validation passes after the fact, which gets messy fast (slug collisions, RLS denials).
- **Rename flow:** clicking "Rename" in the context menu (or double-clicking the row) just toggles the row into editing state. One round-trip, no stub.

**Call sites to migrate (all currently use `window.prompt`):**

- [src/features/canvas/panels/knowledge-base/knowledge-base-panel.tsx:76](src/features/canvas/panels/knowledge-base/knowledge-base-panel.tsx) — `prompt("Folder name")`
- [src/features/canvas/panels/knowledge-base/knowledge-base-panel.tsx:91](src/features/canvas/panels/knowledge-base/knowledge-base-panel.tsx) — `prompt("Entry title")`
- [src/features/knowledge/components/knowledge-tree.tsx:420](src/features/knowledge/components/knowledge-tree.tsx) — `prompt("Entry title")` (full-page view)
- [src/features/knowledge/components/knowledge-tree.tsx:433](src/features/knowledge/components/knowledge-tree.tsx) — `prompt("Folder name")` (full-page view)
- [src/features/knowledge/components/knowledge-tree.tsx:541-552](src/features/knowledge/components/knowledge-tree.tsx) — `AddRowAffordance` root-level prompts
- [src/features/knowledge/components/knowledge-base-view.tsx:180](src/features/knowledge/components/knowledge-base-view.tsx) — `prompt(...)` for renaming a KB
- [src/features/canvas/panels/skill/skill-panel.tsx:103](src/features/canvas/panels/skill/skill-panel.tsx) — `prompt("File name (.md)")` for skill files
- Sidebar **knowledge base** and **skill** list rows (M-8's neighborhood) — also need rename without prompt; today's rename flow flows through the same context menu pattern.

**Out of scope:** the `prompt("Link URL", ...)` at [doc-editor.tsx:345](src/features/knowledge/components/doc-editor.tsx) is a different UX (link insertion in the rich-text editor) — leave it for a separate cleanup.

**Blast radius:** new shared component + one PR per surface (canvas panel, full-page tree, skill panel). All migrations follow the same pattern, so the second and third are mechanical once the first lands.

---

## M-10 — Private knowledge bases & skills

**Why:** Today every KB and skill in a workspace is visible to every member. Users in shared (team) workspaces have no place to keep personal scratch — drafts, experimental skills, half-baked notes — without polluting the team view. The fix is a per-resource visibility flag: `private` items live in the same workspace but are only visible to their owner, while `public` (default) items behave as today.

**Decided shape:**

- **Visibility flag:** `visibility: "public" | "private"` on `knowledge_bases` and `skills` rows. Default `public` (no migration needed for existing data — all current rows stay public).
- **Owner-only access for private items:** when `visibility = 'private'`, only the row owner sees it in lists, search, and the file tree. **Workspace admins do not see private items, not even their existence.** Half-visibility ("admins see titles but not content") is confusing and erodes the meaning of "private." Full opacity matches Notion's model and builds trust. RLS policies must enforce this — don't rely on application-layer filtering alone.
- **Canvas restriction:** when a user tries to drop a private item onto the canvas, the action is blocked with a clear inline message: "Make this public to add it to the canvas." The canvas is a workspace-shared surface — a private item on a public canvas would either leak or render as an empty hole for teammates. Neither is acceptable.
- **Auto-delete on workspace leave:** when a user leaves (or is removed from) a workspace, all of their `private` resources in that workspace are hard-deleted. No transfer-to-admin, no soft-delete recovery period. "Private" means private; the data does not outlive the user's membership. This also resolves the only real bloat concern.
- **MCP exposure:** private items are reachable **only via user-scoped API keys** (the `api_keys.workspace_id IS NULL` shape — see M-3). Workspace-scoped keys, which are intended for service accounts / CI, must NOT see private items, since multiple humans may hold the same key. Enforce in the same RLS policy: private items are visible iff the requester's `auth.uid()` matches the row owner.

**Where to wire it:**

- **Schema:** add `visibility` column to `knowledge_bases` and `skills` tables. New migration in `supabase/migrations/`.
- **RLS:** new policies on both tables that filter `visibility = 'private' AND owner_id != auth.uid()` from SELECT for non-owners. Critical to get this right since this is the only real boundary.
- **List endpoints:** the queries that feed the panel lists ([src/features/canvas/panels/knowledge/knowledge-panel.tsx](src/features/canvas/panels/knowledge/knowledge-panel.tsx) and [src/features/canvas/panels/skills/skills-panel.tsx](src/features/canvas/panels/skills/skills-panel.tsx) data loaders) inherit the RLS filter automatically — no application-layer changes if RLS is right.
- **Visibility toggle UI:** add a private/public toggle in the KB and skill settings/header (next to where `agentWriteEnabled` lives today). Show a small lock icon next to the row title for private items in the panel lists — neighbors the eye/pencil icon from M-8.
- **Canvas-add guard:** intercept in the canvas drop/add handler. Surface the "make public to add" message inline, not via a toast that disappears.
- **Auto-delete on leave:** trigger or cascade on `workspace_members` DELETE. Add a Supabase function or DB trigger that deletes `knowledge_bases` and `skills` rows where `workspace_id = OLD.workspace_id AND owner_id = OLD.user_id AND visibility = 'private'`. Test carefully — destructive on workspace removal.
- **MCP key boundary:** the existing `with-workspace-auth.ts` already distinguishes user-scoped vs workspace-scoped keys. Add a check in the resource resolvers: if the key is workspace-scoped, never return private items. Belt-and-suspenders alongside RLS.

**Open questions to resolve before building:**

- What happens to a private item if its owner is *demoted* from the workspace (still a member, just lower role)? Probably nothing — they still own it. Confirm.
- Should "make public" require admin approval in stricter workspaces? Lean no for v1 (KISS), but worth a future flag.
- Does the M-7 default workspace ("Untitled") need any visibility default different from team workspaces? Lean no — single-member workspaces have no privacy distinction in practice.

**Blast radius:** schema change + new RLS policies + new UI affordance + a DB trigger. Touches every list endpoint indirectly (via RLS). Larger surgery than M-8/M-9 but each piece is well-bounded.

---

## Sequencing

1. **M-7** — independent of the multi-workspace work; smallest, highest user-visible impact. Do first.
2. **M-9** — pure UX win, no backend dependency, unblocks `M-8` rename behavior staying consistent.
3. **M-8** — small additive UI on top of an existing data model.
4. **M-1** — unblocks the rest of multi-workspace. Pure additive change, no breaking shape.
5. **M-3** — needed before M-2 *and* M-10 are safe (M-10 depends on user-scoped keys existing for the MCP boundary).
6. **M-2** — exposes the discoverability the agent needs.
7. **M-10** — private/public visibility. Land after M-3 so the MCP-exposure rules can be enforced cleanly; can land in parallel with M-2/M-4.
8. **M-4** — small polish on top of M-1+M-2.
9. **M-6** — UX onramp for new users; do after the single-instance flow is real.
10. **M-5** — cleanup, not blocking.

M-7, M-8, M-9 are each one PR on their own. M-1 is one PR on its own. M-2/M-3/M-4 could land together as the "personal key + workspace switcher" PR. M-10 is its own PR (schema + RLS + UI is enough to want a focused review). M-5/M-6 are independent followups.
