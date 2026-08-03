/**
 * `/:workspaceSegment/knowledge/:kbSlug` — the port of
 * `src/app/[workspaceSlug]/(app)/knowledge/[kbSlug]/page.tsx`.
 *
 * Deliberately the SAME component as the index route, re-exported rather than
 * re-implemented. The two web pages differ only in the props their server
 * halves resolve, and `./index.tsx` resolves both cases from the URL. Sharing
 * one component TYPE across the two route rows is also what stops react-router
 * from remounting the two-pane view when the controller writes a base into the
 * address bar — see the note in `./use-knowledge-url-sync.ts`.
 */
export { default } from "./index";
