import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { UsersSection } from "../_sections/users";

export const metadata = PORTAL_METADATA;

export default function Page() {
  return (
    <PortalShell>
      <UsersSection />
    </PortalShell>
  );
}
