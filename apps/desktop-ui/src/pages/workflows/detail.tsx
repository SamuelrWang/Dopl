/**
 * `/:workspaceSegment/workflows/:workflowSlug` — the port of
 * `src/app/[workspaceSlug]/(app)/workflows/[workflowSlug]/page.tsx`.
 *
 * The web app has two RSC files because Next needs one per route directory,
 * but they render the same `WorkflowsView` and differ only in passing
 * `initialWorkflowSlug`. In the SPA that difference is `useParams()` — so this
 * route IS the index component, re-exported.
 *
 * Not a cosmetic choice: the slug sync navigates from `workflows` to
 * `workflows/:workflowSlug` the moment the list lands, and React only carries
 * the mounted tree across that route change when both rows render the same
 * component type. Cloning this file would remount the graph on first paint.
 */
export { default } from "./index";
