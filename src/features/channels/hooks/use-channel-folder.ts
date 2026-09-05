"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDesktopChannelFolders,
  type ChannelFolderAnswer,
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
  /**
   * THE EFFECTIVE WORKING DIRECTORY, abbreviated — where this channel's agent will
   * actually run. `null` only before the first answer lands, and forever in a plain
   * browser; on the desktop it is always a real directory (2026-09-05, task 15).
   *
   * ⚠ IT NO LONGER MEANS "IS A CUSTOM FOLDER SET" — that is {@link custom}. This
   * field carried both facts, and the consumer had to invent a name for the null:
   * the Settings row printed "Sandbox (default)", naming a place that does not
   * exist. Main answers where the agent really runs; nothing here guesses.
   */
  label: string | null;
  /**
   * A PER-CHANNEL FOLDER IS SET, as opposed to the desktop's own default. It gates
   * the reset control, which is the only question that ever needed the old null.
   * ⚠ False until the first answer lands — failing toward "no reset offered" is the
   * correct direction while the answer is outstanding.
   */
  custom: boolean;
  /** True while the native picker (or a reset) is in flight. */
  busy: boolean;
  /** Open the native picker and adopt the chosen folder's label. */
  choose: () => Promise<void>;
  /** Reset the channel to the default folder. */
  clear: () => Promise<void>;
}

/**
 * Per-channel working-folder state over the desktop bridge
 * (`window.dopl.channels`) — the detect / load-label / pick dance, in one place.
 *
 * ⚠ IT HAS EXACTLY ONE CONSUMER TODAY: the Settings tab's Agent-folder row
 * (`channels-v2/settings-agent.tsx › ChannelAgentSettings`). Verify before
 * assuming otherwise — `grep -rn 'useChannelFolder' src apps`. It was shared
 * twice and is no longer: a header POPOVER (`channel-folder-control.tsx`) went
 * on 2026-08-19 for the tab's inline row, and the launch panel's folder pill
 * (`components/request-folder-row.tsx`) went on 2026-08-20 with the single-use
 * permission arm, whose disclosure was the only thing that mounted it. The hook
 * is unchanged across both deletions, and `clear()` still has a caller.
 *
 * ⚠ IT STAYS A HOOK RATHER THAN BEING INLINED into its one caller because the
 * bridge dance is the part that has to stay hydration-safe, and folding it into
 * a view component is how the after-mount detect below gets "simplified" into a
 * render-time read.
 *
 * Presence is feature-detected AFTER mount (window-only) so SSR and the first
 * client render agree (hydration-safe): `bridge` is null on that first paint and
 * again forever in a plain browser. The bridge only ever hands back an
 * ABBREVIATED label ("~/Downloads/repo") — the absolute path never reaches the
 * web page. Reads only: nothing here writes to a realtime table (F-072).
 */
export function useChannelFolder(channelId: string): ChannelFolderState {
  const [bridge, setBridge] = useState<DoplChannelsBridge | null>(null);
  /** ⚠ ONE PIECE OF STATE FOR THE PAIR, never two: `label` and `custom` are two
   *  halves of one answer main computes together, and splitting them into two
   *  setters is how a row comes to show one folder's name over the other's flag. */
  const [answer, setAnswer] = useState<ChannelFolderAnswer | null>(null);
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
        if (alive) setAnswer(next);
      })
      .catch(() => {
        if (alive) setAnswer(null);
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
      setAnswer(next);
    } catch {
      // Cancelled / failed picker — leave the shown answer as-is.
    } finally {
      setBusy(false);
    }
  }, [bridge, busy, channelId]);

  const clear = useCallback(async () => {
    if (!bridge || busy) return;
    setBusy(true);
    try {
      // ⚠ ADOPT THE ANSWER, NEVER ASSUME IT. This set `label` to null and called it
      // done, which is exactly the assumption that made the row print an invented
      // name: a reset lands the channel on a REAL default, and main is the only
      // thing that knows which one (`~/Downloads`, or the homedir when that is
      // missing). The reply now says so; taking it is how the row stays true.
      setAnswer(await bridge.clearFolder(channelId));
    } catch {
      // No-op: keep the current answer if the reset failed.
    } finally {
      setBusy(false);
    }
  }, [bridge, busy, channelId]);

  return {
    bridge,
    label: answer?.label ?? null,
    custom: answer?.custom ?? false,
    busy,
    choose,
    clear,
  };
}
