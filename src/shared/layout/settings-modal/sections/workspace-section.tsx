"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { meetsMinRole, type Role, type Workspace } from "@/features/workspaces/types";
import { WorkspaceSettingsForm } from "@/features/workspaces/components/workspace-settings-form";
import { WorkspaceDangerZone } from "@/features/workspaces/components/workspace-danger-zone";
import { RemoteConnect } from "@/features/mcp-connect";
import { WorkspaceIconUploader } from "../workspace-icon-uploader";
import { SectionShell } from "./section-shell";

interface Props {
  workspaceSegment: string;
  onWorkspaceChanged: () => void;
}

/**
 * Workspace > General. Fetches the full workspace (the switcher only
 * carries a slim slice) and composes the icon uploader, the existing
 * rename/description/delete form, and the MCP connection block.
 */
export function WorkspaceSection({ workspaceSegment, onWorkspaceChanged }: Props) {
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

  return (
    <SectionShell title="General" subtitle="Manage this workspace">
      {canEdit && (
        <div className="flex flex-col gap-2">
          <label className="text-label font-semibold uppercase tracking-wide text-text-muted">
            Workspace image
          </label>
          <WorkspaceIconUploader workspace={workspace} onChanged={onWorkspaceChanged} />
        </div>
      )}
      <WorkspaceSettingsForm workspace={workspace} role={role} />
      <RemoteConnect />
      {role === "owner" && <WorkspaceDangerZone workspace={workspace} />}
    </SectionShell>
  );
}
