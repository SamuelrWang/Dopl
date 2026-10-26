# Ontology staging → desktop porting map

`/ontology` (public alias `/playground/ontology`) renders the desktop **/home → Ontology** face
inside the landing demo window (`src/features/ui-staging/staging-frame.tsx`), on fake data.

The page mounts the PRODUCT face directly:
`src/features/ontology/components/home-ontology-panels.tsx › HomeOntologyPanels` (the same
component `apps/desktop-ui/src/pages/home/home-panes.tsx` mounts), and through it the board, the
object panel, the share and delete dialogs and the changelog. A change there changes the desktop,
the workspace ontology route and this page in one edit. There are no staging copies of product
components; design work happens in the product files.

## How the data reaches the product

The page installs `store/staging-server.ts` as `window.dopl` (the SPA bridge,
`shared/lib/spa-bridge.ts`) for its mount, so every product hook's `apiRequest` lands in an
in-memory server instead of the network, under a private `QueryClient`. The bridge has no sync
pair, so realtime is off. Each scenario is a fresh server and a fresh cache.

| Staging file | Replaces |
|---|---|
| `store/staging-server.ts` | the routes the face calls: `GET /api/ontology`, ontology and object create / patch / delete, shares, object and ontology revisions + restore, knowledge bases / entries, skills, `GET /api/billing/status` |
| `store/revision-diff-recorder.ts` | `ontology/server/service-revisions.ts` (server-only): files a revision row per changed field on every write |
| `data/demo-ontology-data.ts`, `data/demo-revisions.ts` | fake data (four ontologies, shares, home channels, knowledge, seed changelog) |
| `staging-ontology-page.tsx`, `staging-scenario-panel.tsx` | page root + the "States" switcher |

## Scenarios

`board`, `empty` (no ontologies), `not-onboarded` (no home space), `pane-loading` (the snapshot
never answers), `list-error` (the snapshot fails), `board-loading` (the board skeleton, mounted
directly), `cap-near` / `cap-over` (the object cap from `/api/billing/status`).

## Frame

The white record pane is `ui-staging/staging.css › .uis-white-pane` (shared with the knowledge
playground), the frame's twin of
`apps/desktop-ui/src/pages/home/home.module.css › .page[data-face="ontology"] .pane`.
