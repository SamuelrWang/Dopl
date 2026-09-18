"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Crossfade } from "@/shared/ui/crossfade";
import type {
  KnowledgeBaseStats,
  KnowledgeEntry,
} from "../../../types";
import type { KbTeamRef, Selection } from "../types";
import { BaseOverview } from "./base-overview";
import { FileView } from "./file-view";
import { viewModel } from "./view-model";
import styles from "../knowledge-v2.module.css";

interface Props {
  selection: Selection;
  workspaceId: string;
  /** Controller-owned fetch: FULL body, not the tree's stripped copy. */
  openEntry: KnowledgeEntry | null;
  openEntryStatus: "idle" | "loading" | "success" | "error";
  refetchOpenEntry: () => void;
  /** Admin-only: kbId → teams granted, surfaced in the base info face. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** Per-base counters from the list response; info reads `storageBytes`
   *  from it. Absent = unknown, no bar. */
  baseStats?: Record<string, KnowledgeBaseStats>;
  /** Per-base storage cap in bytes, same response. */
  kbStorageLimit?: number | null;
  canEditBase: boolean;
  onTreeRefresh: (baseId: string) => void;
  /** Re-pull the base list after a name/description save. */
  onBaseSaved: () => void;
}

/** The token a base selection shows. Includes the id, so switching bases under
 *  a live mount is a swap and not a silent content change. */
const infoToken = (baseId: string) => `info:${baseId}`;
/** The token a file selection shows. `file:` is not a prefix of `info:` and
 *  vice versa, so the two branches below cannot claim each other's tokens. */
const fileToken = (entryId: string) => `file:${entryId}`;

/**
 * The detail column: one surface fading between two faces (ruling 2026-08-28).
 * A base selection shows the info face, which is the resting state, not a
 * placeholder for "no file picked yet"; a file selection shows the document.
 *
 * The fade is the shared `shared/ui/crossfade.tsx` primitive: it takes a render
 * function and hands back the token still ON SCREEN, which lags the selection by
 * one fade.
 *
 * Which is why `lastEntry` exists. `openEntry` belongs to the current selection,
 * so leaving a file nulls it while the outgoing face is still mounted, and the
 * document would render as a loading skeleton on the way out. The latch holds
 * the last fully loaded entry and is consulted only when the shown token names
 * it, so file A fades out as A and B fades in as a skeleton while its fetch is
 * out — the truth, not a stale body wearing B's name. Adjust-state-during-render
 * is deliberate here (`pages/knowledge/index.tsx › deepLinkResolved` is the
 * other case): an effect would land a frame late, during the fade it exists to
 * survive.
 */
export function DetailPanel({
  selection,
  workspaceId,
  openEntry,
  openEntryStatus,
  refetchOpenEntry,
  kbTeams,
  baseStats,
  kbStorageLimit,
  canEditBase,
  onTreeRefresh,
  onBaseSaved,
}: Props) {
  const [lastEntry, setLastEntry] = useState<KnowledgeEntry | null>(
    openEntry ?? null
  );
  if (openEntry && openEntry !== lastEntry) setLastEntry(openEntry);

  const token =
    selection.kind === "entry"
      ? fileToken(selection.entry.id)
      : infoToken(selection.base.id);

  return (
    // The divider is a utility and a `border-l` on THIS column, not a
    // `border-r` on the rail. The account palette skin (`src/app/globals.css` ›
    // THE ACCOUNT PALETTE SKIN) selects on the class name — a module rule
    // reading `--kv-border` is invisible to it — and widens exactly
    // `.border-l.border-border-default` to 2px; a `border-r` would take the
    // colour and miss the weight.
    <div className={cn(styles.detailPane, "border-l border-border-default")}>
      <Crossfade token={token} className={styles.detailFade}>
        {(shown) => {
          if (shown.startsWith("file:")) {
            const entryId = shown.slice("file:".length);
            // The body for this token, from the live fetch or the latch.
            const entry =
              openEntry?.id === entryId
                ? openEntry
                : lastEntry?.id === entryId
                  ? lastEntry
                  : null;
            return (
              <FileView
                key={entryId}
                base={selection.base}
                fullEntry={entry}
                status={openEntryStatus}
                workspaceId={workspaceId}
                onTreeRefresh={onTreeRefresh}
                onFocusRefetch={() => {
                  refetchOpenEntry();
                  onTreeRefresh(selection.base.id);
                }}
              />
            );
          }
          return (
            <div className={styles.infoBody}>
              <BaseOverview
                key={selection.base.id}
                base={selection.base}
                vm={viewModel({ kind: "base", base: selection.base })}
                workspaceId={workspaceId}
                canEdit={canEditBase}
                onSaved={onBaseSaved}
                teams={kbTeams?.[selection.base.id]}
                storageBytes={
                  baseStats?.[selection.base.id]?.storageBytes ?? null
                }
                storageLimit={kbStorageLimit ?? null}
              />
            </div>
          );
        }}
      </Crossfade>
    </div>
  );
}
