"use client";

/**
 * The banner demo's account rail (`account-rail.tsx`): Home pinned top and selected, workspace
 * tiles under it, create at the end. Geometry with no token (the 54px rail, the 40px tile) is in
 * `marketing.css › .lp-demo-rail*`. Decorative: every tile is a `<span>`, so nothing in the
 * `aria-hidden` slot takes focus.
 */

import { Plus } from "lucide-react";
import { WorkspaceGlyph } from "@/shared/layout/app-shell/workspace-switcher-core";

export function DemoAccountRail() {
  return (
    <nav className="lp-demo-rail" aria-label="Account">
      <span className="lp-demo-rail-tile is-active">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicons/android-chrome-512x512.png"
          alt=""
          className="lp-demo-rail-mark"
          draggable={false}
        />
      </span>
      <div className="lp-demo-rail-group">
        {/* Image tiles: `WorkspaceGlyph` initials a workspace only when it has no icon. */}
        {DEMO_WORKSPACES.map((ws) => (
          <span key={ws.name} className="lp-demo-rail-tile">
            <WorkspaceGlyph name={ws.name} iconUrl={ws.iconUrl} size="md" />
          </span>
        ))}
      </div>
      <span className="lp-demo-rail-tile">
        <Plus size={18} strokeWidth={1.8} />
      </span>
    </nav>
  );
}

const DEMO_WORKSPACES = [
  { name: "Northwind", iconUrl: "/img/dev-clouds.jpg" },
  { name: "Vermillion", iconUrl: "/img/framework-banner.jpg" },
  { name: "Lattice", iconUrl: "/img/site_thumbnail.jpg" },
] as const;
