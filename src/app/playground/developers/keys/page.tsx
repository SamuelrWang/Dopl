import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { KeysSection } from "../_sections/keys";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <KeysSection />
    </PortalShell>
  );
}
