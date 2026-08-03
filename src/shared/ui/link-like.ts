import type { ComponentType, ReactNode } from "react";

/**
 * The link contract a Next-free component core accepts instead of importing
 * `next/link` itself.
 *
 * Both apps render the same hrefs (`/{workspaceSegment}/{section}`); only the
 * router differs. The web app passes `next/link`'s `Link`; the desktop
 * renderer passes a `react-router` adapter
 * (`apps/desktop-ui/src/components/app-shell/router-link.tsx`). Injecting the
 * component is what lets one implementation serve both — see
 * apps/desktop-ui/CONVENTIONS.md § Sharing code with the web app.
 */
export interface LinkLikeProps {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}

export type LinkLike = ComponentType<LinkLikeProps>;
