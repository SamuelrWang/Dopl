import { notFound } from "next/navigation";
import { PORTAL_METADATA } from "../../_components/metadata";
import { PortalShell } from "../../_components/portal-shell";
import { describeType } from "../../_data/device-descriptors";
import { ADDABLE_TYPES, deviceType } from "../../_data/device-types";
import { DeviceTypeSection } from "../../_sections/device-type";

export const metadata = PORTAL_METADATA;

export function generateStaticParams() {
  return ADDABLE_TYPES.map((t) => ({ type: t.id }));
}

/** One device type: the connect code, its capabilities and their tests. Coming-soon types 404. */
export default async function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type: id } = await params;
  const type = deviceType(id);
  const descriptors = describeType(id);
  if (!type || !descriptors) notFound();
  return (
    <PortalShell>
      <DeviceTypeSection type={type} descriptors={descriptors} />
    </PortalShell>
  );
}
