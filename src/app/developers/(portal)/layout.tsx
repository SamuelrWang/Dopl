import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getUser } from "@/shared/supabase/server";
import { designFont } from "./_design/font";
import { PortalShell } from "./_components/portal-shell";
import { PortalProvider } from "./_components/portal-store";

export const metadata: Metadata = {
  title: "Developers | Dopl",
  robots: { index: false, follow: false },
};

/**
 * `/developers`: the redesigned Device SDK developer portal. Moved out of public `/playground` on
 * 2026-10-31 so real data can never reach an unauthenticated route; the proxy gates it (it is not in
 * `PUBLIC_ROUTES`) and this is the second fence.
 *
 * ⚠ THE PAGES STILL RENDER FIXTURES (`./_data`) until Phase 3 of docs/specs/dev-portal-live/PLAN.md wires
 * each one, and the shell says so on every page. The real reads are under `/developers/classic`.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  if (!(await getUser())) redirect("/login?redirectTo=/developers");
  return (
    <PortalProvider>
      <PortalShell fontClass={designFont.className}>{children}</PortalShell>
    </PortalProvider>
  );
}
