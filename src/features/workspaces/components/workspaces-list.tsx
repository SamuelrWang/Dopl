"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";
import type { Workspace } from "../types";

/**
 * Client-side workspace list. Server-rendered version would be cleaner but
 * the create + delete flows want optimistic updates and a refresh cycle,
 * so client fetch + revalidation is simpler than threading server
 * actions for v1. Phase 4 will add a member-count column once the
 * workspace_members API lands.
 */
export function WorkspacesList({ initial }: { initial: Workspace[] }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initial);
  const [createOpen, setCreateOpen] = useState(false);

  // Refetch on mount in case the server-rendered list became stale
  // (e.g. user just deleted a workspace in another tab). Cheap query.
  useEffect(() => {
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : { workspaces: initial }))
      .then((body: { workspaces: Workspace[] }) =>
        setWorkspaces(body.workspaces ?? initial)
      )
      .catch(() => {});
  }, [initial]);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Workspaces</h1>
          <p className="text-sm text-white/50 mt-1">
            Each workspace is a separate workspace — its own clusters, brain,
            and chat history.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="h-9 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors"
        >
          New workspace
        </button>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {workspaces.map((c) => (
            <WorkspaceCard key={c.id} workspace={c} />
          ))}
        </div>
      )}

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(workspace) => {
          setWorkspaces((prev) => [workspace, ...prev]);
          router.refresh();
        }}
      />
    </>
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.08] p-4 hover:bg-white/[0.05] hover:border-white/[0.15] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/${workspace.slug}`}
            className="block text-sm font-medium text-white truncate hover:underline"
          >
            {workspace.name}
          </Link>
          {workspace.description && (
            <p className="text-xs text-white/50 mt-1 line-clamp-2">
              {workspace.description}
            </p>
          )}
          <p className="text-[10px] uppercase tracking-wider text-white/30 mt-2 font-mono">
            Updated {formatRelative(workspace.updatedAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Link
            href={`/workspace/${workspace.slug}`}
            className="h-7 px-3 rounded-md text-[10px] uppercase tracking-wider font-medium text-white/70 bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.1] hover:text-white transition-colors"
          >
            Open
          </Link>
          <Link
            href={`/workspaces/${workspace.slug}/settings`}
            className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors"
          >
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-dashed border-white/[0.12] p-10 flex flex-col items-center text-center">
      <h2 className="text-base font-medium text-white">No workspaces yet</h2>
      <p className="text-sm text-white/50 mt-1 max-w-sm">
        Create your first workspace to start gathering setups, building a
        cluster, and shaping its brain.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 h-9 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors"
      >
        Create workspace
      </button>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
