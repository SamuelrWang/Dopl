import "@/features/marketing/marketing.css";

import type { Metadata } from "next";
import { SiteNav } from "@/features/marketing/components/site-nav";
import { PlaygroundShell } from "@/features/playground/components/playground-shell";

export const metadata: Metadata = {
  title: "Playground — Dopl",
  description: "Try out the features of Dopl.",
};

/**
 * Public demo page: marketing nav on top, a static UI-only mirror of the app
 * shell below. No data fetching, no auth — every surface inside the mirror is
 * hardcoded.
 */
export default function PlaygroundPage() {
  return (
    <div className="lp">
      {/* SiteNav reads the `--ink`/`--muted`/`--grotesk` custom properties
          declared on `.lp`, same as the home page. */}
      <SiteNav />

      {/* The app mirror renders as a rounded floating panel (its module owns
          the panel chrome), sized ~viewport minus the nav so it reads as an
          app window rather than a strip. */}
      <PlaygroundShell />
    </div>
  );
}
