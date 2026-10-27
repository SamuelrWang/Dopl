import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { DevicesSection } from "../_sections/devices";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <DevicesSection />
    </PortalShell>
  );
}
