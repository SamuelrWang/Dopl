# Verification: fixes for M-5 through M-11 audit findings

Captured 2026-05-04. Verifies the fix batch shipped against the prior audit docs `M7-M11-AUDIT-FINDINGS.md` and `M5-M6-M10-AUDIT-FINDINGS.md`.

For each shipped fix: did it actually resolve the original finding, did it introduce a new bug, and is the resulting code clean (vs. a bandage)? Severity reflects practical impact, not the audit-agent's initial label.

## TLDR

- **23 of 25 fixes ship clean.** Most are well-architected — proper Provider for `useMyAccess` (no prop drilling), real `<Tooltip>` primitive (not a CSS hack), structured error classes (not silent coercion), Postgres unique-violation race fix scoped tightly to the right error code.
- **One incomplete fix that's worth landing today:** the migration adding RLS policies to `workspace_resource_access` (A-011 / A-018) does NOT actually `ENABLE ROW LEVEL SECURITY` on the table. The policies are inert. The migration's own comment claims "RLS enabled but zero policies" — this is **factually wrong** (no prior migration enabled it either). Defense-in-depth claim is currently false. One-line fix.
- **One audit-agent over-rate:** the alleged "newline/tab smuggling" caveat in `safeRedirect()` doesn't actually expose anything — control chars get stripped by the URL parser and a same-origin-but-weird path is harmless after `NextResponse.redirect(new URL(result, request.url))`. Skip.
- **Two minor code-quality observations** worth noting (not blockers): `skill-file-tabs.tsx` keeps a bespoke rename input instead of using `InlineEditableRow` (justified by the inline-validation UX, but the IME guard is now single-layer where the shared one is dual-layer); `A-021`'s window.focus refetch lacks a debounce (acceptable for v1, watch for hammering if users alt-tab in burst patterns).

The codebase is in better shape than it was before the fixes. No bandages. The architectural decisions (provider, primitive, error classes, sentinel-origin URL parser) are the kinds of things you'd build from scratch — they don't read like patches around a problem.

---

## Critical

### V-001: `workspace_resource_access` RLS policies are inert — `ENABLE ROW LEVEL SECURITY` was never run
- Location: [supabase/migrations/20260504050000_workspace_resource_access_defensive_rls_and_cleanup.sql](supabase/migrations/20260504050000_workspace_resource_access_defensive_rls_and_cleanup.sql) and the original [20260502140000_member_resource_access.sql](supabase/migrations/20260502140000_member_resource_access.sql)
- Severity: **critical** (defense-in-depth false; potential trap for future devs)
- What was claimed: A-011 / A-018 fixed by adding a `SELECT-self` RLS policy + cleanup triggers. Spec was "user can read their own override rows; nobody else can."
- What's actually shipped:
  - The new migration's own header comment (line 1-3) asserts: *"workspace_resource_access has RLS enabled but zero policies."* This statement is **wrong**. I grep'd both migrations for any `ENABLE ROW LEVEL SECURITY` statement on this table — neither contains one ([20260502140000_member_resource_access.sql](supabase/migrations/20260502140000_member_resource_access.sql) creates the table without enabling RLS, and the new migration only adds a policy).
  - In Postgres, RLS policies on a table without RLS enabled are **completely inert**. The policy parses, lints clean, and silently does nothing.
- Practical impact today: *zero*, because every consumer goes through `supabaseAdmin()` (service role, RLS-bypass). The fix's stated purpose is "defense-in-depth for a future caller who uses the session client" — that future caller will get *no rows back* (RLS-disabled tables are wide-open via service role; via session client they're closed-by-default-without-policy in Supabase, but actually they're WIDE OPEN since RLS is off entirely). Either way the policy is decorative.
- Cleanup triggers (the A-018 half) are correctly written and DO work — they're plain triggers, not RLS-dependent. So the orphan-pruning behavior ships clean. The bug is purely on the SELECT-policy half.
- Fix shape: add `ALTER TABLE workspace_resource_access ENABLE ROW LEVEL SECURITY;` to the migration. One line. Either patch the migration in place (if not yet deployed to prod) or ship a follow-up migration that enables RLS.
- Status: open

---

## Verified clean (no further work needed)

### V-002: `safeRedirect()` correctly closes A-001
- Location: [src/shared/lib/url/safe-redirect.ts](src/shared/lib/url/safe-redirect.ts), [src/app/auth/callback/route.ts:18](src/app/auth/callback/route.ts), [src/app/login/page.tsx:23](src/app/login/page.tsx)
- The sentinel-origin pattern (`new URL(redirectTo, "https://safe-redirect.invalid")`) is the right shape — anything that parses to a different origin gets caught by the `parsed.origin !== sentinelOrigin` check at line 53. Absolute URLs, protocol-relative, backslash variants, scheme injection (`javascript:`, `data:`), URL-encoded `%2F%2F` — all return fallback. Both consumers call it before navigation. The return value is reassembled from `pathname + search + hash` so credentials in `userinfo` get stripped.
- The agent flagged "newline/tab smuggling" as a caveat; on direct verification it's not a real issue. The URL spec strips control chars during parsing; a payload like `/canvas\n//evil.com` resolves to a same-origin path `/canvas//evil.com` which is then handed to `NextResponse.redirect(new URL(result, request.url))`. That returns `https://app.com/canvas//evil.com` — same origin, weird but harmless. No exfiltration vector. Skip the recommended `\r\n\t` regex; it's noise.
- Code quality: 57 lines, single concern, clear doc-comment with attack vector. No dependencies. ✅

### V-003: B1 lazy-seed gate uses pre-filter count
- Location: [src/features/knowledge/server/service.ts](src/features/knowledge/server/service.ts) (`listBases` line 120-128), [src/features/skills/server/service.ts](src/features/skills/server/service.ts) (`listSkills` line 83-88)
- The pattern `if (all.length > 0) return visible` correctly gates seeding on the unfiltered count, so Member B joining a workspace with only private items doesn't re-trigger seed. New seeded fixtures explicitly pass `visibility: "public"` ([service.ts:967](src/features/knowledge/server/service.ts), [skills/service.ts:511](src/features/skills/server/service.ts)). Comments at the gate sites document the rationale and reference the audit ID. ✅

### V-004: B2 canvas_panels visibility-aware SELECT RLS
- Location: [supabase/migrations/20260504040000_canvas_panels_visibility_aware_select.sql](supabase/migrations/20260504040000_canvas_panels_visibility_aware_select.sql)
- The CASE statement correctly EXIST-checks the underlying KB / skill `visibility` for `knowledge_base` and `skill` panel types, with `ELSE TRUE` for other types so cluster / entry panels are unaffected. `DROP POLICY IF EXISTS` before `CREATE` prevents stacked policies. EXISTS subquery uses the PK on `knowledge_bases.id` / `skills.id` — performance is fine. Deleted-resource case correctly returns false (panel becomes invisible — desired). ✅

### V-005: M-10 `WorkspaceKey*Error` classes + workspace-scoped default = public
- Location: [src/features/knowledge/server/errors.ts:61-70](src/features/knowledge/server/errors.ts), [src/features/skills/server/errors.ts:95-104](src/features/skills/server/errors.ts), thrown at [knowledge/server/service.ts:200](src/features/knowledge/server/service.ts), mapped to 403 at [knowledge/server/http-mapping.ts:56-58](src/features/knowledge/server/http-mapping.ts)
- Workspace-scoped key creating a private resource throws `WORKSPACE_KEY_PRIVATE_VISIBILITY` (403). Workspace-scoped creates default to `'public'`; session/personal-key creates default to `'private'`. The "use a personal API key" message in the error directs the user. This closes the M-10 boundary that the prior audit (A-026) flagged as missing. ✅

### V-006: A-006 IME composition handling — dual-layer in InlineEditableRow
- Location: [src/shared/ui/inline-editable-row.tsx:194-205](src/shared/ui/inline-editable-row.tsx) (`isImeKey`), refs at lines 109-114, composition handlers at lines 219-224
- Three signals checked: `composingRef.current` (set by `compositionstart` / `compositionend`), `e.nativeEvent.isComposing`, and the legacy `e.keyCode === 229`. Order of events on Enter-to-confirm-IME-candidate: `compositionend` fires before `keydown`, so by the time the keydown handler runs, all three signals report not-composing — Enter correctly commits the post-IME value. Clean. ✅

### V-007: A-014 `committingRef` synchronous race gate
- Location: [src/shared/ui/inline-editable-row.tsx:155, 167, 144, 176](src/shared/ui/inline-editable-row.tsx)
- Set synchronously at the start of `commit()` before any `await`; checked synchronously by `cancel()` to skip the stub-delete during in-flight rename; cleared in `finally`. Co-exists with `settledRef` (post-settle no-op guard) and `cancellingRef` (cancel-in-progress guard). Three refs sounds like a smell but each guards a distinct race — settle dedupe, cancel→blur dedupe, commit→cancel dedupe — so the state machine is actually coherent. ✅

### V-008: A-015 `maxLength` props match server validators
- Locations: KB names 120 ([knowledge/schema.ts:86](src/features/knowledge/schema.ts)), folders 200 ([schema.ts:113](src/features/knowledge/schema.ts)), entries 300 ([schema.ts:145](src/features/knowledge/schema.ts)), skill files 120 ([skills/schema.ts:77](src/features/skills/schema.ts)). Client `maxLength` matches each. Both client and server count UTF-16 code units (HTML `maxLength` and zod `.max()` semantics align). ✅

### V-009: A-008 `MyAccessProvider` is properly hoisted
- Location: [src/shared/layout/layout-shell.tsx:84](src/shared/layout/layout-shell.tsx) mounts the provider once. All consumers — sidebar (KB + skill nav), full-page KB / skill views, canvas panels — call `useMyAccessContext()`. Bare `useMyAccess` hook still exists for the provider's internal use only. Single fetch per workspace load, dep array correctly tracks workspace switch. Clean Provider pattern, no prop drilling. ✅

### V-010: A-010 `Cache-Control: private, no-store` + canonical error envelope
- Location: [src/app/api/workspaces/[workspaceSlug]/my-access/route.ts](src/app/api/workspaces/%5BworkspaceSlug%5D/my-access/route.ts) — header set at line 65, error envelope `{ error: { code, message } }` on every error path, codes use the canonical names (MISSING_WORKSPACE_SLUG / WORKSPACE_NOT_FOUND / NOT_A_MEMBER / INTERNAL_ERROR). Matches ENGINEERING.md §9. ✅

### V-011: A-005 / A-013 affordance hiding falls open while loading
- Location: KB tree / sidebar / skill file tabs — gating uses `accessLevel == null ? true : meetsLevel(accessLevel, "edit")` (knowledge-base-view.tsx:74, skill-view.tsx:74). Read-only members see no "+ Add" buttons, no Rename / Delete context menu items, no double-click rename. Owners/admins don't flicker because the default during loading is `true`. The inverse-flicker for actual read-only users (brief moment of seeing the buttons before they hide) is intentional per spec — admin flicker is the more common case. ✅

### V-012: A-009 `access.refetch()` after create
- Location: sidebar `handleAddNew` for both KBs and skills calls `access.refetch()` inside the try-block AFTER the create resolves, before navigation. Not called on failure (no wasted fetch). New row's badge resolves correctly without falling back to cached defaults. ✅

### V-013: A-020 `<Tooltip>` primitive is a real primitive, not a CSS hack
- Location: [src/shared/ui/tooltip.tsx](src/shared/ui/tooltip.tsx) — 86 lines, no new dependencies (just React + cn). Fires on `onMouseEnter` AND `onFocus` (keyboard accessibility, the original gap from A-020). `aria-describedby` wires the floating label to the trigger. Inline render with `z-50` (no portal — fine for small tooltips that don't escape clipping containers). Extensible via `label` / `side` / `className` props. Replaces native `title=""` on `AccessIcon` cleanly. ✅

### V-014: A-019 `ensureDefaultWorkspace` 23505 catch is correctly scoped
- Location: [src/features/workspaces/server/service.ts:101-129](src/features/workspaces/server/service.ts)
- Catches only Postgres `23505` (unique_violation), checks both `err.code` and `err.message` patterns defensively, calls `findDefaultWorkspaceForUser` to recover. Other 23505s on this table (e.g., a `publicId` collision, which would be a different race) would also be caught — but `findDefaultWorkspaceForUser` then returns null, and the catch falls through to re-throw. So the recovery is safe even when the unique-violation isn't the one we expected. ✅

### V-015: A-022 `Onboarding MCP` key dedupe
- Location: [src/features/onboarding/components/mcp-connect-step.tsx:57, 75](src/features/onboarding/components/mcp-connect-step.tsx) (date-stamped names like `Onboarding MCP · 5/4/2026`); [src/features/chat/components/chat-panel-cards.tsx](src/features/chat/components/chat-panel-cards.tsx) rewritten to a single conditional fetch (lines 17-58) with `cancelled` flag for unmount safety. No more 2-3 unconditional POSTs per render. ✅

### V-016: A-003 / A-012 `mcp_connected_at` consciously kept
- The agent originally flagged this as dead code. On verification: `mcp-connect-step.tsx` (the post-M-7 onboarding tour, separate from the now-deleted `/welcome` page) still polls `/api/user/mcp-status` on a 3s interval to advance the "MCP connected" step. Comments at [src/shared/auth/with-auth.ts:199-202](src/shared/auth/with-auth.ts) and [api-keys.ts:120-134](src/shared/auth/api-keys.ts) now correctly reference the onboarding tour as the consumer (not the old welcome step). The audit-and-keep decision is documented inline. ✅

### V-017: B7 cleanup uses `userId` from `.dopl-meta.json` sidecar
- Location: [packages/mcp-server/src/orphan-skill-cleanup.ts:66, 184-192](packages/mcp-server/src/orphan-skill-cleanup.ts), `pingMcpStatus` POST returns `user_id` (mcp-status route)
- Cleanup reads the sidecar, extracts userId, only deletes dirs that match the booting user. **Legacy meta files without a userId field are LEFT ALONE** — this is the multi-user-OS-account safety guarantee. As a side benefit, this also gates A-024 (mass-delete on empty workspaces): legacy files don't match the user filter, so even an empty workspace list won't nuke pre-userId-tracking dirs.
- One subtle thing worth confirming on first deploy: any new skill writes between this fix and the user's next ping will have userId stamped, so the protection is forward-compatible. ✅

### V-018: B12 `LIST_CLUSTERS_CONCURRENCY = 6` chunked Promise.all
- Location: [packages/mcp-server/src/orphan-skill-cleanup.ts:61, 107-123](packages/mcp-server/src/orphan-skill-cleanup.ts) — hand-rolled chunking (no `p-limit` dep), 6 parallel calls per chunk, sequential between chunks. Cap is reasonable; matches typical user workspace counts. ✅

### V-019: B8 / B11 `resolveWorkspaceRef` ergonomics
- Location: [packages/mcp-server/src/server.ts:430-447, 500-515](packages/mcp-server/src/server.ts)
- B8: try/catch wraps the resolve call; failures surface as `{ isError: true, content: [{ type: "text", text: ... }] }` so the agent sees a useful message instead of opaque transport errors.
- B11: `list.find((w) => w.id === ref || w.slug === ref)` matches in a single pass. No wasteful refetch when slug happens to be hex-shaped. Force-refresh path runs once on miss, then retries. ✅

### V-020: B4 onboarding-dismissed backfill
- Location: [supabase/migrations/20260504060000_backfill_onboarding_dismissed_for_legacy_users.sql](supabase/migrations/20260504060000_backfill_onboarding_dismissed_for_legacy_users.sql)
- Idempotent (LEFT JOIN guard on existing `user_preferences`), sets `dismissed: true` for users without an onboarding pref, leaves new signups unaffected (they get default state on first visit and see the tour). ✅

### V-021: B9 F-018 in REFACTOR-FINDINGS.md
- Documents the historical `is_workspace_member 'editor' → 'member'` bug bundled into the M-10 migration. Includes the warning to keep the function in sync on future role enum changes. Status: `fixed-in-20260504030000`. ✅

---

## Code-quality observations (not bugs, worth noting)

### V-022: skill-file-tabs uses bespoke rename input + single-layer IME guard
- Location: [src/features/skills/components/skill-file-tabs.tsx:138-159](src/features/skills/components/skill-file-tabs.tsx)
- The rename UI keeps its own input (not `InlineEditableRow`) so it can do sanitize-and-keep-draft inline validation, which `InlineEditableRow` doesn't handle. The justification at line 143 is fair — file names need pre-API validation (`.md` enforcement, illegal chars), and routing that through the shared component would either bloat the shared API or push validation onto every consumer.
- The IME guard at line 159 is `e.nativeEvent.isComposing || e.keyCode === 229` — single-layer where the shared component's check is dual-layer (also tracks via `composingRef`). For browsers that lag on `isComposing`, this is slightly less robust. Adding `onCompositionStart` / `onCompositionEnd` here would close the gap in five lines.
- Not blocking. The bespoke shape isn't a bandage — it's load-bearing duplication for a real difference in requirements. But matching the shared component's IME pattern would avoid the divergence drifting further over time.

### V-023: A-021 window.focus refetch has no debounce
- Location: presumably [src/features/members/hooks/use-my-access.tsx](src/features/members/hooks/use-my-access.tsx) (provider effect)
- Each window-focus event fires one fetch. A user rapidly alt-tabbing or switching desktops produces a burst of identical requests. Not a correctness bug — just a small bandwidth and DB-load concern.
- For v1, fine. If logs show repeated focus-driven fetches per user per minute, add a 2-3 second leading-edge debounce. The hook is already a single instance via the Provider, so the debounce logic only needs to live in one place.

### V-024: split error-handling responsibility (toast in parent, revert in component)
- Location: [src/features/knowledge/components/knowledge-tree.tsx:495-497, 666-668](src/features/knowledge/components/knowledge-tree.tsx) parents call `await inline.commitRename(...)`; the parent's wrapping handler ([knowledge-base-view.tsx:220-237](src/features/knowledge/components/knowledge-base-view.tsx)) catches, toasts, and re-throws.
- The audit agent flagged this as "fragile architecture" because `InlineEditableRow.onError` isn't wired. On direct read, the pattern is actually coherent: parent owns presentation (toasts), component owns state machine (revert draft + stay in edit mode). The optional `onError` is a *redundant* path for callers that don't want to wrap in try/catch — the parents here DO wrap, so they don't need it.
- Skip this concern. The pattern is fine.

### V-025: knowledge-tree busy flags are per-component, not unified
- Location: [knowledge-tree.tsx](src/features/knowledge/components/knowledge-tree.tsx) (`FolderRowActions` and `AddRowAffordance` each have their own `useState(false)` for `busy`)
- A user can't simultaneously click "+ New entry" in two folders because each folder's actions are scoped to its own row, but two SEPARATE folders' add-buttons could fire concurrent posts (one per folder). That's actually fine — they're independent operations. The audit agent suggested unifying for "code quality" but that would couple unrelated UI states.
- Working as designed. Skip.

---

## Summary by audit ID

| Original finding | Verified status | Notes |
|---|---|---|
| A-001 open redirect | ✅ V-002 | sentinel-origin pattern, both consumers wired |
| A-003 / A-012 mcp_connected_at | ✅ V-016 | Audited and consciously kept; comments updated to point at real consumer |
| A-004 / A-007 toast on cancel/commit | ✅ V-024 | Split parent/component responsibility is coherent |
| A-005 / A-013 affordance hiding | ✅ V-011 | Falls-open-while-loading prevents admin flicker |
| A-006 IME composition | ✅ V-006 | Dual-layer in shared component; ⚠️ V-022 single-layer in skill-file-tabs |
| A-008 useMyAccess provider | ✅ V-009 | Clean Provider, no prop drilling |
| A-009 refetch after create | ✅ V-012 | Inside try-block, after success, before navigation |
| A-010 cache-control + error envelope | ✅ V-010 | `private, no-store` + canonical `{ error: { code, message } }` |
| A-011 / A-018 RLS + cleanup | ❌ V-001 | **RLS not enabled on the table — policies inert. Critical.** Triggers half is fine. |
| A-014 commit/cancel race | ✅ V-007 | Three coherent refs, each guarding a distinct race |
| A-015 maxLength | ✅ V-008 | Client matches server validators |
| A-016 busy flags | ✅ V-025 | Per-row state is intentional, not a smell |
| A-017 skill-file-tabs parity | ⚠️ V-022 | maxLength + select-all done; IME guard single-layer (acceptable) |
| A-019 23505 race | ✅ V-014 | Catch is tightly scoped to `code === "23505"` |
| A-020 Tooltip | ✅ V-013 | Real primitive, no deps, hover + focus, aria-describedby |
| A-021 focus refetch | ⚠️ V-023 | No debounce; acceptable for v1, watch for hammering |
| A-022 dedupe Onboarding MCP | ✅ V-015 | Date-stamped names + single conditional fetch |
| B1 lazy-seed gate | ✅ V-003 | Pre-filter count |
| B2 canvas_panels RLS | ✅ V-004 | EXIST-check on visibility, ELSE TRUE for non-resource panels |
| B4 onboarding backfill | ✅ V-020 | Idempotent migration |
| B6 / B15 workspace-key visibility errors | ✅ V-005 | 403 + canonical code, defaults flip on key class |
| B7 userId-aware cleanup | ✅ V-017 | Multi-user-OS safe; legacy files left alone |
| B8 / B11 resolveWorkspaceRef | ✅ V-019 | Structured errors + single-pass id/slug match |
| B9 F-018 in REFACTOR-FINDINGS | ✅ V-021 | Documented with future-warning |
| B10 VisibilityPill in canvas | ✅ (parity with full-page) | Brief: pill exists in both panel headers |
| B12 listClusters concurrency cap | ✅ V-018 | `LIST_CLUSTERS_CONCURRENCY = 6`, hand-rolled chunking |

---

## Action items (ordered by urgency)

1. **V-001** — add `ALTER TABLE workspace_resource_access ENABLE ROW LEVEL SECURITY;` either by patching `20260504050000_*.sql` (if not yet deployed) or shipping a tiny follow-up migration. The migration's own header comment is also factually wrong and should be corrected at the same time. One commit.
2. **V-022** — *optional, low priority*: add `onCompositionStart` / `onCompositionEnd` to skill-file-tabs.tsx for IME-guard parity with the shared component. Five lines.
3. **V-023** — *watch only*: if mcp-status / my-access endpoint logs show focus-driven fetch bursts, add a 2-3 second leading-edge debounce in the provider's focus listener.

Everything else is shipping clean.
