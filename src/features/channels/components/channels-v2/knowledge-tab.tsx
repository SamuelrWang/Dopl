"use client";

/**
 * Channels v2 — the right panel's KNOWLEDGE tab: the knowledge bases shared
 * INTO this channel, browsable down to one entry (Home Knowledge Panels M4,
 * plan §5.5).
 *
 * ⚠ ONE COMPONENT, BOTH SIDES, AND THAT IS THE POINT OF THE MILESTONE. The
 * operator sees this on /home (`pages/home/relationship-record.tsx`) and a
 * link-claimed guest sees it on `/c/[workspaceId]` — the SAME reads, so
 * "what does the guest see in this channel" is answered by looking at it rather
 * than by reasoning about a second surface. It is possible only because every
 * read here is on the guest-floored channel lane (`knowledge-lane.ts`), whose
 * gate is a `(knowledge_base, channel)` grant row and not a workspace role.
 *
 * ⚠ IT SHOWS `visible` GRANTS ONLY, and does so by construction: the lane's
 * list route filters `agent_only` out in SQL, so a row for the operator's
 * agent-only base never enters this process. There is nothing here to hide and
 * no "shared with your agent" state to render — that story belongs to the
 * workspace knowledge page, which is where the grant is authored.
 *
 * ⚠ READ-ONLY UNLESS THE GRANT SAYS OTHERWISE. `guestWrite` on the grant is the
 * only thing that draws a pen, on either side (`knowledge-lane.ts ›
 * canEditGranted`) — it is the exact flag the lane's PUT gate reads, so the tab
 * cannot offer a save the server would refuse.
 *
 * ⚠ NO CREATE, NO FOLDERS, NO DELETE, NO MOVE (Samuel's ruling 3). The lane's
 * write schema is `.strict()` over `{body?, title?, expectedVersion?}`; a
 * control for anything else here would be a control with no route behind it.
 */

import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CARD_BUTTON, PANEL_CARD, SectionHeader } from "./bits";
import { ChannelKnowledgeEntry } from "./knowledge-entry";
import { canEditGranted } from "./knowledge-lane";
import {
  useChannelKnowledgeBases,
  useChannelKnowledgeTree,
} from "./use-channel-knowledge";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";

export function ChannelKnowledgeTab({
  channelId,
  workspaceId,
}: {
  channelId: string;
  workspaceId: string;
}) {
  const { data, loading, failedToLoad, refetch } = useChannelKnowledgeBases(
    channelId,
    workspaceId
  );
  // ⚠ THE POSITION CARRIES THE CHANNEL IT BELONGS TO. The surface is NOT
  // remounted between channels (the workspace page swaps the `channel` prop
  // under one mounted surface), so a bare `baseId` would survive the switch and
  // leave the reader inside the previous channel's base — whose ids the new
  // channel's lane answers 404 for.
  //
  // ⚠ RESET DURING RENDER, not in an effect — the same sanctioned
  // derive-state-from-props adjustment `info-panel.tsx` uses for its dead
  // selection (the render restarts before committing). An effect would paint one
  // frame of the wrong channel's contents first, and
  // `react-hooks/set-state-in-effect` is an ERROR in this tree for that reason.
  const [at, setAt] = useState<{
    channelId: string;
    baseId: string | null;
    entryId: string | null;
  }>({ channelId, baseId: null, entryId: null });
  const here = at.channelId === channelId ? at : null;
  if (here === null) setAt({ channelId, baseId: null, entryId: null });

  const openEntryId = here?.entryId ?? null;
  const openBaseId = here?.baseId ?? null;
  const setOpenBaseId = (baseId: string | null) =>
    setAt({ channelId, baseId, entryId: null });
  const setOpenEntryId = (entryId: string | null) =>
    setAt((prev) => ({ ...prev, channelId, entryId }));

  const openBase = data.bases.find((b) => b.id === openBaseId) ?? null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {openBase === null ? (
        <BaseList
          bases={data.bases}
          loading={loading}
          failedToLoad={failedToLoad}
          onRetry={() => void refetch()}
          onOpen={setOpenBaseId}
        />
      ) : (
        <>
          <BackRow
            label={openEntryId === null ? "Shared knowledge" : openBase.name}
            onBack={() =>
              openEntryId === null ? setOpenBaseId(null) : setOpenEntryId(null)
            }
          />
          {openEntryId === null ? (
            <BaseContents
              channelId={channelId}
              workspaceId={workspaceId}
              baseId={openBase.id}
              baseName={openBase.name}
              onOpenEntry={setOpenEntryId}
            />
          ) : (
            <ChannelKnowledgeEntry
              // ⚠ KEYED BY THE ENTRY. The view holds an unsaved edit buffer, and
              // a key is what guarantees a different entry is a different
              // component rather than the same one being told to forget — which
              // is a rule somebody has to remember, in a file they are not
              // editing.
              key={openEntryId}
              channelId={channelId}
              workspaceId={workspaceId}
              baseId={openBase.id}
              entryId={openEntryId}
              canEdit={canEditGranted(data.grants, openBase.id)}
            />
          )}
        </>
      )}
    </div>
  );
}

/** One step back up — to the base from an entry, to the list from a base. */
function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 flex min-w-0 cursor-pointer items-center gap-1 text-caption text-text-secondary transition-colors hover:text-text-primary"
    >
      <ChevronLeft aria-hidden size={13} className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function BaseList({
  bases,
  loading,
  failedToLoad,
  onRetry,
  onOpen,
}: {
  bases: readonly KnowledgeBase[];
  loading: boolean;
  failedToLoad: boolean;
  onRetry: () => void;
  onOpen: (baseId: string) => void;
}) {
  if (failedToLoad && bases.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 pt-4">
        <p className="text-caption text-text-muted">
          Couldn&apos;t load shared knowledge.
        </p>
        <button type="button" onClick={onRetry} className={CARD_BUTTON}>
          Try again
        </button>
      </div>
    );
  }
  if (loading && bases.length === 0) {
    return (
      <p role="status" aria-busy="true" className="sr-only">
        Loading shared knowledge
      </p>
    );
  }
  if (bases.length === 0) {
    // ⚠ ONE SENTENCE, and it states the FACT rather than an instruction: a
    // guest cannot share anything into this channel, so "share one to get
    // started" would be advice for the wrong reader (minimal-copy ruling).
    return (
      <p className="px-1 pt-4 text-center text-caption text-text-muted">
        Nothing has been shared into this channel yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {bases.map((base) => (
        <div key={base.id} className={PANEL_CARD}>
          <span className="min-w-0 truncate text-body font-semibold text-text-primary">
            {base.name}
          </span>
          {base.description && (
            <span className="min-w-0 text-caption text-text-secondary">
              {base.description}
            </span>
          )}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => onOpen(base.id)}
              className={CARD_BUTTON}
            >
              Open
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** One base's entries, grouped under the folder they live in. */
function BaseContents({
  channelId,
  workspaceId,
  baseId,
  baseName,
  onOpenEntry,
}: {
  channelId: string;
  workspaceId: string;
  baseId: string;
  baseName: string;
  onOpenEntry: (entryId: string) => void;
}) {
  const { tree, loading, failedToLoad } = useChannelKnowledgeTree(
    channelId,
    baseId,
    workspaceId
  );
  const groups = useMemo(
    () => groupEntries(tree?.folders ?? [], tree?.entries ?? []),
    [tree]
  );

  if (tree === null) {
    if (failedToLoad) {
      return (
        <p className="px-1 pt-4 text-center text-caption text-text-muted">
          Couldn&apos;t load this knowledge base.
        </p>
      );
    }
    return (
      <p role="status" aria-busy={loading} className="sr-only">
        Loading knowledge base
      </p>
    );
  }

  return (
    <>
      <h3 className="mb-1 min-w-0 truncate text-body font-semibold text-text-primary">
        {baseName}
      </h3>
      {groups.length === 0 ? (
        <p className="px-1 pt-4 text-center text-caption text-text-muted">
          This knowledge base is empty.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.path} className="flex flex-col">
            {group.path !== "" && (
              <SectionHeader title={group.path} className="px-0" />
            )}
            <div className="flex flex-col gap-2">
              {group.entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onOpenEntry(entry.id)}
                  className={cn(
                    PANEL_CARD,
                    "cursor-pointer items-start text-left transition-colors hover:border-border-highlight"
                  )}
                >
                  <span className="min-w-0 truncate text-body font-medium text-text-primary">
                    {entry.title}
                  </span>
                  {entry.excerpt && (
                    <span className="min-w-0 text-caption text-text-secondary">
                      {entry.excerpt}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}

interface EntryGroup {
  /** The folder's FULL path, `""` for the base's root. */
  path: string;
  entries: KnowledgeEntry[];
}

/**
 * Entries grouped under their folder, root first.
 *
 * ⚠ THE HEADING IS THE FOLDER'S FULL PATH, NOT ITS NAME. The lane hands back
 * FLAT arrays and this tab draws a flat list — two folders called "Notes" under
 * different parents would otherwise be one indistinguishable heading, or worse,
 * two identical ones. Joining the parent chain is the cheap way to keep the
 * grouping honest without building a tree control in a 380px column.
 *
 * ⚠ AN ENTRY WHOSE FOLDER IS MISSING FROM THE PAYLOAD FALLS TO THE ROOT rather
 * than disappearing: the tab's job is to show what was shared, and a dropped
 * row is the one failure a reader cannot see.
 */
export function groupEntries(
  folders: readonly KnowledgeFolder[],
  entries: readonly KnowledgeEntry[]
): EntryGroup[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (folderId: string | null): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cursor = folderId;
    // The `seen` guard is not decoration: a cycle in the payload would hang the
    // render, and this walk runs over data the client did not build.
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const folder = byId.get(cursor);
      if (!folder) break;
      parts.unshift(folder.name);
      cursor = folder.parentId;
    }
    return parts.join(" / ");
  };

  const groups = new Map<string, KnowledgeEntry[]>();
  for (const entry of entries) {
    const path = pathOf(entry.folderId);
    const bucket = groups.get(path);
    if (bucket) bucket.push(entry);
    else groups.set(path, [entry]);
  }
  return [...groups.entries()]
    .map(([path, list]) => ({ path, entries: list }))
    .sort((a, b) =>
      a.path === "" ? -1 : b.path === "" ? 1 : a.path.localeCompare(b.path)
    );
}
