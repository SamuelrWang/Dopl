"use client";

import { useRef, useState } from "react";
import { workspaceSegment } from "@/features/workspaces/url";
import type { Workspace } from "@/features/workspaces/types";
import { WorkspaceAvatar } from "../workspace-avatar";

interface Props {
  workspace: Workspace;
  /** Fired after the icon changes so the sidebar can re-fetch. */
  onChanged: () => void;
}

/**
 * Upload or remove a workspace icon image. POSTs multipart to
 * `/api/workspaces/[segment]/icon` and DELETEs to clear. Optimistically
 * reflects the new URL on success and bubbles `onChanged` so the switcher
 * avatar updates everywhere.
 */
export function WorkspaceIconUploader({ workspace, onChanged }: Props) {
  const segment = workspaceSegment(workspace);
  const inputRef = useRef<HTMLInputElement>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(workspace.iconUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/workspaces/${segment}/icon`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error?.message || body?.error || "Upload failed");
      }
      setIconUrl(body.workspace?.iconUrl ?? null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${segment}/icon`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Remove failed");
      }
      setIconUrl(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <WorkspaceAvatar name={workspace.name} iconUrl={iconUrl} size="lg" />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="btn-light cursor-pointer rounded-md px-2.5 py-1 text-small font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Uploading…" : iconUrl ? "Replace image" : "Upload image"}
          </button>
          {iconUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={handleRemove}
              className="cursor-pointer rounded-md px-2.5 py-1 text-small font-medium text-text-secondary transition-colors hover:text-danger disabled:opacity-40"
            >
              Remove
            </button>
          )}
        </div>
        <p className="text-micro text-text-muted">PNG, JPG, WebP, GIF, or SVG · up to 2 MB</p>
        {error && <p className="text-caption text-danger">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
