"use client";

import type { ReactNode } from "react";
import { CrystalField } from "./crystal-field";

/** Mark the single non-tiled panel on a page with this attribute; the field
 *  skips excitation under it. Everything else tiles + animates. */
export const CRYSTAL_PANEL_ATTR = "data-crystal-panel";
const CRYSTAL_PANEL_SELECTOR = `[${CRYSTAL_PANEL_ATTR}]`;

/**
 * Full-screen dark overlay shell: a crystal-cave tile field behind a single
 * centered panel. Shared by the auth-adjacent surfaces (onboarding, login,
 * OAuth consent). Children are centered; mark the page's card with
 * `{...{ [CRYSTAL_PANEL_ATTR]: true }}` so only it stays non-tiled.
 */
export function CrystalShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-[#060A11] text-[#E4EAF1]"
      style={{ fontFamily: "var(--font-app), system-ui, sans-serif" }}
    >
      <CrystalField occludeSelector={CRYSTAL_PANEL_SELECTOR} />
      <div className="absolute inset-0 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-6 py-12">{children}</div>
      </div>
    </div>
  );
}
