import type { RawSearchParams } from "@/features/device-sdk/portal/scope";
import { PortalFrame } from "../_components/portal-frame";
import { PageHeader } from "../_components/ui";
import { loadPortal } from "../_lib/load-portal";
import { NewOrgForm } from "./new-org-form";

/**
 * `/developers/new` — developer signup's second step (P3). A developer signs up with a Dopl
 * account (the proxy sends a signed-out visitor to sign in or sign up and back here), then names
 * an org and its first project. Creating it lands them on that project's keys.
 */
export default async function NewOrgPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { projects, params } = await loadPortal(searchParams, "/developers/new");
  return (
    <PortalFrame projects={projects} params={params} title="New org">
      <PageHeader title="Create a developer org" />
      <NewOrgForm firstOrg={projects.length === 0} />
    </PortalFrame>
  );
}
