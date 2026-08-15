import { Navigate, useParams } from "react-router";

/**
 * `/:workspaceSegment/skills/:skillSlug` — pure redirect to the index. Editor
 * renders inline there; this route exists so old bookmarks and agent-rendered
 * links land somewhere instead of 404ing.
 *
 * ⚠ `replace` is what keeps Back from bouncing between the two routes.
 * `skillSlug` is dropped: skill selection is component state, never URL state.
 */
export default function SkillDetailRedirect() {
  const { workspaceSegment = "" } = useParams();
  return <Navigate to={`/${workspaceSegment}/skills`} replace />;
}
