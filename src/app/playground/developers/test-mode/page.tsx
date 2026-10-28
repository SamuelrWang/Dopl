import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { TestModeSection } from "../_sections/test-mode";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <TestModeSection />
    </PortalShell>
  );
}
