import { PORTAL_METADATA } from "./_components/metadata";
import { PortalShell } from "./_components/portal-shell";
import { OverviewSection } from "./_sections/overview";

export const metadata = PORTAL_METADATA;

/**
 * `/playground/developers` — a hard-coded DEMO of the Device SDK developer portal for the "Acme
 * Agents" account (`./_data/fixtures.ts`). No DB, no API, no auth: `/playground` is in
 * `shared/auth/public-routes.ts › PUBLIC_ROUTES` (prefix match), so every section renders signed
 * out. Sections are sibling routes; the env switch and local edits live in
 * `./_components/portal-context.tsx`.
 */
export default function Page() {
  return (
    <PortalShell>
      <OverviewSection />
    </PortalShell>
  );
}
