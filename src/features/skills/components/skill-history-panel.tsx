"use client";

/**
 * SkillHistoryPanel — the version-history rail for a skill.
 *
 * One merged timeline: SKILL.md body snapshots (SkillVersion) and
 * structural events (SkillEvent), newest first. Clicking a snapshot
 * opens a side-by-side diff against the previous snapshot; Restore rolls
 * the body back (server mints a new version — the timeline is
 * append-only).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, History, RotateCcw, User, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { toast } from "@/shared/ui/toast";
import { diffLines, type DiffRow } from "@/shared/lib/diff";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type { SkillEvent, SkillVersion } from "../types";
import {
  fetchSkillHistory,
  fetchSkillVersion,
  restoreSkillVersion,
} from "../client/api";
import { errMessage } from "./skill-view-utils";

interface Props {
  slug: string;
  /** Workspace being viewed — forwarded to every history call so the
   *  route targets THIS workspace, not the caller's default. */
  workspaceId: string;
  canEdit: boolean;
  /** Bump to refetch (e.g. after a save lands). */
  refreshKey: number;
  onClose: () => void;
  /** Called after a successful restore so the editor can pull fresh state. */
  onRestored: () => void;
}

type TimelineItem =
  | { kind: "version"; at: string; version: SkillVersion }
  | { kind: "event"; at: string; event: SkillEvent };

const EVENT_LABEL: Record<SkillEvent["type"], string> = {
  "skill.created": "Skill created",
  "skill.updated": "Details updated",
  "skill.published": "Made public",
  "skill.trashed": "Moved to trash",
  "skill.restored": "Restored from trash",
  "file.created": "File added",
  "file.renamed": "File renamed",
  "file.trashed": "File removed",
  "file.restored": "File restored",
  "file.rolled_back": "Rolled back",
};

export function SkillHistoryPanel({
  slug,
  workspaceId,
  canEdit,
  refreshKey,
  onClose,
  onRestored,
}: Props) {
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [events, setEvents] = useState<SkillEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<SkillVersion | null>(null);

  // Refetch trigger — flip `loading` during render (sanctioned
  // adjust-state pattern) instead of synchronously inside the effect.
  const fetchKey = `${slug}:${refreshKey}`;
  const [lastFetchKey, setLastFetchKey] = useState(fetchKey);
  if (lastFetchKey !== fetchKey) {
    setLastFetchKey(fetchKey);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    fetchSkillHistory(slug, workspaceId)
      .then((payload) => {
        if (cancelled) return;
        setVersions(payload.versions);
        setEvents(payload.events);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, workspaceId, refreshKey]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...versions.map((v) => ({ kind: "version" as const, at: v.createdAt, version: v })),
      ...events.map((e) => ({ kind: "event" as const, at: e.createdAt, event: e })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [versions, events]);

  /** The immediately-older snapshot, for the diff baseline. All versions
   *  belong to the one SKILL.md now, so it's just the next one down. */
  const previousOf = useCallback(
    (v: SkillVersion): SkillVersion | null => {
      const ordered = [...versions].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
      const idx = ordered.findIndex((x) => x.id === v.id);
      return idx >= 0 ? (ordered[idx + 1] ?? null) : null;
    },
    [versions]
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border-default">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <History size={12} className="text-text-muted" />
        <span className="flex-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
          History
        </span>
        <button
          type="button"
          aria-label="Close history"
          onClick={onClose}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading && (
          <p className="px-2 py-3 text-caption text-text-muted">Loading history…</p>
        )}
        {error && <p className="px-2 py-3 text-caption text-danger">{error}</p>}
        {!loading && !error && timeline.length === 0 && (
          <p className="px-2 py-3 text-caption text-text-muted">
            No history yet — versions appear as files are saved.
          </p>
        )}
        <ul className="space-y-0.5">
          {timeline.map((item) =>
            item.kind === "version" ? (
              <VersionRow
                key={`v-${item.version.id}`}
                version={item.version}
                onOpenDiff={() => setDiffFor(item.version)}
              />
            ) : (
              <EventRow key={`e-${item.event.id}`} event={item.event} />
            )
          )}
        </ul>
      </div>

      {diffFor && (
        <DiffModal
          version={diffFor}
          previous={previousOf(diffFor)}
          workspaceId={workspaceId}
          canEdit={canEdit}
          onClose={() => setDiffFor(null)}
          onRestored={() => {
            setDiffFor(null);
            onRestored();
          }}
        />
      )}
    </aside>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────

function SourceChip({ source }: { source: "user" | "agent" }) {
  const Icon = source === "agent" ? Bot : User;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-micro",
        source === "agent"
          ? "border-border-strong bg-bg-inset text-text-primary"
          : "border-border-default bg-surface-raised-1 text-text-secondary"
      )}
    >
      <Icon size={9} />
      {source}
    </span>
  );
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const mins = Math.floor((now - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function VersionRow({
  version,
  onOpenDiff,
}: {
  version: SkillVersion;
  onOpenDiff: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpenDiff}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-small text-text-primary">
            {PRIMARY_SKILL_FILE_NAME}
          </span>
          <span className="block text-micro text-text-muted">
            {timeLabel(version.createdAt)}
          </span>
        </span>
        <SourceChip source={version.source} />
      </button>
    </li>
  );
}

function EventRow({ event }: { event: SkillEvent }) {
  const detailText =
    event.type === "file.renamed"
      ? `${event.detail.from as string} → ${event.detail.to as string}`
      : event.type === "skill.updated" && Array.isArray(event.detail.fields)
        ? (event.detail.fields as string[]).join(", ")
        : typeof event.detail.name === "string"
          ? event.detail.name
          : null;
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block text-small text-text-secondary">
          {EVENT_LABEL[event.type]}
          {detailText && (
            <span className="text-text-muted"> · {detailText}</span>
          )}
        </span>
        <span className="block text-micro text-text-muted">
          {timeLabel(event.createdAt)}
        </span>
      </span>
      <SourceChip source={event.source} />
    </li>
  );
}

// ── Diff modal ───────────────────────────────────────────────────────

function DiffModal({
  version,
  previous,
  workspaceId,
  canEdit,
  onClose,
  onRestored,
}: {
  version: SkillVersion;
  previous: SkillVersion | null;
  workspaceId: string;
  canEdit: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSkillVersion(version.id, workspaceId),
      previous ? fetchSkillVersion(previous.id, workspaceId) : Promise.resolve(null),
    ])
      .then(([current, prev]) => {
        if (cancelled) return;
        setRows(diffLines(prev?.body ?? "", current.body));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version.id, previous, workspaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleRestore = async () => {
    setBusy(true);
    try {
      await restoreSkillVersion(version.id, workspaceId);
      toast({ title: "Version restored", description: PRIMARY_SKILL_FILE_NAME });
      onRestored();
    } catch (err) {
      toast({ title: "Couldn't restore", description: errMessage(err) });
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden />
      <div className="bento relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
            {PRIMARY_SKILL_FILE_NAME}
            <span className="ml-2 font-normal text-text-muted">
              {timeLabel(version.createdAt)}
              {previous ? ` · vs ${timeLabel(previous.createdAt)}` : " · first version"}
            </span>
          </span>
          <SourceChip source={version.source} />
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={handleRestore}
              className="btn-light flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-caption font-medium text-text-primary disabled:opacity-50"
            >
              <RotateCcw size={11} />
              {busy ? "Restoring…" : "Restore this version"}
            </button>
          )}
          <button
            type="button"
            aria-label="Close diff"
            onClick={onClose}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto font-mono text-micro leading-relaxed">
          {error && <p className="px-4 py-3 text-caption text-danger">{error}</p>}
          {!rows && !error && (
            <p className="px-4 py-3 text-caption text-text-muted">Loading diff…</p>
          )}
          {rows && (
            <table className="w-full border-collapse">
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <DiffCell side={row.left} tone={row.type === "del" ? "del" : "same"} />
                    <DiffCell side={row.right} tone={row.type === "add" ? "add" : "same"} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffCell({
  side,
  tone,
}: {
  side?: { num: number; text: string };
  tone: "same" | "add" | "del";
}) {
  return (
    <td
      className={cn(
        "w-1/2 whitespace-pre-wrap break-words border-b border-border-subtle px-3 py-0.5 align-top",
        tone === "add" && "bg-success/10",
        tone === "del" && "bg-danger/10",
        !side && "bg-surface-raised-1"
      )}
    >
      {side && (
        <>
          <span className="mr-3 inline-block w-8 select-none text-right text-text-disabled">
            {side.num}
          </span>
          {side.text || " "}
        </>
      )}
    </td>
  );
}
