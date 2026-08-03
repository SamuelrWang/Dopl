import { ConfigurationView } from "@/features/configuration/components/configuration-view";

/**
 * /:workspaceSegment/configuration — the team agent setup guide. Port of
 * `src/app/[workspaceSlug]/(app)/configuration/page.tsx`
 * (docs/migration-research/web-pages.md §15).
 *
 * The RSC resolved the workspace only for auth + canonical routing and then
 * rendered `<ConfigurationView />` with no props. In the SPA the shell already
 * resolves (and canonicalises) the segment for every child route, so this file
 * is the route entry and nothing else.
 *
 * `ConfigurationView` and its whole tree are REUSED verbatim: the feature is
 * entirely mock-driven today (`@/features/configuration/mock-data`), makes no
 * request, and imports nothing from `next/*`.
 */
export default function ConfigurationPage() {
  return <ConfigurationView />;
}
