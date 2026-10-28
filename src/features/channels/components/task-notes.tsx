"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { IdentityFace } from "@/shared/ui/identity-face";
import { ComposerInputRow } from "./composer-input";
import { TASK_SECTION_COUNT, TASK_SECTION_TITLE } from "./task-subtasks";
import type { TaskFaceOf } from "./task-faces";
import type { ChannelTaskNote } from "../types";

/** Notes agents and people leave on a task, oldest first, then the pill composer. Notes, not chat. */
export function TaskNotes({
  notes,
  truncated = false,
  faceOf,
  onAdd,
}: {
  notes: readonly ChannelTaskNote[];
  /** Older notes were left off the read. */
  truncated?: boolean;
  faceOf: TaskFaceOf;
  /** Resolves once the note landed; the draft stays until then. */
  onAdd: (body: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const body = draft.trim();
  const canPost = body.length > 0 && !posting;
  const post = () => {
    if (!canPost) return;
    setPosting(true);
    onAdd(body)
      .then(() => setDraft(""), () => undefined)
      .finally(() => setPosting(false));
  };

  return (
    <section aria-label="Notes" className="flex min-w-0 flex-col gap-2">
      <h4 className={TASK_SECTION_TITLE}>
        Notes
        <span className={TASK_SECTION_COUNT}>{notes.length}</span>
      </h4>
      {truncated && <p className="text-caption text-text-muted">Earlier notes are not shown</p>}
      {notes.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {notes.map((n) => {
            const face = faceOf(n.author);
            return (
              <li key={n.id} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
                <IdentityFace size="s" {...face} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-caption font-semibold text-text-primary">{face.name}</span>
                    <span className="text-label text-text-muted">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </span>
                  <span className="whitespace-pre-wrap break-words text-body leading-[1.45] text-text-secondary">
                    {n.body}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <ComposerInputRow
        face="pill"
        value={draft}
        onChange={setDraft}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          post();
        }}
        placeholder="Add a note"
        ariaLabel="Add a note"
        onSend={post}
        sendDisabled={!canPost}
        sendTitle={canPost ? "Post note" : posting ? "Posting…" : "Write a note first"}
        sendLabel="Post note"
      />
    </section>
  );
}
