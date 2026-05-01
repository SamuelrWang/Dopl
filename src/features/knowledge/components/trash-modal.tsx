"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, Library, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { toast } from "@/shared/ui/toast";
import {
  KnowledgeApiError,
  fetchTrash,
  restoreBase,
  restoreEntry,
  restoreFolder,
} from "../client/api";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Restrict to one base; when undefined, shows workspace-wide trash. */
  baseId?: string;
  /** Called after a restore so the parent can refetch its tree. */
  onRestored?: () => void;
}

interface TrashState {
  bases: KnowledgeBase[];
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}

export function TrashModal({
  open,
  onOpenChange,
  workspaceId,
  baseId,
  onRestored,
}: Props) {
  const [trash, setTrash] = useState<TrashState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the load effect after a restore.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Loading state is derived: trash === null && open → loading.
    fetchTrash(baseId, workspaceId)
      .then((data) => {
        if (cancelled) return;
        setTrash(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load trash");
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseId, workspaceId, tick]);

  const isLoading = open && trash === null && error === null;

  async function handleRestore(
    type: "base" | "folder" | "entry",
    id: string,
    label: string
  ) {
    try {
      if (type === "base") await restoreBase(id, workspaceId);
      else if (type === "folder") await restoreFolder(id, workspaceId);
      else await restoreEntry(id, workspaceId);
      toast({ title: `Restored "${label}"` });
      setTick((t) => t + 1);
      onRestored?.();
    } catch (err) {
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't restore";
      toast({ title: "Couldn't restore", description: msg });
    }
  }

  const isEmpty =
    !!trash &&
    trash.bases.length === 0 &&
    trash.folders.length === 0 &&
    trash.entries.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-[#0a0a0a] border-white/[0.12] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Trash</DialogTitle>
          <DialogDescription className="text-white/50">
            {baseId
              ? "Soft-deleted folders and entries from this knowledge base."
              : "Soft-deleted items from across this workspace's knowledge bases."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 max-h-[60vh] overflow-y-auto pr-1">
          {isLoading && (
            <p className="text-xs text-text-secondary">Loading…</p>
          )}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
          {trash && isEmpty && (
            <p className="text-xs text-text-secondary py-6 text-center">
              Trash is empty.
            </p>
          )}

          {trash && trash.bases.length > 0 && (
            <Section title="Knowledge bases">
              {trash.bases.map((b) => (
                <TrashRow
                  key={b.id}
                  icon={<Library size={12} className="text-text-secondary/70" />}
                  label={b.name}
                  meta={`Deleted ${formatRelative(b.deletedAt ?? b.updatedAt)}`}
                  onRestore={() => handleRestore("base", b.id, b.name)}
                />
              ))}
            </Section>
          )}
          {trash && trash.folders.length > 0 && (
            <Section title="Folders">
              {trash.folders.map((f) => (
                <TrashRow
                  key={f.id}
                  icon={<Folder size={12} className="text-text-secondary/70" />}
                  label={f.name}
                  meta={`Deleted ${formatRelative(f.deletedAt ?? f.updatedAt)}`}
                  onRestore={() => handleRestore("folder", f.id, f.name)}
                />
              ))}
            </Section>
          )}
          {trash && trash.entries.length > 0 && (
            <Section title="Entries">
              {trash.entries.map((e) => (
                <TrashRow
                  key={e.id}
                  icon={<FileText size={12} className="text-violet-300" />}
                  label={e.title}
                  meta={`Deleted ${formatRelative(e.deletedAt ?? e.updatedAt)}`}
                  onRestore={() => handleRestore("entry", e.id, e.title)}
                />
              ))}
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[10px] font-medium text-white/40 uppercase tracking-wider mb-1.5">
        {title}
      </p>
      <div className="rounded-md border border-white/[0.06] divide-y divide-white/[0.04]">
        {children}
      </div>
    </div>
  );
}

function TrashRow({
  icon,
  label,
  meta,
  onRestore,
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
  onRestore: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{label}</p>
        <p className="text-[11px] text-text-secondary/70">{meta}</p>
      </div>
      <button
        type="button"
        onClick={onRestore}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] cursor-pointer"
      >
        <RotateCcw size={11} />
        Restore
      </button>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;
  return new Date(iso).toLocaleDateString();
}
