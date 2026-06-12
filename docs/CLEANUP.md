# Dead-Code Cleanup Catalog

> Generated 2026-06-12. **EXECUTED 2026-06-12** — Tiers 1–5 + 7 done (typecheck + build green).
> Remaining: Tier 6 scripts (needs team decision) and the knip long-tail of unused exports
> (rerun `npx knip`; ~50 left, many false positives — verify per-item).
>
> Corrections found during execution:
> - `scripts/backfill-title-summary.ts` imported the dead AI subgraph AND queried the dropped
>   `entries` table — deleted with Tier 1 (report missed the dependency).
> - `skill-body.ts` types feed live `SkillRef`/`parseSkillBody` — **kept**, report wrong.
> - `mcp-oauth.ts` `MCP_SCOPES`/`ACCESS_TTL_S`/`verifyPkceS256` used internally — **kept**.
> - `LegacyKnowledgeEntry(Type)` used internally by `LegacyKnowledgeBase` — un-exported, kept.
> - The `published_clusters` mention in seed-fixtures-data.ts is fixture *content* (seeded doc
>   body), not a stale comment — left as-is.
> - `fetchTrash` (knowledge client) was only called by dead `useKnowledgeTrash` — deleted too.
> - Design system: `PlatformIcon` + `BackgroundGrid` components deleted whole; the three
>   `*Variants` consts are used internally by their components — un-exported, kept.

## How findings were verified
- **grep**: alias-aware `grep -rln` for every import path across `src/` + `packages/`. Zero inbound = candidate.
- **knip**: full unused-files / unused-exports / unused-deps sweep (config in `knip.json`), scoped to the live tree (`.claude/`, `dist/`, `supabase/` ignored). Catches dead *exports inside live files* that grep cannot.
- Every Tier 1–4 item below was **hand-confirmed with grep** (knip alone has false positives — e.g. it flagged `supabase/types.ts`, which is live; excluded).

Certainty legend: 🟢 certain (0 refs, hand-verified) · 🟡 near-certain (verify the one edge) · 🔴 needs a decision.

---

## Tier 1 — Dead source files 🟢 (32 files, all grep-verified 0 inbound refs)

Safe to `git rm`. Grouped by area.

### Orphan components (5)
| File | Old feature / note |
|---|---|
| `src/features/billing/components/upgrade-modal.tsx` | superseded paywall UI |
| `src/features/chat/components/url-detection.ts` | v1 chat URL→ingest shortcut |
| `src/features/knowledge/components/doc-markdown.tsx` | superseded by active doc renderer |
| `src/features/knowledge/components/trash-modal.tsx` | unused trash UI |
| `src/features/skills/components/body-render.tsx` | old structured skill-body renderer (see Tier 5: `skill-body.ts` types) |

### Dead AI subgraph (3) — also frees the `openai` dep
`ai.ts` has **zero** importers; `retry.ts` and `call-external.ts` are imported **only** by `ai.ts`. Whole cluster is dead.
| File |
|---|
| `src/shared/lib/ai.ts` |
| `src/shared/lib/retry.ts` |
| `src/features/analytics/server/call-external.ts` |

### Leftover ingestion/classifier prompts (8) — `src/shared/prompts/`
All 0 refs. Relics of the removed ingestion pipeline.
`agents-md.ts` · `content-classifier.ts` · `content-type-classifier.ts` · `image-vision.ts` · `manifest.ts` · `readme.ts` · `skeleton-descriptor.ts` · `tags.ts`

### Unused shared UI kit (9) — `src/shared/ui/`
All 0 refs (app renders via Base UI / other primitives directly).
`badge.tsx` · `card.tsx` · `input.tsx` · `label.tsx` · `select.tsx` · `separator.tsx` · `tabs.tsx` · `textarea.tsx` · `tooltip.tsx`

### Other orphan modules (7)
| File | Note |
|---|---|
| `src/shared/lib/github.ts` | GitHub extractor (ingestion-era) |
| `src/shared/hooks/use-mcp-connection-status.ts` | unused hook |
| `src/shared/api/error-handler.ts` | superseded error handler |
| `src/shared/lib/url/workspace-segment.ts` | unused segment util |
| `src/shared/design/orb.tsx` | unused design element (not in marketing) |
| `src/features/members/schema.ts` | unused schema |
| `src/features/knowledge-packs/server/types.ts` | unused types |

---

## Tier 2 — Dead dependencies 🟢 (`package.json`)

| Dep | Evidence |
|---|---|
| `apify-client` | 0 refs anywhere |
| `@dnd-kit/sortable` | 0 refs (only base `@dnd-kit/core` used) |
| `@dnd-kit/utilities` | 0 refs |
| `@tiptap/extension-table-cell` | 0 refs |
| `@tiptap/extension-table-header` | 0 refs |
| `@tiptap/extension-table-row` | 0 refs |
| `openai` | imported only inside the dead AI subgraph (Tier 1) — remove together |

**knip false positives — DO NOT remove:** `uuid` (20 refs), `remark-gfm` (1 ref), `@types/uuid` (uuid is live).

**Correctness note (not cleanup):** knip flags two *unlisted* deps actually imported — `dotenv` (`src/app/api/chat/route.ts`) and `@modelcontextprotocol/sdk/.../webStandardStreamableHttp.js` (`src/app/api/mcp/route.ts`). These should be **added** to `package.json`, not removed.

---

## Tier 3 — Static assets & junk 🟢

| Path | Note |
|---|---|
| `public/next.svg`, `public/vercel.svg`, `public/globe.svg`, `public/window.svg`, `public/file.svg` | create-next-app boilerplate, 0 refs |
| `public/img/background_image.png` | 8.9 MB, 0 refs |
| `public/.DS_Store`, `public/img/.DS_Store` | macOS junk — also add `**/.DS_Store` to `.gitignore` |

---

## Tier 4 — Git worktree junk 🟢 (167 MB)

`.claude/worktrees/` holds **10 registered `claude/*` worktrees**, untracked, no `.gitignore` entry.
**Audit:** every branch is `ahead:0` of `master` (fully merged, zero unique commits), `behind` 31–36.
Only dirty file across all 10 is `blissful-fermi-2f81c6/supabase/.temp/cli-latest` (Supabase CLI cache — disposable). They even still contain the long-removed `packages/cli/` — confirming they're stale snapshots.

**Action:** `git worktree remove` all 10 + `git branch -D claude/*`, then add `.claude/worktrees/` to `.gitignore`. Frees 167 MB. (Matches the standing rule never to leave work on `claude/*` branches.)

```
adoring-meninsky-df2898   blissful-fermi-2f81c6   bold-ellis-87bdcb
distracted-tharp-590acb   naughty-bouman-22ec66   objective-ramanujan-0f9544
stupefied-spence-12b13e   suspicious-einstein-b18544   trusting-dewdney-e0ffdb
zealous-borg-4259b4
```

---

## Tier 5 — Dead exports inside live files 🟡 (knip; verify each before deleting)

These live in files that are *kept*, so deletion is surgical, not whole-file. knip found ~150; the high-signal clusters below are worth a pass. **Caveat:** Zod schemas, Next.js entry exports, and barrel re-exports can be false positives — verify each.

- **Ingestion-era config constants** — `src/config/index.ts`: `MAX_LINK_DEPTH`, `MAX_CONTENT_FOR_CLAUDE`, `GATHERED_CONTENT_MAX`, `MAX_IMAGES_PER_ENTRY`, `MAX_IMAGE_SIZE_BYTES`, `FREE_INGESTION_LIMIT`, `CONTENT_PREVIEW_LENGTH`. Also reserved slugs for removed routes (`community`, `entries`).
- **Dead knowledge client wrappers** — `src/features/knowledge/client/api.ts`: `fetchBase`, `restoreBase`, `fetchFolders`, `fetchEntries`, `purgeTrash` (+ `FetchEntriesOpts`); `hooks.ts`: `useKnowledgeTrash`.
- **Dead skill-body model** (pairs with deleted `body-render.tsx`) — `src/features/skills/skill-body.ts`: `KbRef`, `ConnectorRef`, `ParagraphBlock`, `SectionBlock`, `SkillBlock`, `TextInline`, `Inline`.
- **Legacy seed types** — `src/features/knowledge/server/seed-fixtures-data.ts`: `LegacyKnowledgeEntryType`, `LegacyKnowledgeEntry` (+ the stale `published_clusters` comment).
- **Unused design-system re-exports** — `src/shared/design/index.ts`: `PlatformIcon`, `surfaceVariants`, `pillVariants`, `glowTextVariants`, `BackgroundGrid`.
- **Unused auth helpers** — `src/shared/auth/with-auth.ts`: `withSubscriptionAuth`, `withAdminAuth`; `mcp-oauth.ts`: `MCP_SCOPES`, `ACCESS_TTL_S`, `verifyPkceS256`.
- Plus assorted unused `*Schema`/`*Input` types across `knowledge/schema.ts`, `skills/schema.ts`, `teams/schema.ts`. Full list: rerun `npx knip`.

---

## Tier 6 — Standalone scripts 🔴 (decision needed — `scripts/`)

knip flags these as unimported, but they're **manually-run dev/seed/smoke tools**, not app code. Confirm none are still part of a runbook before deleting:
`backfill-title-summary.ts` · `seed-knowledge-bases.ts` · `seed-rokid-pack.ts` · `verify-rokid-pack.ts` · `test-pack-sync.ts` · `test-pipeline.ts` · `test-rls.ts` · `upgrade-samuel-to-pro.ts` · `smoke-knowledge-*.ts` (4). Also `vitest.server-only-shim.ts` (likely loaded by vitest config — keep unless confirmed otherwise).

---

## Tier 7 — Code fixes, not deletions 🟡

- `src/app/settings/page.tsx:60` — links to `/settings/integrations`, a route that **does not exist**. Remove the link/row.
- Stale `published_clusters` comment in `seed-fixtures-data.ts` (see Tier 5).

---

## Rejected candidates — DO NOT delete (recorded to prevent re-flagging)

- **Knowledge `entries` routes / repository / service / DTO.** An earlier scan mislabeled ~660 LOC here as dead. **False.** The 2026-06-08 migration dropped the old setups table `entries` (singular) — **not** `knowledge_entries`, which is live and core (`src/shared/supabase/types.ts`, chat tools, workflows, search, realtime, and the active KB pages `knowledge/[kbSlug]/page.tsx`, `knowledge-base-view.tsx`, `knowledge-base-panel.tsx`, `knowledge-base-switcher.tsx`). Deleting breaks knowledge bases.
- `packages/dopl-client`, `packages/mcp-server` — live, used by `/api/mcp`.
- `uuid`, `remark-gfm`, `@types/uuid`, `supabase/types.ts` — knip false positives, all live.
- Canvas legacy panel types (`knowledge`, `skills`) — kept for backward-compat with saved canvas state.

---

## Already tracked elsewhere
`docs/REFACTOR-FINDINGS.md` owns related items — **F-016** (legacy slug fallback, delete when `legacy_slug_redirect` hits zero), **F-020** (inert `workspace_resource_access` table, drop after teams model stable). Not duplicated here.

---

## Suggested execution order (later pass)
1. Tier 4 worktrees (instant 167 MB, zero code risk) + `.gitignore` updates.
2. Tier 3 assets.
3. Tier 1 files + Tier 2 deps together (delete AI subgraph → then drop `openai`); run `npm run typecheck` + `npm run build`.
4. Tier 7 link fix.
5. Tier 5 surgical export removals (verify each; rerun `npx knip` to confirm).
6. Tier 6 scripts — only after confirming with the team.
