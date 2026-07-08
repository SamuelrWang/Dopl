"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Workspace, Role } from "../types";
import { workspaceSegment } from "../url";

interface Props {
  workspace: Workspace;
  role: Role;
}

/**
 * Per-workspace General form: rename + description. Deletion lives in
 * WorkspaceDangerZone so callers can order it after the reversible
 * sections.
 */
export function WorkspaceSettingsForm({ workspace, role }: Props) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canEdit = role === "owner" || role === "admin";
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
      const res = await fetch(`/api/workspaces/${segment}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() !== workspace.name ? name.trim() : undefined,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to save");
      }
      const { workspace: updated } = (await res.json()) as { workspace: Workspace };
      setSuccess("Saved.");
      // Slug may have changed if the name changed; redirect to the new
      // canonical settings URL so subsequent saves hit the right route.
      if (updated.slug !== workspace.slug) {
        router.push(`/${workspaceSegment(updated)}/settings`);
      } else {
        router.refresh();
      }
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
