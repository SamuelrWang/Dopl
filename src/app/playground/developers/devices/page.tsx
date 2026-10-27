import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { describeAll } from "../_data/device-descriptors";
import { DevicesSection } from "../_sections/devices";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <DevicesSection descriptors={describeAll()} />
    </PortalShell>
  );
}
