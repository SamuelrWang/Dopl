# Tracked debt

This file lists known debt items from the May 2026 deep audit that
deserve their own focused PR rather than being rolled into a batch.
Each entry is closed-as-acknowledged: the bug is real, the fix is
agreed, the only thing missing is the dedicated work.

When you take one of these on:
1. Cite the audit ID in the PR title (e.g. `feat(workspaces): globally-unique slugs (audit S-4)`).
2. Delete its row from this file in the same PR.
3. Update [`docs/ENGINEERING.md`](ENGINEERING.md) §2 if the change
   removes a known oversized file.

---

## S-4 — Globally-unique workspace slugs

**Why:** Slugs are unique on `(owner_id, slug)`. Two users can each
own a workspace called `default`. URL routing is per-member: if user B
is invited to user A's `alpha` workspace and B already owns `alpha`, B's
`/alpha` always resolves to their own (owner-scoped lookup wins). The
shared workspace becomes unreachable by URL.

**Shape:**

- Migration: backfill a 4-char base36 random suffix on every workspace
  whose `(slug)` is duplicated across owners (mirror `published-slug.ts`).
  Singletons keep their pretty slug; collisions become `alpha-a9f3`.
- Add `WHERE deleted_at IS NULL` partial unique on `(slug)` globally,
  alongside the existing per-owner constraint.
- `slugifyWorkspaceName` always appends a suffix on collision against
  the **global** taken set instead of just the owner's.
- `findMemberWorkspaceBySlug` no longer falls back to "first non-owned
  match" — direct lookup is now unambiguous.
- 308-redirect from old `(owner, slug)` URLs to the new globally-unique
  form for ~30 days, by recording the previous slug in a small
  `workspace_slug_aliases` table.

**Blast radius:** every workspace URL in the wild gets a redirect.
Bookmarks, shared links, MCP `--workspace-id` flags continue to work
since they use UUIDs.

**Estimated:** 1 PR, ~3 hours of careful work + manual QA on shared
workspace flows.

---

## S-7 — Consolidate the three slug generators

**Why:** Three near-identical kebab pipelines exist:

- [`src/shared/lib/slug/slugify.ts`](../src/shared/lib/slug/slugify.ts) — generic, used by entries / KBs / clusters
- [`src/features/workspaces/slug.ts`](../src/features/workspaces/slug.ts) — workspaces, with reserved-set check
- [`src/features/workspaces/server/canvases.ts`](../src/features/workspaces/server/canvases.ts) `slugifyCanvasName` — duplicate of the workspace shape with a different reserved set

Plus two regex shapes used downstream (`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`
in knowledge `schema.ts`, `^[a-z0-9-]+$` everywhere else). Drift waiting
to happen.

**Shape:** Collapse to one primitive
`slugifyBase(name, opts: { fallback, maxLength, reservedSet, suffixStrategy })`
in `src/shared/lib/slug/slugify.ts`. Per-resource modules pass options.
Single regex, single length cap, single test surface.

**Estimated:** 1 PR, ~1 hour.

---

## S-17 — Wire `Database` generic through `supabaseAdmin()`

**Why:** [`src/shared/supabase/admin.ts`](../src/shared/supabase/admin.ts)
returns a bare `SupabaseClient` (no `Database` generic), so every
`db.from(...)` and `db.rpc(...)` falls back to `unknown` typing despite
the regenerated `src/shared/supabase/types.ts` having the full schema.
Manual `as` casts at every call site.

**Shape:**

- `supabaseAdmin()` returns `SupabaseClient<Database>`.
- `createServerSupabaseClient()` likewise.
- Drop the manual `RpcRow` interface in
  [`src/features/knowledge/server/search.ts`](../src/features/knowledge/server/search.ts).
- Remove the `as any` / `as never` casts that crept in around RPC calls.

**Blast radius:** **240 call sites** of `supabaseAdmin()` across `src/`.
Every one needs to typecheck under the generic. Most will be fine
(types match); a handful with implicit-any will surface and need a typed
helper.

**Estimated:** 1 PR, ~3 hours, do not bundle with anything else.

---

## #19 — File-size violations

Five files >500 lines that ENGINEERING.md §2 caps. The doc table lists
them; the CI size-check exempts only `mcp-server/server.ts` and
`dopl-client/client.ts`. Each split is 30+ minutes of careful surgery.

| File | Lines | Recommended split |
|---|---|---|
| `src/features/knowledge/server/service.ts` | 967 | `bases.ts` / `folders.ts` / `entries.ts` / `path-ops.ts` / `trash.ts` / `seed.ts`, with the existing `service.ts` becoming a thin barrel |
| `src/features/knowledge/server/repository.ts` | 675 | Mirror the service split — one repo file per resource |
| `src/features/knowledge/server/seed-fixtures-data.ts` | 664 | Already qualifies for the §2 "pure data tables" exception — add the justification banner to the top of the file |
| `src/features/knowledge/components/knowledge-tree.tsx` | 642 | Extract drag-drop hook + `TreeNode` sub-component |
| `src/features/knowledge/components/knowledge-base-view.tsx` | 602 | Extract `DocPane` to its own file (already named, just lift it out) |

**Estimated:** 5 PRs, ~30 min each. They're independent and can land in
any order.

---

## #20 — `mcp-server.ts` 1990-line split

ENGINEERING.md §2 already lists this as scheduled. The precedent set by
`packages/mcp-server/src/tools/knowledge.ts` is the right shape: extract
per-domain tool registrations into `src/tools/<domain>.ts` files
(`packs.ts`, `clusters.ts`, `canvas.ts`, `ingest.ts`), keep `server.ts`
as a thin file that wires them together.

**Estimated:** 1 PR, ~2 hours, mostly mechanical but touches the agent
system prompt assembly which is large in `server.ts`.

---

## #33 — Replace `window.prompt` rename UI

[`src/features/knowledge/components/knowledge-base-view.tsx`](../src/features/knowledge/components/knowledge-base-view.tsx)
uses native `window.prompt` for the rename action. Bad UX (no schema
validation feedback, ugly modal) and means the user can type a
slash-containing title that the server then 4xx's.

**Shape:** inline-edit on the tree node — double-click puts the row
into edit mode, validates against the `noSlash` regex client-side, blurs
to commit. Needs visual review against the design system.

**Estimated:** 1 PR, ~1 hour for the implementation + manual QA.
