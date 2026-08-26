"use client";

/**
 * ONE KNOWLEDGE ENTRY, INSIDE THE CHANNEL'S KNOWLEDGE TAB — read for everyone
 * the lane admits, editable when the grant says `guest_write` (Home Knowledge
 * Panels M4, §5.5 / §3.4).
 *
 * ⚠ THE KNOWLEDGE FEATURE'S OWN ENTRY VIEW IS DELIBERATELY NOT REUSED, and the
 * reason is the milestone's one hard rule. `knowledge-v2/detail/entry-view.tsx`
 * mounts `knowledge/components/doc-pane.tsx`, which autosaves through
 * `PATCH /api/knowledge/entries/{id}` — a WORKSPACE route at the viewer default,
 * i.e. a 403 for the caller this tab exists to serve — and additionally opens a
 * presence channel and reads the current profile. Mounting it here would be a
 * surface issuing a request it will be refused on, on a timer, invisibly. What
 * the lane offers is one GET and one PUT, so this file is one GET and one PUT.
 *
 * ⚠ THE BODY IS MARKDOWN AND IS RENDERED BY `message-markdown.tsx`, the
 * transcript's own renderer: it LEXES to tokens and maps them to React
 * elements, so no HTML string is ever produced and none reaches the DOM as
 * markup. Entry bodies are authored by the other side of the channel; the
 * transcript already treats that class of string as untrusted, and this is the
 * same string from the same people.
 *
 * ⚠ IT PASSES AN EMPTY AUTHOR INDEX. `MessageMarkdown` tints `@handles` that
 * match the CHANNEL ROSTER, and a `@name` inside a knowledge base is not a
 * channel mention — tinting it would claim somebody was tagged in a room they
 * were not. `mentionsMe: false` for the same reason.
 */

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { FIELD_WELL } from "@/shared/ui/wells";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { CARD_BUTTON, TAB_ACTION } from "./bits";
import { MessageMarkdown } from "./message-markdown";
import {
  useChannelEntryWrite,
  useChannelKnowledgeEntry,
} from "./use-channel-knowledge";
import type { AuthorIndex } from "./view-model";

/** See the docblock — a knowledge body is tinted against nobody. */
const NO_AUTHORS: AuthorIndex = { currentUserId: "", byId: new Map() };

export function ChannelKnowledgeEntry({
  channelId,
  workspaceId,
  baseId,
  entryId,
  canEdit,
}: {
  channelId: string;
  workspaceId: string;
  /** The entry's base — the tree cache the save invalidates is keyed by it. */
  baseId: string;
  entryId: string;
  /**
   * Whether the lane will ACCEPT a PUT from this viewer — `grant.guestWrite`,
   * the same flag `assertGrantWritable` reads (`knowledge-lane.ts ›
   * canEditGranted`). ⚠ `false` draws no pen at all rather than a disabled one:
   * a control that cannot be used is a question the reader has to answer.
   */
  canEdit: boolean;
}) {
  const { entry, loading, failedToLoad } = useChannelKnowledgeEntry(
    channelId,
    entryId,
    workspaceId
  );
  const save = useChannelEntryWrite({ channelId, workspaceId });

  // `null` = reading. The buffer is seeded from the entry ONCE at the click and
  // is never synced back from the read, which would overwrite what is being
  // typed the moment the save's own reconcile lands.
  //
  // ⚠ NO CLEAR-ON-`entryId` EFFECT, AND NONE IS NEEDED: the caller mounts this
  // component under `key={entryId}` (`knowledge-tab.tsx`), so a different entry
  // is a different component with a fresh buffer. An effect would be both
  // redundant and a `react-hooks/set-state-in-effect` error in this tree; the
  // KEY is what makes the property structural instead of remembered.
  const [draft, setDraft] = useState<string | null>(null);

  if (!entry) {
    if (failedToLoad) {
      return (
        <p className="px-1 pt-4 text-center text-caption text-text-muted">
          Couldn&apos;t load this entry.
        </p>
      );
    }
    return (
      <p role="status" aria-busy={loading} className="sr-only">
        Loading entry
      </p>
    );
  }

  const submit = () => {
    if (draft === null) return;
    void save
      .mutateAsync({
        entryId,
        baseId,
        body: draft,
        // The CAS token, as the editor loaded it. A concurrent write answers
        // 412 and `onError` states it; the buffer is kept so nothing typed is
        // thrown away by a refusal.
        expectedVersion: entry.updatedAt,
      })
      .then(() => setDraft(null))
      .catch(() => {});
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-body font-semibold text-text-primary">
          {entry.title}
        </h3>
        {canEdit && draft === null && (
          <button
            type="button"
            onClick={() => setDraft(entry.body)}
            className={CARD_BUTTON}
          >
            Edit
          </button>
        )}
      </div>
      <p className="text-caption text-text-muted">
        Updated {formatRelativeTime(entry.updatedAt)}
      </p>

      {draft === null ? (
        entry.body.trim() === "" ? (
          <p className="text-caption text-text-muted">This entry is empty.</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <MessageMarkdown
              text={entry.body}
              index={NO_AUTHORS}
              mentionsMe={false}
              blockClassName="wrap-anywhere"
              textClassName="text-body text-text-secondary"
            />
          </div>
        )
      ) : (
        <>
          <textarea
            value={draft}
            disabled={save.pending}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Entry body"
            className={cn(
              FIELD_WELL,
              "min-h-[220px] w-full resize-none px-2.5 py-2 text-body text-text-primary outline-none"
            )}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={save.pending}
              className={CARD_BUTTON}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={save.pending}
              className={TAB_ACTION}
            >
              {save.pending ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
