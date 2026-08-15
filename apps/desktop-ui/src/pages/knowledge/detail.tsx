/**
 * `/:workspaceSegment/knowledge/:kbSlug`.
 *
 * ⚠ Deliberately the SAME component as the index route, re-exported: one
 * component TYPE across both route rows is what stops react-router remounting
 * the two-pane view when the controller writes a base into the address bar.
 * See `./use-knowledge-url-sync.ts`.
 */
export { default } from "./index";
