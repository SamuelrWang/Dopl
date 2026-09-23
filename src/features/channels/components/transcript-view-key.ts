"use client";

/**
 * THE TRANSCRIPT'S VIEW KEY — one string naming WHAT IS BEING SHOWN, for the
 * cross-fade (Samuel, 2026-09-20; `fade-swap.tsx`).
 *
 * ⚠ **ITS OWN FILE AT §1's CAP**: `transcript-filter.tsx` sits at 500 lines and
 * this is a different reason to change anyway — that file owns what a filter IS
 * and how rows are dropped by one; this owns what counts as a different VIEW of
 * one, which is a question only the animation asks.
 */

import type { TranscriptFilter } from "./transcript-filter";

/**
 * **WHICH VIEW THE TRANSCRIPT IS SHOWING, AS ONE STRING** — the cross-fade's key
 * (Samuel, 2026-09-20; `fade-swap.tsx`).
 *
 * ⚠ **IT NAMES THE SELECTION AND NOTHING ELSE.** The agent ids are SORTED, so one
 * set cannot spell itself two ways and fade for nothing, and the ROWS are
 * deliberately absent: a key that moved when a message arrived would fade the
 * whole transcript on every realtime push, which is the opposite of the ask.
 * ⚠ **THE CHANNEL IS PART OF THE VIEW** because the filter is stored per channel
 * (`message-pane.tsx › filterByChannel`) — moving between rooms is a view change,
 * and without this two channels whose filters happen to match would swap with no
 * motion at all.
 * ⚠ **IT LIVES BESIDE THE FILTER, NOT IN THE PANE**: a view key derived at the
 * call site is a second statement of what a view is.
 */
export function transcriptFilterViewKey(
  channelId: string,
  filter: TranscriptFilter
): string {
  return `${channelId}:${filter.people ? "p" : "-"}:${[...filter.agentIds]
    .sort()
    .join(",")}`;
}

