import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { WebhooksSection } from "../_sections/webhooks";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <WebhooksSection />
    </PortalShell>
  );
}
