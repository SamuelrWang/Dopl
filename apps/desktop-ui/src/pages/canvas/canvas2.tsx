import { Navigate, useLocation, useParams } from "react-router";

/**
 * `/:workspaceSegment/canvas2` — the port of
 * `src/app/[workspaceSlug]/(app)/canvas2/page.tsx`
 * (docs/migration-research/web-pages.md §6), which is a permanent redirect to
 * `/{slug}/canvas` forwarding the query string.
 *
 * It earns a route rather than dying: the graph view was promoted from
 * `canvas2` to `canvas`, and the old path is still typed by muscle memory and
 * still emitted by agents and stored links. It is a variant of nothing — there
 * is no second implementation to keep alive — so this is four lines of routing,
 * not a fork. Web `redirect()` → `<Navigate replace>`: the alias leaves no
 * history entry, same as the 308.
 *
 * The search string is forwarded for the same reason the RSC forwards it — a
 * Stripe return lands on `?billing=success`, and the app shell is what reads
 * it. Nothing in the SPA shell reads it TODAY (the settings modal is the
 * settings slice's), so this preserves the input for when it does rather than
 * dropping it here and needing it re-added there.
 */
export default function Canvas2AliasPage() {
  const { workspaceSegment = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/${workspaceSegment}/canvas${search}`} replace />;
}
