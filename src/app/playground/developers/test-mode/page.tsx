import Link from "next/link";
import { pillButton } from "@/shared/ui/pill-button";
import { PORTAL_METADATA } from "../_components/metadata";
import { PortalShell } from "../_components/portal-shell";
import { Card, ov } from "../_components/ui";
import { TestModeSection } from "../_sections/test-mode";

export const metadata = PORTAL_METADATA;

/**
 * The demo's Test mode stays as the design reference; the card on top points to the REAL
 * playground (`/developers/playground`), which runs calls with the developer's own test key.
 */
export default function Page() {
  return (
    <PortalShell>
      <Card
        title="Try it for real"
        aside={
          <Link href="/developers/playground" className={pillButton("outline", "sm")}>
            Open playground
          </Link>
        }
      >
        <span className={ov.rowMeta}>
          This page is a demo with sample data. The developer portal&apos;s playground runs real calls against your own test project.
        </span>
      </Card>
      <TestModeSection />
    </PortalShell>
  );
}
