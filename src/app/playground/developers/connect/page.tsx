import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { ConnectPreviewSection } from "../_sections/connect-preview";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <ConnectPreviewSection />
    </PortalShell>
  );
}
