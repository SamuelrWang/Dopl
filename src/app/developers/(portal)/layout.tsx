import type { Metadata } from "next";
import type { ReactNode } from "react";
import { hasIssues } from "@/features/device-sdk/portal/view";
import { designFont } from "./_design/font";
import { FontScope } from "./_design/font-scope";
import { PortalShell } from "./_components/portal-shell";
import { PortalProvider } from "./_components/portal-store";
import { BASE } from "./_components/format";
import { loadScope, loadSnapshot } from "./_lib/portal-page";

export const metadata: Metadata = {
  title: "Developers | Dopl",
  robots: { index: false, follow: false },
};

/**
 * `/developers`: the Device SDK developer portal. The proxy gates it (it is not in `PUBLIC_ROUTES`) and
 * `loadScope` is the second fence. No page here renders anything but real rows.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  const [scope, snapshot] = await Promise.all([loadScope(), loadSnapshot()]);
  const find = snapshot.users.flatMap((u) => [
    { id: u.id, label: u.name, kind: "User" as const, href: `${BASE}/users/${encodeURIComponent(u.id)}` },
    ...u.devices.map((d) => ({ id: d.id, label: d.name, kind: "Device" as const, href: `${BASE}/users/${encodeURIComponent(u.id)}` })),
  ]);
  return (
    <PortalProvider data={{ email: scope.email, projects: scope.projects, project: scope.project, env: scope.env, now: scope.now.toISOString() }}>
      <PortalShell fontClass={designFont.className} counts={{ issues: snapshot.issues.length, attention: snapshot.users.filter(hasIssues).length, find }}>
        {/* Keyed so a page's own state starts over when the project or environment changes. */}
        <FontScope key={`${scope.project.id}:${scope.env}`}>{children}</FontScope>
      </PortalShell>
    </PortalProvider>
  );
}
