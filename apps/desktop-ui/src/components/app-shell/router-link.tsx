import { Link } from "react-router";
import type { LinkLikeProps } from "@/shared/ui/link-like";

/**
 * SPA `LinkLike` binding. The web tree's cores take their link component as a
 * prop (`@/shared/ui/link-like`) so one markup runs on `next/link` and on the
 * SPA router. `href` and `to` carry identical `/{workspaceSegment}/{section}`
 * strings; the hash router puts them after the `#`.
 */
export function RouterLink({ href, children, ...rest }: LinkLikeProps) {
  return (
    <Link to={href} {...rest}>
      {children}
    </Link>
  );
}
