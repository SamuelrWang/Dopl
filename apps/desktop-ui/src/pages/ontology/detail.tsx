/**
 * `/:workspaceSegment/ontology/:clusterSlug` — the port of
 * `src/app/[workspaceSlug]/(app)/ontology/[clusterSlug]/page.tsx`.
 *
 * The web app has two RSC files because Next needs one per route directory, but
 * they render the same `OntologyView` and differ only in passing
 * `initialClusterSlug`. In the SPA that difference is `useParams()` — so this
 * route IS the index component, re-exported.
 *
 * Not cosmetic: selecting a cluster replaces the URL from `ontology` to
 * `ontology/:clusterSlug`, and React only carries the mounted tree across that
 * route change when both rows render the same component type. Cloning this file
 * would remount the ontology store on the first tab click and drop its pending
 * debounced writes.
 */
export { default } from "./index";
