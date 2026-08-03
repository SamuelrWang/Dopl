"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { meetsMinRole, type Role, type Workspace } from "@/features/workspaces/types";
import { WorkspaceSettingsFormCore } from "@/features/workspaces/components/workspace-settings-form-core";
import { WorkspaceDangerZoneCore } from "@/features/workspaces/components/workspace-danger-zone-core";
// Deep import, not the `mcp-connect` barrel — the barrel pulls sibling
// components the desktop renderer has no need for into its bundle.
import { RemoteConnect } from "@/features/mcp-connect/components/remote-connect";
import { SectionShell } from "./section-shell";

/** `GET /api/workspaces/{segment}` → `{ workspace, role }`. Exported because
 *  every surface that reads or INVALIDATES this entry must spell the key the
 *  same way — the settings page and this pane deliberately share one cache
 *  entry, and that only holds while the path is built in one place. */
export function workspaceReadPath(segment: string): string {
  return `/api/workspaces/${encodeURIComponent(segment)}`;
}

interface BodyProps {
  workspace: Workspace;
  role: Role;
  /** Post-rename navigation — `previous` is the workspace as it was read, so
   *  the caller can tell a slug-changing rename from an in-place edit. */
  onSaved: (updated: Workspace, previous: Workspace) => void;
  /** Post-delete navigation; `next` is the workspace to land on, if any. */
  onDeleted: (next: Workspace | null) => void;
  /** Workspace-image control, rendered above the form for editors. Web only:
   *  the upload is multipart, which the desktop IPC bridge (JSON) can't carry. */
  imageUploader?: (workspace: Workspace) => React.ReactNode;
  /** Surface-specific sections, rendered after the MCP block and before the
   *  owner-only danger zone. The desktop `/settings` PAGE hangs its connected
   *  apps and trash sections here; the modal has none. */
  extras?: React.ReactNode;
}

/**
 * THE workspace-settings composition: icon uploader, rename/description form,
 * MCP connection block, owner-only danger zone — in that order.
 *
 * A fragment, not a card: the caller owns the chrome. Two surfaces render it —
 * the settings MODAL's General pane (via `WorkspaceSectionCore` below, inside a
 * `SectionShell`) and the desktop SPA's `/settings` PAGE (directly, inside its
 * own page header). Both are reachable and both are live, and they used to
 * hand-compose the same three components independently, which is how their
 * post-rename behaviour drifted apart (2026-08-03 fleet audit,
 * duplication-quality). One source; the differences stay in props.
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
 * carries a slim slice) and renders `WorkspaceSectionBody` inside the modal's
 * section chrome.
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
    workspaceReadPath(workspaceSegment)
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
