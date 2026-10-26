# /knowledge staging → desktop porting map

`/knowledge` (public alias `/playground/knowledge`) stages **desktop /home → Knowledge**: the face
the shipping desktop shows, rendered inside the landing demo's window
(`src/features/ui-staging/staging-frame.tsx`), on in-memory data.

The workspace route `/:workspaceSegment/knowledge` (`apps/desktop-ui/src/pages/knowledge/index.tsx`)
is not staged as its own page; it mounts the same shared core (`KnowledgeV2PreviewCore`) as the
Home pane's opened base.

## The page mounts the PRODUCT components

Everything under the face is the product's: `src/features/knowledge/components/**` (the opened
base, the tree, the document, the settings popup, the create and move dialogs),
`src/features/revisions/components/**` (the changelog) and their hooks. A change there changes the
web app and the desktop. The staging redesign was ported into them on `ui/port-knowledge`
(`docs/specs/knowledge-port/INVENTORY.md`).

Their requests are answered in memory: `fetch-shim.ts › installKnowledgeFetch` answers every
same-origin `/api/**` request from `server/routes.ts` while the page is mounted. A route staging
does not serve answers 404 in the API's error envelope.

## Hosts (desktop-local, copied because the Next tree cannot import `apps/`)

| Staging file | Desktop source | Notes |
|---|---|---|
| `home/knowledge-panels.tsx` | `pages/home/knowledge-panels.tsx` | Only change: `Channel` is `StagingChannel` (`data.ts`). |
| `home/knowledge-panel-cards.tsx` | `pages/home/knowledge-panel-cards.tsx` | Verbatim. |
| `home/knowledge-base-view.tsx` | `pages/home/knowledge-base-view.tsx` | Verbatim. |
| `home/home.module.css` | `pages/home/home.module.css` | Trimmed to `.kbCards` / `.kbCell`. |
| `home/home-skeleton.tsx` | `pages/home/home-skeleton.tsx` | Trimmed to `HomeKnowledgePanelsSkeleton`. |
| `desktop/components/skeletons/knowledge-skeletons.tsx` | `components/skeletons/knowledge-skeletons.tsx` | Verbatim. |
| `desktop/components/skeletons/section-panel-ghost.tsx` | `components/skeletons/section-panel-ghost.tsx` | Trimmed to `SectionPanelGhost`. |
| `desktop/components/skeletons/skeleton-surface.tsx` | `components/skeletons/skeleton-surface.tsx` | Verbatim (a re-export). |

`#/` imports in the copies point at the staging copies (`PageError` at `@/shared/ui/page-error`,
which the SPA's `page-states.tsx` re-exports); every other import is the product's.

## Stand-ins (never ported)

| Staging file | Stands in for |
|---|---|
| `fetch-shim.ts` | the network (`shared/api/api-client.ts › apiRequest`'s fetch branch, and the export download) |
| `server/routes.ts` | the route table: knowledge bases, folders, entries, star, channel grants, tree, search, export, entry and base revisions, restore, workspace teams, my-access, channel members |
| `server/bases.ts`, `server/entries.ts`, `server/extras.ts`, `server/people.ts`, `server/http.ts` | the route handlers, over the DB |
| `data.ts` / `data-bodies.ts` / `fake-store.ts` | the database. Reset on every page mount. |
| `knowledge-staging-page.tsx` | `pages/home/home-panes.tsx › HomePane`'s Knowledge branch (props from boot) |
| `ui-staging/staging-scenario-switch.tsx` (shared) | nothing: the floating "States" pill (channel / role / home space); identities uses it too |

What the shim does not stand in for: the product face's realtime subscription
(`knowledge/client/realtime.ts`) and the signed-in profile read under presence
(`shared/auth/use-current-profile.ts`). Signed out, the profile is null, so the doc pane shows no
peers, and the realtime channel carries nothing for the staged workspace ids.

On this page the record pane is white (`ui-staging/staging.css › .uis-white-pane`, shared with the
ontology face), the twin of the desktop's `home.module.css › .page[data-face="knowledge"] .pane`.
