"use client";

import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { meetsMinRole, type Workspace, type Role } from "../types";
import { workspaceSegment } from "../url";

export interface WorkspaceSettingsFormCoreProps {
  workspace: Workspace;
  role: Role;
  /**
   * Fired with the saved workspace. Router-agnostic on purpose: renaming
   * regenerates the slug, and each app decides for itself how to land on the
   * new canonical URL (`router.push` on the web, the SPA router in the
   * desktop renderer) and how to re-read the workspace it just changed.
   */
  onSaved: (updated: Workspace) => void;
}

/**
 * The General form's Next-free core (see `./workspace-settings-form` for the
 * web binding): rename + description. Deletion lives in WorkspaceDangerZone so
 * callers can order it after the reversible sections.
 *
 * The write goes through `apiRequest`, which is the transport seam both apps
 * share — plain fetch on the web, the Electron IPC bridge in the desktop SPA.
 */
export function WorkspaceSettingsFormCore({
  workspace,
  role,
  onSaved,
}: WorkspaceSettingsFormCoreProps) {
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canEdit = meetsMinRole(role, "admin");
  const dirty =
    name.trim() !== workspace.name ||
    (description.trim() || null) !== (workspace.description ?? null);

  const segment = workspaceSegment(workspace);

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { workspace: updated } = await apiRequest<{ workspace: Workspace }>(
        `/api/workspaces/${segment}`,
        {
          method: "PATCH",
          body: {
            name: name.trim() !== workspace.name ? name.trim() : undefined,
            description: description.trim() || null,
          },
        }
      );
      setSuccess("Saved.");
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Name
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          className="concave-field rounded-lg px-2.5 py-1.5 text-body text-text-primary outline-none disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Description
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={!canEdit}
          className="concave-field resize-none rounded-lg px-2.5 py-1.5 text-body text-text-primary outline-none disabled:opacity-50"
        />
      </label>

      <p className="text-caption text-text-muted">
        Renaming a workspace regenerates its slug, so the URL changes.
      </p>

      {error && <p className="text-caption text-danger">{error}</p>}
      {success && <p className="text-caption text-success">{success}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canEdit || !dirty || saving}
          onClick={handleSave}
          className="flex h-7 cursor-pointer items-center rounded-md bg-surface-cta px-2.5 text-small font-medium text-text-on-cta transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
