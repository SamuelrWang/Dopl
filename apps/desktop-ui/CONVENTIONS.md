# apps/desktop-ui — conventions

The Dopl desktop renderer: a Vite + React 19 + TypeScript SPA, bundled inside
the Electron app (Phase 2 of
[docs/DESKTOP-MIGRATION-PLAN.md](../../docs/DESKTOP-MIGRATION-PLAN.md)).

This file is the **local** rulebook. The repo-wide ones still apply and win on
anything not listed here: [docs/ENGINEERING.md](../../docs/ENGINEERING.md)
(500-line cap, kebab-case files, naming, comments-only-for-why) and
[docs/DESIGN-SYSTEM.md](../../docs/DESIGN-SYSTEM.md) (the type ramp, the color
tokens, the kit classes).

## File layout

```
apps/desktop-ui/
├── index.html            # the shell; the production CSP is injected at build
├── vite.config.ts        # build + dev server + vitest + the CSP plugin
├── postcss.config.mjs    # @tailwindcss/postcss — same as the web app
└── src/
    ├── main.tsx          # createRoot; imports the one global stylesheet
    ├── app.tsx           # QueryClientProvider + hash RouterProvider
    ├── routes.tsx        # THE route table (see below)
    ├── components/       # cross-page components (layout, page states)
    ├── hooks/            # generic hooks (use-api-query)
    ├── lib/              # api, api-transport, dopl-bridge, query-client
    ├── pages/            # ONE FOLDER per page: pages/<name>/index.tsx + siblings
    ├── features/         # tests mirroring src/features/<name>/ (see below)
    └── styles/           # tokens.css, kit.css, index.css
```

**A page is a FOLDER, and its parts are colocated beside it.** `pages/<name>/index.tsx`
is the route entry; everything only that page uses sits next to it as a sibling,
and the colocated test is `index.test.tsx`. **Measured 2026-08-23: 14 of 14 pages
follow this and there is not one loose `pages/*.tsx` file**; 13 of the 14 carry
colocated siblings (`agent-window` is the lone single-file page). Re-run, never
quote:

```
ls -d apps/desktop-ui/src/pages/*/ | wc -l
ls apps/desktop-ui/src/pages/*.tsx 2>/dev/null | wc -l   # must stay 0
```

⚠ **This paragraph used to say `src/pages/<name>-page.tsx` plus a per-page
`src/features/<name>/`, and neither half has ever described this tree** (corrected
2026-08-23). The `-page.tsx` suffix appears nowhere, and **`apps/desktop-ui/src/features/`
holds only TESTS** — two of them, mirroring the web feature modules they exercise.
Real feature code is not re-homed here at all: it is imported from the web tree
through the `@/…` alias (see *Sharing code with the web app* below), which is the
whole reason the port playbook's reuse-by-import instruction works.

Nothing goes in a top-level `utils/` or `components/` dump — if it is used by one
page it lives in that page's folder; if it is genuinely cross-page it goes in
`src/components/`.

Tests are colocated (`foo.tsx` → `foo.test.tsx`), Vitest + jsdom +
`@testing-library/react`. `npm test` runs them.

## The one way to fetch data

**Reads:** `useApiQuery` (`src/hooks/use-api-query.ts`).

```tsx
const { data, isPending, error, refetch } = useApiQuery<Skill[]>("/api/skills", {
  workspaceId,
});
```

**Writes:** `useApiMutation` (`@/shared/hooks/use-api-mutation`) — the write half
of the same layer, transport-injected the same way. Do NOT hand-roll
`useMutation` + `apiRequest` + `invalidateQueries`, and never
`await write(); await refetch()`: that shape is the launch blocker this hook
exists to close (ENGINEERING.md §7 "Writes").

```tsx
const create = useApiMutation<NewSkill, { skill: Skill }>({
  request: (draft) => ({ path: "/api/skills", body: draft, workspaceId }),
  optimistic: (draft) =>
    patchCache<{ skills: Skill[] }>(apiPathKey("/api/skills"), (cache) =>
      cache ? { skills: [...cache.skills, pendingSkill(draft)] } : cache
    ),
  reconcile: (data) => /* fold the POST's own answer in — never refetch it */,
});
create.mutate(draft); // `create.pending` is the busy flag
```

The query key is `[path, workspaceId, query]` — build it with
`apiQueryKey` / `apiPathKey` (`@/shared/api/query-keys`), never as an array
literal. Same args anywhere = one cache entry and one in-flight request.
A write patches by the one-element PREFIX key, which reaches every workspace /
query-param variant a reader may have mounted.

Under `apiRequest` sits `src/lib/api-transport.ts`, which picks the transport:
`window.dopl.apiRequest` (IPC → main process → HTTPS) inside Electron, plain
`fetch` in a browser. Nothing above the transport knows which one ran.

**`router.refresh()` has no equivalent here.** Every web call site of it exists
to re-pull RSC props; when porting, replace it with a targeted
`invalidateQueries`.

## The one way to add a route

Add a row to `WORKSPACE_PAGES` in `src/routes.tsx`. That is the whole change:
the router and the layout's nav both read that table.

```ts
{ path: "skills/:skillSlug", label: "Skill", element: <SkillPage /> },
```

Omit `element` and the row renders the shared placeholder. Rows whose path
contains a `:param` are skipped by the nav.

The router is a **hash** router (`#/acme-ab12/skills`), not a browser router.
The packaged renderer is a `file://` document where `history.pushState` to a
non-existent path is a security error and a reload 404s. Both dev and production
run the same router so a URL works in either.

## Loading and error conventions

- `isPending` → `<PageLoading />`; `error` → `<PageError error onRetry />`
  (`src/components/page-states.tsx`). No per-feature spinner, no per-feature
  error copy.
- Route-level throws land in `RouteErrorBoundary` via the route's
  `errorElement`.
- `apiRequest` throws `ApiError` (with `status`, `code`, `details`) for a
  non-2xx answer, and a plain `Error` when the request never completed. The
  shared TanStack retry predicate keys off exactly that: 4xx never retries.
- Do not render a skeleton for a first paint that the main-process cache will
  serve instantly once Phase 2/3 lands. Quiet beats flashing.

## Design tokens

`src/styles/tokens.css` and `kit.css` are **hand-copied** from
`src/app/globals.css`, the source of truth. Every rule in
docs/DESIGN-SYSTEM.md applies unchanged: semantic `text-*` ramp, token color
utilities, kit classes (`.page-float`, `.bento`, `.concave-field`, …).

⚠ They drift silently. That is REFACTOR-FINDINGS **F-074** — the same finding
already open for `dopl-desktop-app/renderer/session/tokens.css`, which is the
*first* hand-copy of this palette. **Edit globals.css and these files in the
same change**, until one file is imported at build time by all three.

## Sharing code with the web app

Two aliases, two meanings (revised 2026-08-02 for the page ports):

- `#/…` — THIS app's own source (`apps/desktop-ui/src`).
- `@/…` — the REPO-ROOT web tree (`src/`), with the **same meaning `@/` has
  inside that tree**. A reused web module's own `@/shared/...` /
  `@/features/...` imports therefore resolve verbatim, transitively, with no
  edits — which is what makes the port playbook's reuse-by-import
  instruction executable at all (real feature components pull in dozens of
  files; per-file exact aliases cannot scale to that).

The fences that keep the open door safe:

1. **The vite build fails loudly** on any next-coupled module in the import
   graph (`next/*` doesn't resolve here). A `"use client"` directive alone
   is inert.
2. **ESLint refuses** `@/app/*` (the Next app-router tree), server layers
   (`@/features/*/server/*`, `@/shared/supabase/admin`, `@/shared/auth/*`),
   and `next` itself — see the fence block in the root `eslint.config.mjs`.
3. **Reuse targets are client modules only**: `@/features/*/components`,
   `@/features/*/hooks`, `@/features/*/client`, `@/shared/{ui,hooks,lib,api}`.
   If a module needs surgery to lose a Next import, extract its Next-free
   core in place (the web app keeps working) and import the core.

## Forbidden

- **`fetch` outside `src/lib/api-transport.ts`.** The packaged page ships
  `connect-src 'none'`; a direct call is a runtime failure and a hole in the
  "renderer never touches the network" invariant.
- **`next/*` imports.** No `next/link` (use `Link`/`NavLink` from
  `react-router`), no `next/navigation` (`useNavigate`, `useParams`,
  `useSearchParams`), no `next/image`, no `next/font`.
- **Hardcoded design values.** No hex colors, no raw px font sizes, no
  hand-rolled shadow/border recipes. Token classes only; if a recipe is missing,
  add it to globals.css + DESIGN-SYSTEM.md first, then mirror it here.
- **Reaching around `window.dopl`.** Do not add members to the bridge from the
  renderer side, and never expect a token from it — `getAuthState()` returns
  `{ signedIn, userId }` by contract.
- **Server-side imports.** Anything under `src/features/*/server/**`,
  `src/shared/auth/**`, or importing `server-only` stays on the server.
- **A second global stylesheet.** `src/styles/index.css` is the only one;
  per-page layout goes in CSS modules.
