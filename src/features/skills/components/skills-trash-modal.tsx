"use client";

import { useEffect, useState } from "react";
import { FileCode, RotateCcw, X } from "lucide-react";
// Deep import, NOT the `settings-modal` barrel: the barrel re-exports
// `SettingsModal`, which drags the whole settings tree (and its
// `next/navigation` call sites) into any bundle that touches this modal —
// fatal for the desktop SPA, which has no Next.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { toast } from "@/shared/ui/toast";
import {
  SkillApiError,
  fetchSkillsTrash,
  restoreSkill,
} from "../client/api";
import type { Skill } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Called after a restore so the parent can refetch its list. */
  onRestored?: () => void;
}

interface TrashState {
  skills: Skill[];
}

/**
 * Recently-deleted skills for the workspace. Mirrors the KB trash modal —
 * load on open, restore inline with optimistic toast, empty/loading/error
 * states. Skills are single-file, so only whole-skill restore exists
 * (any leftover merged files are purged by the nightly cron, not shown).
 */
export function SkillsTrashModal({
  open,
  onOpenChange,
  workspaceId,
  onRestored,
}: Props) {
  const [trash, setTrash] = useState<TrashState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchSkillsTrash(workspaceId)
      .then((data) => {
        if (cancelled) return;
        setTrash({ skills: data.skills });
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load trash");
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, tick]);

  const isLoading = open && trash === null && error === null;

  async function handleRestore(id: string, label: string) {
    try {
      await restoreSkill(id, workspaceId);
      toast({ title: `Restored "${label}"` });
      setTick((t) => t + 1);
      onRestored?.();
    } catch (err) {
      const msg =
        err instanceof SkillApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't restore";
      toast({ title: "Couldn't restore", description: msg });
    }
  }

  const isEmpty = !!trash && trash.skills.length === 0;

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      label="Trash"
      size="narrow"
    >
      <button
        type="button"
        className={modalStyles.close}
        onClick={() => onOpenChange(false)}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className={modalStyles.narrowBody}>
        <h2 className={modalStyles.narrowTitle}>Trash</h2>
        <p className="mb-6 text-lead leading-relaxed text-text-secondary">
          Soft-deleted skills from this workspace.
        </p>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {isLoading && (
            <p className="text-small text-text-secondary">Loading…</p>
          )}
          {error && <p className="text-small text-danger">{error}</p>}
          {trash && isEmpty && (
            <p className="text-small text-text-secondary py-6 text-center">
              Trash is empty.
            </p>
          )}

          {trash && trash.skills.length > 0 && (
            <Section title="Skills">
              {trash.skills.map((s) => (
                <TrashRow
                  key={s.id}
                  icon={<FileCode size={12} className="text-text-muted" />}
                  label={s.name}
                  meta={`Deleted ${formatRelative(s.deletedAt ?? s.updatedAt)}`}
                  onRestore={() => handleRestore(s.id, s.name)}
                />
              ))}
            </Section>
          )}
        </div>
      </div>
    </ModalShell>
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
      <p className="text-label font-medium text-text-muted uppercase tracking-wider mb-1.5">
        {title}
      </p>
      <div className="rounded-md border border-border-subtle divide-y divide-border-subtle">
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
        <p className="text-body text-text-primary truncate">{label}</p>
        <p className="text-caption text-text-muted">{meta}</p>
      </div>
      <button
        type="button"
        onClick={onRestore}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-small text-text-secondary hover:text-text-primary hover:bg-surface-raised-2 cursor-pointer"
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
