/**
 * `/:workspaceSegment/ontology/:clusterSlug` — IS the index component,
 * re-exported (the only difference is `useParams()`).
 *
 * ⚠ Not cosmetic: selecting a cluster replaces the URL `ontology` →
 * `ontology/:clusterSlug`, and React carries the mounted tree across that route
 * change only when both rows render the SAME component type. Cloning this file
 * remounts the ontology store on the first tab click and drops its pending
 * debounced writes.
 */
export { default } from "./index";
