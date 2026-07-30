"use client";

import { useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { useChannelFolder } from "../hooks/use-channel-folder";

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
 * and the native picker only exists in the desktop shell. Detection, the current
 * label, and the picker call all come from {@link useChannelFolder} (shared with
 * the pending-request card's "Runs in" row). The bridge only ever returns an
 * abbreviated label ("~/Downloads/repo"); the absolute path never reaches this
 * web page.
 */
export function ChannelFolderControl({ channelId }: Props) {
  const { bridge, label, busy, choose, clear } = useChannelFolder(channelId);
  const [open, setOpen] = useState(false);

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
          onSelect={() => {
            setOpen(false);
            void choose();
          }}
        >
          Change folder…
        </MenuItem>
        {hasCustom && (
          <MenuItem
            icon={<Folder size={14} />}
            onSelect={() => {
              setOpen(false);
              void clear();
            }}
          >
            Use default
          </MenuItem>
        )}
      </Popover>
    </div>
  );
}
