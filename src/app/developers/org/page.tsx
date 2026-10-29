import { EmptyState } from "@/shared/ui/empty-state";
import { canManageKeys, canManageMembers, type RawSearchParams } from "@/features/device-sdk/portal/scope";
import { listPortalOrgs } from "@/features/device-sdk/server/portal";
import { listOrgMembers } from "@/features/device-sdk/server/portal-admin";
import { listOrgInvites } from "@/features/device-sdk/server/portal-invites";
import { PortalFrame } from "../_components/portal-frame";
import { NoProjects, PageHeader } from "../_components/ui";
import { loadPortal } from "../_lib/load-portal";
import { since } from "../_lib/format";
import { OrgView } from "./org-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/developers/org` — the org's projects, members and open invites (P3). The org is `?org=` when it
 * is one of the caller's, else the selected project's org, else their first. Every read is
 * reach-checked in `portal-admin.ts` / `portal-invites.ts`; invites are listed for owner/admin only.
 */
export default async function OrgPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { userId, projects, params, now } = await loadPortal(searchParams, "/developers/org");
  const raw = await searchParams;
  const wanted = typeof raw.org === "string" && UUID.test(raw.org) ? raw.org : null;
  const orgs = await listPortalOrgs(userId);
  const fromProject = projects.find((p) => p.id === params.project)?.org.id ?? null;
  const org = orgs.find((o) => o.id === wanted) ?? orgs.find((o) => o.id === fromProject) ?? orgs[0] ?? null;

  if (!org) {
    return (
      <PortalFrame projects={projects} params={params} title="Organization">
        <PageHeader title="Organization" />
        <NoProjects />
      </PortalFrame>
    );
  }

  const [members, invites] = await Promise.all([
    listOrgMembers(userId, org.id),
    canManageMembers(org.role) ? listOrgInvites(userId, org.id, now) : Promise.resolve([]),
  ]);

  return (
    <PortalFrame projects={projects} params={params} title="Organization">
      {org.internal && (
        <EmptyState variant="outline" title="Internal org. Never billed. Members, projects and keys are managed by hand." />
      )}
      <OrgView
        org={{ id: org.id, name: org.name, role: org.role }}
        me={userId}
        // An internal org is managed by hand (`portal-admin.ts › refuseInternal`): no write controls.
        canManageProjects={canManageKeys(org.role) && !org.internal}
        canManageMembers={canManageMembers(org.role) && !org.internal}
        canEditMembers={!org.internal}
        projects={projects.filter((p) => p.org.id === org.id).map((p) => ({ id: p.id, name: p.name, apiVersion: p.apiVersion }))}
        members={members.map((m) => ({
          userId: m.userId,
          email: m.email ?? "Unknown account",
          role: m.role,
          isOwner: m.isOwner,
          joined: m.joinedAt ? since(m.joinedAt, now) : "Created the org",
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          sent: since(i.createdAt, now),
          expires: i.expired ? "Expired" : `Expires ${since(i.expiresAt, now)}`,
          expired: i.expired,
        }))}
        otherOrgs={orgs.filter((o) => o.id !== org.id).map((o) => ({ id: o.id, name: o.name }))}
      />
    </PortalFrame>
  );
}
