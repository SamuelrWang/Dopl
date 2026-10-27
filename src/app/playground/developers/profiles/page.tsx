import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { ProfilesSection } from "../_sections/profiles";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <ProfilesSection />
    </PortalShell>
  );
}
