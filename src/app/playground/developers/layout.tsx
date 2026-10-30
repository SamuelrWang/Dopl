import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PortalShell } from "./_components/portal-shell";
import { PortalProvider } from "./_components/portal-store";

export const metadata: Metadata = {
  title: "Developers (demo) | Dopl",
  robots: { index: false, follow: false },
};

/**
 * `/playground/developers`: a hard-coded DEMO of the Device SDK developer portal for one fictional
 * customer (`./_data`). No DB, no API, no auth: `/playground` is in
 * `shared/auth/public-routes.ts › PUBLIC_ROUTES`. Edits live in `./_components/portal-store.tsx`.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <PortalProvider>
      <PortalShell>{children}</PortalShell>
    </PortalProvider>
  );
}
