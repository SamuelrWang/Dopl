"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDesktopChannelFolders,
  type DoplChannelsBridge,
} from "@/shared/lib/desktop";

export interface ChannelFolderState {
  /**
   * The desktop folder bridge, or null in a plain browser (and on an older
   * desktop build without the folder API). Every consumer renders NOTHING when
   * it is null — the folder is a local machine concept and the native picker
   * only exists in the desktop shell.
   */
  bridge: DoplChannelsBridge | null;
  /** The channel's abbreviated folder label; null = the desktop default folder. */
  label: string | null;
  /** True while the native picker (or a reset) is in flight. */
  busy: boolean;
  /** Open the native picker and adopt the chosen folder's label. */
  choose: () => Promise<void>;
  /** Reset the channel to the default folder. */
  clear: () => Promise<void>;
}

/**
 * Shared per-channel working-folder state over the desktop bridge
 * (`window.dopl.channels`) — used by BOTH the channel-header folder control and
 * the pending-request card's "Runs in" row, so neither duplicates the
 * detect / load-label / pick dance.
 *
 * Presence is feature-detected AFTER mount (window-only) so SSR and the first
 * client render agree (hydration-safe): `bridge` is null on that first paint and
 * again forever in a plain browser. The bridge only ever hands back an
 * ABBREVIATED label ("~/Downloads/repo") — the absolute path never reaches the
 * web page. Reads only: nothing here writes to a realtime table (F-072).
 */
export function useChannelFolder(channelId: string): ChannelFolderState {
  const [bridge, setBridge] = useState<DoplChannelsBridge | null>(null);
  const [label, setLabel] = useState<string | null>(null);
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

  const choose = useCallback(async () => {
    if (!bridge || busy) return;
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

  const clear = useCallback(async () => {
    if (!bridge || busy) return;
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

  return { bridge, label, busy, choose, clear };
}
