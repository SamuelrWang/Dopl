import { Link } from "react-router";
import type { LinkLikeProps } from "@/shared/ui/link-like";

/**
 * The SPA's `LinkLike` binding: the web tree's shell/page cores take their link
 * component as a prop (`@/shared/ui/link-like`) so the same markup can run on
 * `next/link` in the web app and on the SPA router here. `href` and `to` carry
 * identical strings — `/{workspaceSegment}/{section}` — and the hash router
 * puts them after the `#`.
 */
export function RouterLink({ href, children, ...rest }: LinkLikeProps) {
  return (
    <Link to={href} {...rest}>
      {children}
    </Link>
  );
}
