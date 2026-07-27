"use client";

import { useCallback, useEffect, useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import {
  getDesktopChannelFolders,
  type DoplChannelsBridge,
} from "@/shared/lib/desktop";

interface Props {
  /** The channel's DB UUID — passed to the desktop bridge as-is. */
  channelId: string;
}

/**
 * Per-channel "Agent folder" control — desktop-only. The responding agent's
 * working directory (context + default cwd, NOT a sandbox) is otherwise reachable
 * only from the menu-bar tray, which operators couldn't find. This surfaces it in
 * the channel header: it shows the current folder and offers "Change folder…" /
 * "Use default".
 *
 * It renders NOTHING in a plain browser — the folder is a local machine concept,
 * and the native picker only exists in the desktop shell. Presence is
 * feature-detected on `window.dopl.channels.chooseFolder` (set after mount to stay
 * hydration-safe). The bridge only ever returns an abbreviated label
 * ("~/Downloads/repo"); the absolute path never reaches this web page.
 */
export function ChannelFolderControl({ channelId }: Props) {
  const [bridge, setBridge] = useState<DoplChannelsBridge | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Feature-detect after mount (window-only) so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopChannelFolders());
  }, []);

  // Load the current label on mount and whenever the channel changes.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getFolderLabel(channelId)
      .then((next) => {
        if (alive) setLabel(next);
      })
      .catch(() => {
        if (alive) setLabel(null);
      });
    return () => {
      alive = false;
    };
  }, [bridge, channelId]);

  const handleChange = useCallback(async () => {
    if (!bridge || busy) return;
    setOpen(false);
    setBusy(true);
    try {
      const next = await bridge.chooseFolder(channelId);
      setLabel(next);
    } catch {
      // Cancelled / failed picker — leave the shown label as-is.
    } finally {
      setBusy(false);
    }
  }, [bridge, busy, channelId]);

  const handleUseDefault = useCallback(async () => {
    if (!bridge || busy) return;
    setOpen(false);
    setBusy(true);
    try {
      await bridge.clearFolder(channelId);
      setLabel(null);
    } catch {
      // No-op: keep the current label if the reset failed.
    } finally {
      setBusy(false);
    }
  }, [bridge, busy, channelId]);

  // Plain browser (or an older desktop build without the folder API): render nothing.
  if (!bridge) return null;

  const hasCustom = !!label;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Agent folder"
        title={hasCustom ? `Agent folder: ${label}` : "Agent folder: Sandbox (default)"}
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
      >
        {hasCustom ? <FolderOpen size={16} /> : <Folder size={16} />}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="min-w-[248px]"
      >
        <p className="px-3 pb-0.5 pt-1.5 text-micro font-semibold uppercase tracking-wide text-text-muted">
          Agent folder
        </p>
        <p className="px-3 pb-1.5 text-caption leading-snug text-text-muted">
          Where this channel&apos;s agent runs on your Mac. Context, not a sandbox.
        </p>
        <div className="mx-3 mb-1 truncate rounded-[7px] border border-border-subtle bg-bg-inset px-2 py-1 text-caption text-text-secondary">
          {hasCustom ? label : "Sandbox (default)"}
        </div>
        <MenuItem
          icon={<FolderOpen size={14} />}
          description={busy ? "Opening picker…" : undefined}
          onSelect={handleChange}
        >
          Change folder…
        </MenuItem>
        {hasCustom && (
          <MenuItem icon={<Folder size={14} />} onSelect={handleUseDefault}>
            Use default
          </MenuItem>
        )}
      </Popover>
    </div>
  );
}
