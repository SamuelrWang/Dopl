"use client";

import { useEffect, useState } from "react";
import type { Role, Workspace } from "@/features/workspaces/types";
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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspaces/${workspaceSegment}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to load workspace");
        return r.json() as Promise<{ workspace: Workspace; role: Role }>;
      })
      .then((body) => {
        if (cancelled) return;
        setWorkspace(body.workspace);
        setRole(body.role);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSegment]);

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

  const canEdit = role === "owner" || role === "admin";

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
