# /knowledge staging → desktop porting map

`/knowledge` (public alias `/playground/knowledge`) stages **desktop /home → Knowledge** inside the
landing demo's window (`src/features/ui-staging/staging-frame.tsx`), on in-memory data.

## The page mounts the PRODUCT face

`src/features/knowledge/components/home/home-knowledge-panels.tsx › HomeKnowledgePanels` is the
face the desktop's `pages/home/home-panes.tsx` mounts too, with everything under it: the opened
base, tree, document, settings popup and dialogs (`knowledge/components/**`), the changelog
(`revisions/components/**`), the face's skeletons (`knowledge/components/knowledge-skeletons.tsx`)
and their hooks. A change there changes the desktop, the web app and this page. Nothing here is a
copy.

Its requests are answered in memory through the SPA bridge seam: `staging-bridge.ts ›
useStagingBridge` installs `window.dopl` (`apiRequest` → `server/routes.ts`) in an effect, on a
fresh seed, and restores what was there on unmount; the page renders the face's skeleton until it
is in. As in the desktop renderer, the bridge has no sync pair, so realtime is off, and presence
stays local. The export download is a plain `fetch`, not `apiRequest`, so on this page it gets the
real route's refusal.

## Stand-ins (never ported)

| Staging file | Stands in for |
|---|---|
| `staging-bridge.ts` | the desktop's `window.dopl` bridge (`apiRequest`, auth state) |
| `server/routes.ts` | the route table: knowledge bases, folders, entries, star, channel grants, tree, search, entry and base revisions, restore, workspace teams, my-access, channel members |
| `server/bases.ts`, `server/entries.ts`, `server/extras.ts`, `server/people.ts`, `server/http.ts` | the route handlers, over the DB |
| `data.ts` / `data-bodies.ts` / `fake-store.ts` | the database. Reset on every mount. |
| `knowledge-staging-page.tsx` | `pages/home/home-panes.tsx › HomePane`'s Knowledge branch (props from boot) |
| `ui-staging/staging-scenario-switch.tsx` (shared) | nothing: the floating "States" pill (channel / role / home space); identities uses it too |

The record pane is white through the product frame's own rule
(`home/components/shell/home.module.css › .page[data-face="knowledge"] .pane`).
