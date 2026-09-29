"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { cn } from "@/shared/lib/utils";
import { UnderlineField } from "@/shared/ui/form-dialog";
import { SMALL_PRIMARY_PILL } from "@/shared/ui/small-action-button";
import { meetsMinRole, type Workspace, type Role } from "../types";
import { workspaceSegment } from "../url";

export interface WorkspaceSettingsFormCoreProps {
  workspace: Workspace;
  role: Role;
  /**
   * Fired with the saved workspace. ⚠ Router-agnostic: renaming REGENERATES the
   * slug, and each app decides how to land on the new canonical URL and re-read
   * the workspace it just changed.
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
      setError(userFacingMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-sm flex-col gap-3">
      {/* The popup form kit's underline fields (`shared/ui/form-dialog.tsx`), by reference. */}
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-3 disabled:opacity-50">
        <UnderlineField
          id="workspace-settings-name"
          label="Name"
          ariaLabel="Workspace name"
          value={name}
          onChange={setName}
        />
        <UnderlineField
          id="workspace-settings-description"
          label="Description"
          ariaLabel="Workspace description"
          value={description}
          onChange={setDescription}
          multiline
        />
      </fieldset>

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
          className={cn(SMALL_PRIMARY_PILL, "disabled:cursor-not-allowed disabled:opacity-40")}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
