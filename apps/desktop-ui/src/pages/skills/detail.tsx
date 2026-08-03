import { Navigate, useParams } from "react-router";

/**
 * `/:workspaceSegment/skills/:skillSlug` — the port of
 * `src/app/[workspaceSlug]/(app)/skills/[skillSlug]/page.tsx`, which is a pure
 * redirect to the index (`redirect(`/${workspaceSlug}/skills`)`).
 *
 * The skill editor renders inline on the index; this route exists only so old
 * bookmarks and agent-rendered links land somewhere instead of 404ing. Web
 * `redirect()` → `<Navigate replace>`: same "don't leave this in history"
 * semantics, and `replace` is what keeps Back from bouncing between the two.
 *
 * The web redirect drops `skillSlug` on the floor (selection is component
 * state, never URL state — docs/migration-research/web-pages.md §10), so this
 * does too. Deep-linking to a specific skill would be new behaviour, not a
 * port.
 */
export default function SkillDetailRedirect() {
  const { workspaceSegment = "" } = useParams();
  return <Navigate to={`/${workspaceSegment}/skills`} replace />;
}
