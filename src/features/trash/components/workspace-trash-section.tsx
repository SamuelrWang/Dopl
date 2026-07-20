"use client";

/**
 * WorkspaceTrashSection — the unified workspace Trash, rendered as a
 * settings section (framed identically to ConnectedAppsSection: a
 * rounded border-strong card with a card-2 label strip over a concave
 * SECTION_BOX_INSET body). Lists soft-deleted items across every feature,
 * grouped by feature, with Restore and permanent Delete actions. Visible
 * to every workspace member. Backed by the Phase-2 trash routes.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/shared/ui/toast";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { apiRequest } from "@/shared/api/api-client";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";

type TrashKind =
  | "knowledge_base"
  | "knowledge_folder"
  | "knowledge_entry"
  | "skill"
  | "workflow"
  | "chat"
  | "ontology_cluster";

interface TrashItem {
  kind: TrashKind;
  id: string;
  name: string;
  deletedAt: string;
  detail?: string;
  purgesAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Short tag shown next to each row's name. */
const KIND_LABEL: Record<TrashKind, string> = {
  knowledge_base: "Base",
  knowledge_folder: "Folder",
  knowledge_entry: "Entry",
  skill: "Skill",
  workflow: "Workflow",
  chat: "Chat",
  ontology_cluster: "Cluster",
};

/** Ordered feature groups — each is a labelled subheading over its rows. */
const GROUPS: Array<{ label: string; kinds: TrashKind[] }> = [
  { label: "Knowledge", kinds: ["knowledge_base", "knowledge_folder", "knowledge_entry"] },
  { label: "Skills", kinds: ["skill"] },
  { label: "Workflows", kinds: ["workflow"] },
  { label: "Chats", kinds: ["chat"] },
  { label: "Ontology", kinds: ["ontology_cluster"] },
];

const selectItems = (body: { items?: TrashItem[] }) => body.items ?? [];
const rowKey = (kind: TrashKind, id: string) => `${kind}:${id}`;

/** "purges in 12 days" — kept out of render so the now-read isn't flagged. */
function purgesLabel(purgesAt: string): string {
  const days = Math.max(0, Math.ceil((Date.parse(purgesAt) - Date.now()) / DAY_MS));
  return days <= 0 ? "purges soon" : `purges in ${days} day${days === 1 ? "" : "s"}`;
}

export function WorkspaceTrashSection({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const trashPath = `/api/workspaces/${workspaceSlug}/trash`;
  const queryClient = useQueryClient();
  // These routes use `withWorkspaceAuth` (the `[workspaceSlug]` segment is
  // cosmetic), so the X-Workspace-Id header — forwarded via `workspaceId` —
  // is what actually scopes the trash. Without it, resolution now fails
  // closed instead of silently returning the caller's default workspace.
  const query = useApiQuery<{ items?: TrashItem[] }, TrashItem[]>(trashPath, {
    workspaceId,
    select: selectItems,
  });
  // `null` = still loading. A fetch error is handled separately below so it
  // isn't mistaken for a genuinely empty trash (a management surface should
  // not silently say "empty" when it actually failed to load).
  const items = query.data ?? null;

  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TrashItem | null>(null);

  // The cache stores the RAW body (`{ items }`); `select` maps it on read,
  // so optimistic edits must write that raw shape at the query's key.
  function removeFromCache(kind: TrashKind, id: string) {
    queryClient.setQueryData(
      [trashPath, workspaceId, undefined],
      (prev: { items?: TrashItem[] } | undefined) =>
        prev
          ? { items: (prev.items ?? []).filter((i) => !(i.kind === kind && i.id === id)) }
          : prev
    );
  }

  async function restore(item: TrashItem) {
    setBusy(rowKey(item.kind, item.id));
    try {
      await apiRequest(`${trashPath}/restore`, {
        method: "POST",
        body: { kind: item.kind, id: item.id },
        workspaceId,
      });
      removeFromCache(item.kind, item.id);
      toast({ title: "Restored" });
    } catch {
      toast({ title: "Couldn't restore" });
    } finally {
      setBusy(null);
    }
  }

  // Throws on failure so ConfirmDialog stays open for a retry.
  async function purge(item: TrashItem) {
    try {
      await apiRequest(`${trashPath}/purge`, {
        method: "POST",
        body: { kind: item.kind, id: item.id },
        workspaceId,
      });
    } catch (err) {
      toast({ title: "Couldn't delete" });
      throw err;
    }
    removeFromCache(item.kind, item.id);
    toast({ title: "Deleted" });
  }

  const count = Array.isArray(items) ? items.length : 0;
  const meta = count > 0 ? `${count} item${count === 1 ? "" : "s"}` : undefined;

  let body: React.ReactNode;
  if (query.isError) {
    body = (
      <p className="text-caption text-text-muted">
        Couldn&rsquo;t load trash. Refresh the page to try again.
      </p>
    );
  } else if (items === null) {
    body = <p className="text-caption font-mono text-text-muted">Loading…</p>;
  } else if (items.length === 0) {
    body = (
      <p className="text-caption leading-relaxed text-text-muted">
        Trash is empty. Deleted knowledge, skills, workflows, chats, and ontology
        clusters show up here and are permanently removed after 30 days.
      </p>
    );
  } else {
    body = (
      <div className="space-y-4">
        {GROUPS.map((group) => {
          const rows = items.filter((i) => group.kinds.includes(i.kind));
          if (rows.length === 0) return null;
          return (
            <div key={group.label} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
                  {group.label}
                </span>
                <span className="text-caption text-text-muted">{rows.length}</span>
              </div>
              {rows.map((item) => (
                <TrashRow
                  key={rowKey(item.kind, item.id)}
                  item={item}
                  busy={busy === rowKey(item.kind, item.id)}
                  onRestore={() => void restore(item)}
                  onDelete={() => setConfirming(item)}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center gap-2 bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Trash
        </span>
        {meta && <span className="text-caption text-text-muted">{meta}</span>}
      </div>
      <div className={cn(SECTION_BOX_INSET, "p-4")}>{body}</div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Delete permanently?"
        description={
          confirming
            ? `Permanently delete "${confirming.name}"? This can't be undone.`
            : undefined
        }
        confirmLabel="Delete permanently"
        destructive
        onConfirm={async () => {
          if (confirming) await purge(confirming);
        }}
      />
    </section>
  );
}

function TrashRow({
  item,
  busy,
  onRestore,
  onDelete,
}: {
  item: TrashItem;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const purges = purgesLabel(item.purgesAt);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-elevated px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-body text-text-primary">{item.name}</span>
          <span className="shrink-0 rounded-full border border-border-default bg-bg-inset px-1.5 py-0.5 text-micro font-medium text-text-secondary">
            {KIND_LABEL[item.kind]}
          </span>
          {item.detail && (
            <span className="truncate text-caption text-text-muted">{item.detail}</span>
          )}
        </div>
        <p className="truncate text-micro font-mono text-text-muted">
          deleted {formatRelativeTime(item.deletedAt)} · {purges}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onRestore}
          disabled={busy}
          className="text-caption text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
        >
          {busy ? "…" : "Restore"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="text-caption text-text-secondary transition-colors hover:text-danger disabled:opacity-50"
        >
          Delete permanently
        </button>
      </div>
    </div>
  );
}
