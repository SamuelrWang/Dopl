"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Crossfade } from "@/shared/ui/crossfade";
import type {
  KnowledgeBaseStats,
  KnowledgeEntry,
} from "../../../types";
import type { BaseTree, KbTeamRef, Selection } from "../types";
import { BaseOverview } from "./base-overview";
import { FileView } from "./file-view";
import { viewModel } from "./view-model";
import styles from "../knowledge-v2.module.css";

interface Props {
  selection: Selection;
  workspaceId: string;
  /** Selected base's tree — feeds Contents with no extra fetch. */
  selectedTree?: BaseTree;
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

/** The token a BASE selection shows. ⚠ Includes the id, so switching bases
 *  under a live mount is a swap and not a silent content change. */
const infoToken = (baseId: string) => `info:${baseId}`;
/** The token a FILE selection shows. ⚠ `file:` is not a prefix of `info:` and
 *  vice versa, so the two branches below cannot claim each other's tokens. */
const fileToken = (entryId: string) => `file:${entryId}`;

/**
 * THE DETAIL COLUMN — ONE surface whose contents fade between two faces
 * (Samuel's ruling, 2026-08-28):
 *
 *   BASE selected → the INFO face, and it is the RESTING STATE. Opening a base
 *       lands here; it is not a placeholder for "no file picked yet".
 *   FILE selected → the document, arriving by a 150ms fade.
 *
 * ⚠ THE FADE IS THE SHARED PRIMITIVE (`shared/ui/crossfade.tsx`), the one
 * /home's record pane and the channel info column use — same 150ms, same
 * `prefers-reduced-motion` opt-out, one recipe. It takes a RENDER FUNCTION and
 * hands back the token still ON SCREEN, which lags the selection by one fade.
 *
 * 🔒 ⚠ WHICH IS WHY `lastEntry` EXISTS. `openEntry` belongs to the CURRENT
 * selection, so the moment a file is left it is already `null` — and the
 * outgoing face, still mounted for its 150ms, would render its document as a
 * loading skeleton on the way out. The latch holds the last FULLY LOADED entry
 * and is consulted only when the shown token names it, so:
 *   file → info: the outgoing document is still the document.
 *   file A → file B: A fades out AS A; B fades in as a skeleton if its fetch is
 *       still out — which is the truth, not a stale body wearing B's name.
 * ⚠ Adjust-state-during-render, the sanctioned form (`pages/knowledge/index.tsx
 * › deepLinkResolved` is the other one): an effect would land a frame late,
 * i.e. exactly during the fade it exists to survive.
 */
export function DetailPanel({
  selection,
  workspaceId,
  selectedTree,
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
    // ⚠ THE DIVIDER IS A UTILITY AND IT IS A `border-l` ON *THIS* COLUMN, not a
    // `border-r` on the rail — the two draw the same line and only one of them
    // is reachable. `pages/home/home.module.css › .frame` selects on the class
    // NAME (a module rule reading `--kv-border` is invisible to it), and its
    // second rule widens exactly `.border-l.border-border-default` to 2px, so
    // this lands on the account palette at the same weight as the channel
    // surface's info-column divider. A `border-r` would take the colour and
    // miss the weight, which is a hairline that matches nothing on either page.
    <div className={cn(styles.detailPane, "border-l border-border-default")}>
      <Crossfade token={token} className={styles.detailFade}>
        {(shown) => {
          if (shown.startsWith("file:")) {
            const entryId = shown.slice("file:".length);
            // The body for THIS token, from the live fetch or the latch —
            // never another file's.
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
                tree={selectedTree}
                onTreeRefresh={onTreeRefresh}
              />
            </div>
          );
        }}
      </Crossfade>
    </div>
  );
}
