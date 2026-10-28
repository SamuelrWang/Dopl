import type { Metadata } from "next";

/** Every portal page's metadata. No nested layout: each page wraps itself in `PortalShell`. */
export const PORTAL_METADATA: Metadata = {
  title: "Developers (demo) — Dopl",
  robots: { index: false, follow: false },
};
