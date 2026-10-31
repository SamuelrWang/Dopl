import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * `/developers` — the real Device SDK developer portal (W1.3, Plans/Dopl SDK Split › §9). Not
 * public: the proxy's session gate covers it (it is not in `PUBLIC_ROUTES`), and each page checks
 * the user again in `(portal)/_lib/portal-page.ts`. Every `dev_*` read is server-side, service role, scoped
 * to the caller's own orgs (`features/device-sdk/server/portal.ts`). `(portal)` is the portal itself;
 * `new` and `invite` are the two steps that happen before a person has a project to open.
 */
export const metadata: Metadata = {
  title: "Developers · Dopl",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return children;
}
