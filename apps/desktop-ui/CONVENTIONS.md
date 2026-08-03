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
    ├── pages/            # one folder or file per ported page
    ├── features/         # feature modules, mirroring src/features/<name>/
    └── styles/           # tokens.css, kit.css, index.css
```

Ported pages keep the web app's module boundaries: a feature's components,
hooks and types live under `src/features/<name>/`, and `src/pages/<name>-page.tsx`
is the thin route entry that composes them. Nothing goes in a top-level `utils/`
or `components/` dump — if it is used by one feature it lives in that feature.

Tests are colocated (`foo.tsx` → `foo.test.tsx`), Vitest + jsdom +
`@testing-library/react`. `npm test` runs them.

## The one way to fetch data

**Reads:** `useApiQuery` (`src/hooks/use-api-query.ts`).

```tsx
const { data, isPending, error, refetch } = useApiQuery<Skill[]>("/api/skills", {
  workspaceId,
});
```

**Writes:** `useMutation` + `apiRequest` + `invalidateQueries` on the read's key.

```tsx
const qc = useQueryClient();
useMutation({
  mutationFn: (body: NewSkill) =>
    apiRequest<Skill>("/api/skills", { method: "POST", body, workspaceId }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/skills"] }),
});
```

The query key is `[path, workspaceId, query]`. Same args anywhere = one cache
entry and one in-flight request.

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

Exactly one import crosses from `src/` (the Next app) into this renderer:

```ts
import { QUERY_DEFAULT_OPTIONS } from "@web/query-defaults";
```

It is an **exact-match** alias onto `src/shared/api/query-defaults.ts`, not a
directory alias, so nothing else can slip through. To share another module it
must be (a) framework-free — no `"use client"`, no React, no Next, no DOM — and
(b) added as its own exact alias in `vite.config.ts` *and* `tsconfig.json`. If
it is not framework-free, port it instead.

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
