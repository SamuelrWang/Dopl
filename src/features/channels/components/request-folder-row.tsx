"use client";

import { Folder, FolderOpen } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useChannelFolder } from "../hooks/use-channel-folder";

/**
 * The desktop-only "working folder" row: which folder the session spawns into
 * when the operator launches, plus the affordance to change it before deciding.
 * It drives the SAME per-channel bridge as the Settings tab's Agent-folder row
 * ({@link useChannelFolder}), so whatever this row shows is what the desktop
 * spawn uses, and a change made here shows up in the tab too.
 *
 * Renders NOTHING outside the desktop shell (no bridge = no dead control), and
 * nothing on the first paint either, since the bridge is feature-detected after
 * mount to stay hydration-safe.
 *
 * ⚠ It LEFT `consent-card.tsx` unchanged, when that card was retired for
 * `launch-panel.tsx` (wiring plan Phase 8). It sits beside
 * `permission-preset-row.tsx` because the two are the same kind of thing — the
 * pre-launch arm the operator sets before a human approval — and the panel that
 * composes them should be able to import them symmetrically.
 */
export function RequestFolderRow({ channelId }: { channelId: string }) {
  const { bridge, label, busy, choose } = useChannelFolder(channelId);
  if (!bridge) return null;
  return (
    <RequestFolderRowView
      label={label}
      busy={busy}
      onChange={() => void choose()}
    />
  );
}

/**
 * The control's presentation, split from the bridge-gated wrapper so it renders
 * (and is tested) on its own. `label` null = the desktop default folder. It is a
 * PILL (kit recipe: rounded-full + border-border-strong + bg-bg-inset, flat on a
 * card) so it reads as the same object as the other status pills instead of a
 * caption with a separate "Change" link — the whole pill is the change affordance.
 */
export function RequestFolderRowView({
  label,
  busy,
  onChange,
}: {
  /** Abbreviated folder label, or null for the desktop default folder. */
  label: string | null;
  /** True while the native picker is open — the affordance disables. */
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <div className="mb-2.5 flex">
      <button
        type="button"
        onClick={onChange}
        disabled={busy}
        aria-label="Change the folder this request runs in"
        title="Change the folder this request runs in"
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2.5 py-1",
          "text-caption font-medium text-text-secondary transition-colors",
          "hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-60"
        )}
      >
        {label ? (
          <FolderOpen size={12} className="shrink-0" />
        ) : (
          <Folder size={12} className="shrink-0" />
        )}
        <span className="min-w-0 truncate">
          {busy ? "Opening picker…" : label ?? "Default folder"}
        </span>
      </button>
    </div>
  );
}
