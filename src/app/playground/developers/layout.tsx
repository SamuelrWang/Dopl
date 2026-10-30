import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PortalShell } from "./_components/portal-shell";
import { PortalProvider } from "./_components/portal-store";

export const metadata: Metadata = {
  title: "Developers (demo) | Dopl",
  robots: { index: false, follow: false },
};

/** `/playground/developers`: a hard-coded demo of the developer portal. No DB, no API, no auth. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <PortalProvider>
      <PortalShell>{children}</PortalShell>
    </PortalProvider>
  );
}
