# Tracked debt

Known debt items from the May 2026 deep audit that deserve their own focused PR.
Each is acknowledged: the problem is real and only the dedicated work is missing.
Re-verified against the tree 2026-10-02; items that no longer applied (S-4, #19,
#20, #33) were removed.

When you take one on: cite the audit id in the commit title and delete its section
in the same change. Newer debt goes in docs/REFACTOR-FINDINGS.md (`F-NNN`).

---

## S-7 — Consolidate the slug generators

**Why:** two kebab pipelines exist:

- `src/shared/lib/slug/slugify.ts › slugify` — generic; its output matches `^[a-z0-9-]+$`.
- `src/features/workspaces/slug.ts › slugifyWorkspaceName` — workspaces (NFKC-normalized, 60-char cap, fallback `workspace`).

Two regex shapes are in use: the generator's documented `^[a-z0-9-]+$` and the
validators' `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` (`src/features/knowledge/schema.ts`,
`src/features/skills/schema.ts`, `src/features/workspaces/schema.ts`).

**Shape:** one primitive `slugifyBase(name, opts: { fallback, maxLength, reservedSet, suffixStrategy })`
in `src/shared/lib/slug/slugify.ts`; per-resource modules pass options. One regex,
one length cap, one test surface.

---

## S-17 — Wire the `Database` generic through `supabaseAdmin()`

**Why:** `src/shared/supabase/admin.ts › supabaseAdmin` returns a bare
`SupabaseClient` (no `Database` generic), so `db.from(...)` / `db.rpc(...)` are
untyped despite the generated `src/shared/supabase/types.ts`, and call sites cast
by hand (e.g. the `RpcRow` interface in `src/features/knowledge/server/search.ts`).

**Shape:** `supabaseAdmin()` and `createServerSupabaseClient()` return
`SupabaseClient<Database>`; drop the hand-written row interfaces and casts.

**Blast radius:** every `supabaseAdmin()` call site under `src/` (re-derive:
`git grep -c "supabaseAdmin()" -- src`). Do not bundle with anything else.
