import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * `/developers` — the real Device SDK developer portal (W1.3, Plans/Dopl SDK Split › §9). Not
 * public: the proxy's session gate covers it (it is not in `PUBLIC_ROUTES`), and each page checks
 * the user again in `_lib/load-portal.ts`. Every `dev_*` read is server-side, service role, scoped
 * to the caller's own orgs (`features/device-sdk/server/portal.ts`). The `/playground/developers`
 * demo is the design reference and stays a demo.
 */
export const metadata: Metadata = {
  title: "Developers · Dopl",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return children;
}
