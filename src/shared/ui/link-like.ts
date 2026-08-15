import type { ComponentType, ReactNode } from "react";

/**
 * Link contract a Next-free component core takes instead of importing
 * `next/link`. Same hrefs (`/{workspaceSegment}/{section}`), different routers:
 * web passes `next/link`'s `Link`, desktop passes a react-router adapter
 * (`apps/desktop-ui/src/components/app-shell/router-link.tsx`). Injection is
 * what lets one implementation serve both — see apps/desktop-ui/CONVENTIONS.md
 * § Sharing code with the web app.
 */
export interface LinkLikeProps {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}

export type LinkLike = ComponentType<LinkLikeProps>;
