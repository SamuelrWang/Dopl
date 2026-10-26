"use client";

/**
 * STAGING COPY of `marketing/components/banner-demo/demo-home-chrome.tsx › DemoAccountRail`.
 *
 * Copied, not imported, because the demo's rail is decorative: every tile is a `<span>`. Here the
 * dashed "+" create tile is a real `<button>` (desktop `account-rail.tsx`'s create tile, same
 * `aria-label`) that opens the New workspace popup through the frame's popup provider. Markup and
 * class names are otherwise identical (`marketing.css › .lp-demo-rail*`).
 */

import { Plus } from "lucide-react";
import { WorkspaceGlyph } from "@/shared/layout/app-shell/workspace-switcher-core";

export function StagingAccountRail({ onCreate }: { onCreate: () => void }) {
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
        {DEMO_WORKSPACES.map((ws) => (
          <span key={ws.name} className="lp-demo-rail-tile">
            <WorkspaceGlyph name={ws.name} iconUrl={ws.iconUrl} size="md" />
          </span>
        ))}
      </div>
      {/* STAGING: a button (the demo's is a span). */}
      <button
        type="button"
        className="lp-demo-rail-tile uis-rail-create"
        title="New workspace"
        aria-label="New workspace"
        onClick={onCreate}
      >
        <Plus size={18} strokeWidth={1.8} />
      </button>
    </nav>
  );
}

/** Verbatim from the demo: every tile has an icon. */
const DEMO_WORKSPACES = [
  { name: "Northwind", iconUrl: "/img/dev-clouds.jpg" },
  { name: "Vermillion", iconUrl: "/img/framework-banner.jpg" },
  { name: "Lattice", iconUrl: "/img/site_thumbnail.jpg" },
] as const;
