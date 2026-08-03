"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { meetsMinRole, type Role, type Workspace } from "@/features/workspaces/types";
import { WorkspaceSettingsFormCore } from "@/features/workspaces/components/workspace-settings-form-core";
import { WorkspaceDangerZoneCore } from "@/features/workspaces/components/workspace-danger-zone-core";
// Deep import, not the `mcp-connect` barrel — the barrel pulls sibling
// components the desktop renderer has no need for into its bundle.
import { RemoteConnect } from "@/features/mcp-connect/components/remote-connect";
import { SectionShell } from "./section-shell";

interface Props {
  workspaceSegment: string;
  /** Post-rename navigation — `previous` is the workspace as it was read, so
   *  the caller can tell a slug-changing rename from an in-place edit. */
  onSaved: (updated: Workspace, previous: Workspace) => void;
  /** Post-delete navigation; `next` is the workspace to land on, if any. */
  onDeleted: (next: Workspace | null) => void;
  /** Workspace-image control, rendered above the form for editors. Web only:
   *  the upload is multipart, which the desktop IPC bridge (JSON) can't carry. */
  imageUploader?: (workspace: Workspace) => React.ReactNode;
}

/**
 * Workspace > General. Fetches the full workspace (the switcher only
 * carries a slim slice) and composes the icon uploader, the existing
 * rename/description/delete form, and the MCP connection block.
 *
 * Next-free core: the two workspace forms are their router-agnostic cores and
 * the post-write navigation arrives as props, so the web binding
 * (`./workspace-section`) and the desktop renderer share this one file.
 */
export function WorkspaceSectionCore({
  workspaceSegment,
  onSaved,
  onDeleted,
  imageUploader,
}: Props) {
  const query = useApiQuery<{ workspace: Workspace; role: Role }>(
    `/api/workspaces/${workspaceSegment}`
  );
  const workspace = query.data?.workspace ?? null;
  const role = query.data?.role ?? null;
  // Error only when there's nothing to show — a failed background
  // refetch must not replace the (possibly mid-edit) settings form.
  const error = query.error && !query.data ? "Failed to load workspace" : null;

  if (error) {
    return (
      <SectionShell title="General">
        <p className="text-caption text-danger">{error}</p>
      </SectionShell>
    );
  }

  if (!workspace || !role) {
    return (
      <SectionShell title="General">
        <div className="h-24 rounded-lg bg-surface-raised-1 animate-pulse" />
      </SectionShell>
    );
  }

  const canEdit = meetsMinRole(role, "admin");
  const image = canEdit ? imageUploader?.(workspace) : null;

  return (
    <SectionShell title="General" subtitle="Manage this workspace">
      {image && (
        <div className="flex flex-col gap-2">
          <label className="text-label font-semibold uppercase tracking-wide text-text-muted">
            Workspace image
          </label>
          {image}
        </div>
      )}
      <WorkspaceSettingsFormCore
        workspace={workspace}
        role={role}
        onSaved={(updated) => onSaved(updated, workspace)}
      />
      <RemoteConnect />
      {role === "owner" && (
        <WorkspaceDangerZoneCore workspace={workspace} onDeleted={onDeleted} />
      )}
    </SectionShell>
  );
}
