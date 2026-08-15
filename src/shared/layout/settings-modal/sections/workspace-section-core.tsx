"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { meetsMinRole, type Role, type Workspace } from "@/features/workspaces/types";
import { WorkspaceSettingsFormCore } from "@/features/workspaces/components/workspace-settings-form-core";
import { WorkspaceDangerZoneCore } from "@/features/workspaces/components/workspace-danger-zone-core";
// ⚠ Deep import, NOT the `mcp-connect` barrel — the barrel drags sibling
// components the desktop renderer doesn't need into its bundle.
import { RemoteConnect } from "@/features/mcp-connect/components/remote-connect";
import { SectionShell } from "./section-shell";

/** `GET /api/workspaces/{segment}` → `{ workspace, role }`. ⚠ Exported because
 *  every surface that reads or INVALIDATES this entry must spell the key
 *  identically — the settings page and this pane share one cache entry, which
 *  only holds while the path is built in one place. */
export function workspaceReadPath(segment: string): string {
  return `/api/workspaces/${encodeURIComponent(segment)}`;
}

interface BodyProps {
  workspace: Workspace;
  role: Role;
  /** Post-rename navigation. `previous` = the workspace as read, so the caller
   *  can tell a slug-changing rename from an in-place edit. */
  onSaved: (updated: Workspace, previous: Workspace) => void;
  /** Post-delete navigation; `next` = workspace to land on, if any. */
  onDeleted: (next: Workspace | null) => void;
  /** Editors only, above the form. Web only: the upload is multipart, which the
   *  desktop's JSON IPC bridge can't carry. */
  imageUploader?: (workspace: Workspace) => React.ReactNode;
  /** Rendered after the MCP block, before the owner-only danger zone. Desktop
   *  `/settings` PAGE hangs connected-apps here; the modal has none. */
  extras?: React.ReactNode;
}

/**
 * THE workspace-settings composition, in order: icon uploader,
 * rename/description form, MCP block, owner-only danger zone.
 * ⚠ A fragment, not a card — the caller owns the chrome. Two live surfaces
 * render it (settings MODAL via `WorkspaceSectionCore`, desktop `/settings`
 * PAGE directly). ONE source; differences stay in props.
 */
export function WorkspaceSectionBody({
  workspace,
  role,
  onSaved,
  onDeleted,
  imageUploader,
  extras,
}: BodyProps) {
  const canEdit = meetsMinRole(role, "admin");
  const image = canEdit ? imageUploader?.(workspace) : null;

  return (
    <>
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
      {extras}
      {role === "owner" && (
        <WorkspaceDangerZoneCore workspace={workspace} onDeleted={onDeleted} />
      )}
    </>
  );
}

interface Props {
  workspaceSegment: string;
  /** See `BodyProps.onSaved`. */
  onSaved: (updated: Workspace, previous: Workspace) => void;
  /** See `BodyProps.onDeleted`. */
  onDeleted: (next: Workspace | null) => void;
  /** See `BodyProps.imageUploader` — web only. */
  imageUploader?: (workspace: Workspace) => React.ReactNode;
}

/**
 * Workspace > General. Fetches the FULL workspace (the switcher carries only a
 * slim slice) and renders `WorkspaceSectionBody` in the modal's section chrome.
 * Next-free core — post-write navigation arrives as props, so the web binding
 * (`./workspace-section`) and the desktop renderer share this file.
 */
export function WorkspaceSectionCore({
  workspaceSegment,
  onSaved,
  onDeleted,
  imageUploader,
}: Props) {
  const query = useApiQuery<{ workspace: Workspace; role: Role }>(
    workspaceReadPath(workspaceSegment)
  );
  const workspace = query.data?.workspace ?? null;
  const role = query.data?.role ?? null;
  // ⚠ Error ONLY when there's nothing to show: a failed background refetch must
  // not replace the (possibly mid-edit) settings form.
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

  return (
    <SectionShell title="General" subtitle="Manage this workspace">
      <WorkspaceSectionBody
        workspace={workspace}
        role={role}
        onSaved={onSaved}
        onDeleted={onDeleted}
        imageUploader={imageUploader}
      />
    </SectionShell>
  );
}
