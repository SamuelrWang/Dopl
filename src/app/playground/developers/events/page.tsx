import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { EventsSection } from "../_sections/events";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <EventsSection />
    </PortalShell>
  );
}
