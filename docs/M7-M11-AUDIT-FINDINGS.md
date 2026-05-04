# M-7 / M-8 / M-9 / M-11 audit findings

Captured 2026-05-04 after a deep audit of the four shipped items from `MCP-MULTI-WORKSPACE.md`. Each finding has an `A-NNN` id so commits can reference it. Severity reflects practical exploitability or user impact, not the audit-agent's initial label — several agent-flagged "criticals" didn't survive direct verification and have been downgraded with rationale.

## Status legend
- **open** — not yet addressed
- **fixed-in-\<sha>** — resolved, commit linked
- **wontfix** — examined and consciously not changing

---

## Critical

### A-001: Open redirect via `redirectTo` query param
- Location: [src/app/auth/callback/route.ts:16, 86](src/app/auth/callback/route.ts) and [src/app/login/page.tsx:21, 72](src/app/login/page.tsx)
- Severity: **critical** (downgraded from agent's CRITICAL only because exploitation is conditional)
- Description: `redirectTo` is read from query string with no allowlist. At [callback/route.ts:86](src/app/auth/callback/route.ts) the value is passed to `new URL(redirectTo, request.url)` — when `redirectTo` is an absolute URL like `https://evil.com`, the URL constructor returns the absolute URL and ignores the base. So `?redirectTo=https://evil.com` → user is bounced to evil.com after a successful OAuth round-trip.
- Conditional: the redirect only fires inside the `if (code)` block (line 22) on a *valid* OAuth code, which Supabase only issues for redirect URIs registered in the project config. So an attacker can't trivially craft a one-shot phishing link — they need to ride a real sign-in flow. Still real, still worth fixing.
- Login-side: `router.push(redirectTo)` at [login/page.tsx:72](src/app/login/page.tsx) is also unguarded. Next.js's client-side router does block some cross-origin pushes but not as a security guarantee.
- Status: open

### A-002: Master Dopl skill documents tools that don't exist yet
- Location: [packages/mcp-server/skills/dopl/SKILL.md:104-112](packages/mcp-server/skills/dopl/SKILL.md)
- Severity: **critical**
- Description: Workflow 7 ("Switch workspaces on the fly") instructs the agent to call `list_workspaces`, `set_workspace`, `current_workspace`, and to pass a `workspace=<slug_or_id>` arg on any tool. **None of these exist yet** — they're M-2 (workspace switcher tools) and M-1 (per-tool workspace param), which haven't shipped. The skill went out before its dependencies. An agent that installs this skill today and follows workflow 7 will hit `Tool not found` errors on the first call, then look incompetent to the user.
- The frontmatter description (line 9-10) also claims "the Dopl MCP tools let the agent ... save patterns to the user's canvas, group them into reusable cluster skills, edit cluster brains, and ingest new URLs" — those parts are accurate. The workspace-switching claim is the part that breaks.
- Status: open

---

## High

### A-003: `mcp_connected_at` heartbeat is dead code
- Location: [src/shared/auth/api-keys.ts:138-152](src/shared/auth/api-keys.ts), [src/shared/auth/with-auth.ts:199-200](src/shared/auth/with-auth.ts), [src/app/api/user/mcp-status/route.ts](src/app/api/user/mcp-status/route.ts)
- Severity: **high** (resource waste, not correctness)
- Description: `touchMcpStatus` was added to advance the welcome-step connection detector. M-7 deleted the consumer (the welcome page polled `/api/user/mcp-status`). The heartbeat still fires on every authenticated MCP call, debounced to 30s per user. Net effect: a DB write per active MCP user every 30s for nothing. The GET endpoint at `/api/user/mcp-status/route.ts` still exists but no frontend code calls it.
- Stale comment at [with-auth.ts:199](src/shared/auth/with-auth.ts) still says "welcome-step connection detector" — already flagged in the M-7 verification.
- Status: open

### A-004: Stub deletion failure silently leaves "Untitled" rows
- Location: [src/features/knowledge/components/knowledge-base-view.tsx:230-248](src/features/knowledge/components/knowledge-base-view.tsx) (`handleCancelStub`)
- Severity: **high**
- Description: When a user hits Escape on a freshly-created stub row, the cancel handler calls the delete API in a `try { ... } catch {}` block. If the delete fails (network blip, race with another tab, server error), the catch swallows the error, but the code still calls `setEditingNodeId(null)` afterward — exiting edit mode and leaving a row called "Untitled folder" or "Untitled entry" stuck in the tree forever. No toast, no retry path. User has no idea the cleanup failed.
- Status: open

### A-005: Read-only users see "+ new" affordances they can't use
- Location: [src/features/knowledge/components/knowledge-tree.tsx](src/features/knowledge/components/knowledge-tree.tsx) (`AddRowAffordance`, `FolderRowActions`), [src/shared/layout/sidebar.tsx:708-723](src/shared/layout/sidebar.tsx) ("Add new knowledge base"), [skills sidebar equivalent at sidebar.tsx:862-877](src/shared/layout/sidebar.tsx)
- Severity: **high** (UX correctness — adjacent to M-8's whole point)
- Description: M-8 just shipped the eye-icon to tell users "this is read-only," but the sidebar and tree still render the "+ Add new knowledge base", "+ New folder", "+ New entry" buttons regardless of access level. Server enforcement rejects the call (good), but the user sees the button, clicks, and gets a 403/silent fail with no friendly message. Should be hidden client-side via `useMyAccess`. The hook is already loaded into the sidebar — wiring is one conditional.
- Status: open

### A-006: No IME composition handling in `InlineEditableRow`
- Location: [src/shared/ui/inline-editable-row.tsx:148-156](src/shared/ui/inline-editable-row.tsx)
- Severity: **high** (silent data corruption for CJK users)
- Description: Enter handler fires on `keyDown` with no `compositionStart`/`compositionEnd` guards. When a user mid-composition (Chinese/Japanese/Korean input) presses Enter to select a candidate, the handler calls `blur()` and commits whatever's currently in the input — usually a partial transliteration. CJK users will see their folder/entry/file names committed in unexpected partial form.
- Status: open

### A-007: No error toast when rename fails
- Location: [src/features/knowledge/components/knowledge-base-view.tsx:211-228](src/features/knowledge/components/knowledge-base-view.tsx) (`handleCommitRename`)
- Severity: **high**
- Description: When the rename API throws (slug collision, validation error, network), `InlineEditableRow.commit` correctly reverts the draft to the original value and stays in edit mode, but no toast or inline error tells the user *why*. They see their typed name disappear and revert to the old name with no explanation. Compare to skill-file-tabs.tsx which renders an inline error banner.
- Status: open

---

## Medium

### A-008: `useMyAccess` is fetched twice per page load
- Location: [src/shared/layout/sidebar.tsx:594](src/shared/layout/sidebar.tsx) and [sidebar.tsx:756](src/shared/layout/sidebar.tsx)
- Severity: **medium** (downgraded from agent's CRITICAL — it's wasted bandwidth, not a correctness bug)
- Description: Both `KnowledgeNavSection` and `SkillsNavSection` independently call `useMyAccess(workspaceSegment ?? null)`. The inline comment at lines 591-594 claims "browser caches dedupe it," but `/api/workspaces/[slug]/my-access/route.ts` sets no `Cache-Control` header, so the browser shouldn't cache. Two separate HTTP requests fire on every workspace load. Hoist into the parent `Sidebar` and pass down via props or context.
- Status: open

### A-009: New KB/skill rows missing access badge until next refetch
- Location: [src/shared/layout/sidebar.tsx:603-641](src/shared/layout/sidebar.tsx) and [sidebar.tsx:764-795](src/shared/layout/sidebar.tsx) (`handleAddNew`)
- Severity: **medium** (UX flicker)
- Description: After `handleAddNew` creates a KB/skill, the sidebar refetches the resource list and shows the new row. But the `useMyAccess` hook was last fetched *before* the resource existed, so `resolve("knowledge_base", newId)` falls back to `defaultLevel` from the cached payload. For owners/admins this happens to be correct ("edit" everywhere). For members/viewers with a non-default override mechanism, the badge can flash wrong then correct on next refresh. Trigger a `useMyAccess.refetch()` after create.
- Status: open

### A-010: No `Cache-Control` header on `/my-access` endpoint
- Location: [src/app/api/workspaces/[workspaceSlug]/my-access/route.ts:46](src/app/api/workspaces/%5BworkspaceSlug%5D/my-access/route.ts)
- Severity: **medium** (CDN privacy risk)
- Description: Endpoint returns `NextResponse.json(result)` with no caching directives. If a CDN sits in front of the app and is misconfigured to cache by URL alone (ignoring auth cookies), one user's access payload could be served to another user requesting the same workspace URL. Defense-in-depth: add `Cache-Control: private, no-store`. Vercel's default for authenticated routes is usually safe but worth being explicit.
- Status: open

### A-011: No defensive RLS on `workspace_resource_access`
- Location: [supabase/migrations/20260502140000_member_resource_access.sql](supabase/migrations/20260502140000_member_resource_access.sql)
- Severity: **medium** (downgraded from agent's CRITICAL — endpoint correctly validates membership before querying via `supabaseAdmin`)
- Description: Table has no RLS policies. Practically safe today because every consumer goes through `listMyAccess` / `getResourceAccess` / `setResourceAccessOverride`, all of which validate workspace membership server-side first ([api-keys/route.ts:32](src/app/api/workspaces/%5BworkspaceSlug%5D/my-access/route.ts) calls `resolveApiWorkspace`). But there's no defense-in-depth — a future dev who calls the table directly without validating membership would leak overrides. Worth adding RLS that scopes by `auth.uid() = user_id`.
- Status: open

### A-012: Stale "welcome-step" comment in `with-auth.ts`
- Location: [src/shared/auth/with-auth.ts:198-200](src/shared/auth/with-auth.ts)
- Severity: **medium** (documentation debt)
- Description: Comment still describes `touchMcpStatus` as the "welcome-step connection detector." With /welcome deleted, this is misleading — and once A-003 is resolved, the call itself disappears.
- Status: open

### A-013: Read-only users see rename context menu / double-click affordance
- Location: [src/features/knowledge/components/tree-context-menu.tsx](src/features/knowledge/components/tree-context-menu.tsx), [src/features/skills/components/skill-file-tabs.tsx:165-170](src/features/skills/components/skill-file-tabs.tsx)
- Severity: **medium** (parallel to A-005 but rename-specific)
- Description: Same shape as A-005 — rename UI is reachable for users with `read` access, server rejects with 403 but UI doesn't pre-empt. Hide the "Rename" menu item and the double-click rename trigger when `useMyAccess` returns `read`.
- Status: open

### A-014: Cancel-during-commit race in inline rename
- Location: [src/features/knowledge/components/knowledge-tree.tsx:483-489](src/features/knowledge/components/knowledge-tree.tsx) (FolderRow `onCancel`)
- Severity: **medium** (rare but real)
- Description: Sequence: user presses Enter to commit, the rename API fires, then before it resolves the user hits Escape. `InlineEditableRow.cancel()` runs because `settledRef.current` is still false. The `onCancel` handler decides "this is a stub, delete it" via `inline.isStub(folder.id)`, deletes the row, then the rename API completes and silently 404s (or worse, succeeds and updates a now-orphaned row). Window is small (the time between commit and rename API response) but not zero.
- Status: open

### A-015: No `maxLength` on inline-edit input
- Location: [src/shared/ui/inline-editable-row.tsx:141-170](src/shared/ui/inline-editable-row.tsx)
- Severity: **medium** (UX, mild server-side risk)
- Description: User can paste a 5000-char name. The input grows, the row layout breaks. Server should reject (need to verify max-length validation on the rename API), but client should proactively cap at whatever the server allows (likely 200 chars for KB names, 100 for entries). Add `maxLength` matching the server's limit.
- Status: open

### A-016: No loading state on "+ Add new" buttons during create
- Location: [src/features/knowledge/components/knowledge-tree.tsx:528-549](src/features/knowledge/components/knowledge-tree.tsx) and [sidebar.tsx:603-641](src/shared/layout/sidebar.tsx) (sidebar handles this with a `creating` flag — verify the canvas tree does too)
- Severity: **medium**
- Description: On a slow network, repeated clicks on "+ New folder" issue duplicate creates. The sidebar `handleAddNew` correctly guards with a `creating` flag (`if (creating) return`). The in-tree `AddRowAffordance` and `FolderRowActions` need the same guard.
- Status: open

### A-017: Skill file tab rename input doesn't select-all on focus
- Location: [src/features/skills/components/skill-file-tabs.tsx:129-154](src/features/skills/components/skill-file-tabs.tsx) (`FileTab`)
- Severity: **medium** (inconsistent UX vs. tree rename)
- Description: The skill file tab has its own bespoke rename input rather than reusing `InlineEditableRow` (likely because the tab renders horizontally in a row of tabs). It autofocuses but doesn't `select()` the existing name, so users have to ⌘A before typing. The `InlineEditableRow` already handles this via `selectAllOnMount`. Either refactor to reuse the shared component or replicate the select-all behavior.
- Status: open

---

## Low

### A-018: Orphaned `workspace_resource_access` rows on resource deletion
- Location: [supabase/migrations/20260502140000_member_resource_access.sql](supabase/migrations/20260502140000_member_resource_access.sql)
- Severity: **low** (data hygiene)
- Description: Foreign keys CASCADE on `workspace_id` and `user_id` but not on `resource_id` (since `resource_id` is polymorphic — points at either a KB or a skill, depending on `resource_type`). When a KB or skill is deleted, override rows become orphans. They don't break anything (lookups by `(workspace_id, user_id, resource_type, resource_id)` just don't match anymore) but the table grows. Add a cleanup trigger or a periodic prune.
- Status: open

### A-019: Concurrent "Untitled" workspace creation race
- Location: [src/features/workspaces/server/service.ts:64-79](src/features/workspaces/server/service.ts) (`ensureDefaultWorkspace`), [src/app/auth/callback/route.ts:51-57](src/app/auth/callback/route.ts), [src/app/canvas/page.tsx](src/app/canvas/page.tsx)
- Severity: **low** (race window is small, double-create is recoverable)
- Description: `ensureDefaultWorkspace` is called from both the auth callback and the `/canvas` server component. On a fast nav, the callback's `ensure` is in flight when the redirect lands and `/canvas` calls `ensure` again. The "exists" check at line 91 of service.ts isn't atomic, so two `Untitled` workspaces could be inserted. Per-owner slug uniqueness saves the second insert from succeeding (it'd 409), but the error path is silent — the user sees a confusing "couldn't load workspace" depending on which call wins. Wrap in a unique constraint + ON CONFLICT DO NOTHING, or serialize with an advisory lock.
- Status: open

### A-020: Native `title` tooltips invisible to keyboard users
- Location: [src/shared/layout/sidebar.tsx:898, 908](src/shared/layout/sidebar.tsx) (`AccessIcon`)
- Severity: **low** (accessibility)
- Description: Native `title` only shows on mouse hover, not keyboard focus. Sighted keyboard-only users tabbing through the sidebar see eye/pencil icons with no explanation. Screen readers do read the `aria-label`. Optional: replace with a real Tooltip component (e.g., Radix) that fires on focus too.
- Status: open

### A-021: `useMyAccess` not subscribed to realtime changes
- Location: [src/features/members/hooks/use-my-access.ts](src/features/members/hooks/use-my-access.ts)
- Severity: **low**
- Description: KB and skill lists subscribe to realtime via `useKnowledgeRealtime` / `useSkillsRealtime`. Access overrides don't. When an admin changes a member's access in the matrix UI, the affected member's sidebar badge stays stale until next page load. Probably acceptable for v1 (access changes are rare), but worth flagging.
- Status: open

### A-022: Duplicate "Onboarding MCP" key names not deduped
- Location: [src/features/chat/components/chat-panel-cards.tsx:29, 40](src/features/chat/components/chat-panel-cards.tsx), [src/features/onboarding/components/mcp-connect-step.tsx:51, 62](src/features/onboarding/components/mcp-connect-step.tsx)
- Severity: **low**
- Description: Multiple paths POST to `/api/user/keys` with hardcoded name `"Onboarding MCP"`. If the user re-renders the MCP connect card or refreshes during onboarding, multiple keys with the same name accumulate. Cosmetic clutter in the keys list, no security impact. Either dedupe by name on the server or use a `name + timestamp` pattern (which `connect-app-section.tsx` already does correctly).
- Status: open

---

## Agent claims that didn't survive verification

These were flagged as bugs by the audit agents but are actually fine on direct read:

- **"Blur-to-commit race after Escape" (alleged CRITICAL).** The audit agent claimed `cancellingRef.current = true` is set after an `await`. Wrong — at [inline-editable-row.tsx:129](src/shared/ui/inline-editable-row.tsx) it's set *synchronously before any await*, so the `onBlur` handler at line 160 correctly skips the duplicate commit.
- **"Empty whitespace commit" (alleged CRITICAL).** The component at [inline-editable-row.tsx:107-113](src/shared/ui/inline-editable-row.tsx) trims and early-returns when the trimmed string is empty. Whitespace-only input is correctly a no-op.
- **"Cross-workspace data leak via spoofed workspace_id" (alleged HIGH).** The endpoint at [my-access/route.ts:32](src/app/api/workspaces/%5BworkspaceSlug%5D/my-access/route.ts) calls `resolveApiWorkspace(workspaceSlug, userId)` which returns null for non-members. Membership is enforced before any DB read. Not a leak.
- **"Mid-flight users land on /canvas confused" (alleged HIGH).** The agent assumed users mid-onboarding would lose context. In practice, `ensureDefaultWorkspace` and `ensureDefaultCanvas` already ran for them on first sign-in (auth callback always provisions), so they have a usable workspace. Worst case: they miss the MCP-install nudge that used to live in `/welcome`, which is now in `/settings/keys` per A-003 follow-on. Acceptable.

---

## Suggested next steps (not part of the findings, just framing)

If you tackle these in priority order: A-002 (master skill is broken on first install — fix or revert workflow 7) → A-001 (open redirect — security) → A-003 (dead heartbeat code — cheap win) → A-005 / A-013 (UX correctness for the access feature you just shipped) → A-004 / A-006 / A-007 (inline-edit error handling). The medium / low items can roll into normal cleanup PRs.
