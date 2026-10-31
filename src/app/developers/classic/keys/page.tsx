import { EmptyState } from "@/shared/ui/empty-state";
import { canManageKeys } from "@/features/device-sdk/portal/scope";
import type { RawSearchParams } from "@/features/device-sdk/portal/scope";
import { listProjectKeys } from "@/features/device-sdk/server/portal";
import { PortalFrame } from "../../_components/portal-frame";
import { NoProjects, PageHeader } from "../../_components/ui";
import { loadPortal } from "../../_lib/load-portal";
import { maskedKey, since } from "../../_lib/format";
import { KeysTable, type KeyView } from "./keys-table";

/** `/developers/classic/keys` — the selected project's keys for one env: masked, last used; create, rotate, revoke. */
export default async function KeysPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { projects, params, now } = await loadPortal(searchParams, "/developers/classic/keys");
  const project = projects.find((p) => p.id === params.project) ?? null;

  let body;
  if (projects.length === 0) {
    body = <NoProjects />;
  } else if (!project) {
    body = <EmptyState variant="outline" title="Pick a project" description="Keys belong to one project. Choose it on the left." />;
  } else {
    const rows = await listProjectKeys(project.id, params.env);
    const keys: KeyView[] = rows.map((k) => ({
      id: k.id,
      masked: maskedKey(k.prefix),
      kind: k.kind,
      scopes: k.scopes,
      created: since(k.created_at, now),
      lastUsed: since(k.last_used_at, now),
      status: k.revoked_at
        ? { kind: "revoked" }
        : k.expires_at && Date.parse(k.expires_at) <= now.getTime()
          ? { kind: "expired" }
          : k.expires_at
            ? { kind: "expiring", label: `Expires ${since(k.expires_at, now)}` }
            : { kind: "active" },
    }));
    body = <KeysTable projectId={project.id} env={params.env} keys={keys} canManage={canManageKeys(project.role)} internal={project.org.internal} />;
  }

  return (
    <PortalFrame projects={projects} params={params} title="API keys">
      {/* With a project, the table owns the header (its Create key button is client state). */}
      {!project && <PageHeader title="API keys" />}
      {body}
    </PortalFrame>
  );
}
