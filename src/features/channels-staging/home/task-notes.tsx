"use client";

/**
 * STAGING (round 4, 2026-10-26) — a task's NOTES: short entries agents (and people) leave on
 * the task, oldest first (face, name, time, text), then a pill composer that adds one as the
 * viewer, in memory (DESIGN-LANGUAGE §4 "Composer": full pill, hairline, round black send).
 * Notes, not chat: no reactions, replies or typing. No product counterpart yet.
 * CSS `ui-staging/staging.css › .uis-tkd-note*`.
 */

import { useState, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { IdentityFace } from "@/shared/ui/identity-face";
import type { ChannelMember } from "@/features/channels/types";
import type { StagingTaskNote } from "../data/staging-tasks";
import { actorFace } from "./task-list";

export function TaskNotes({
  notes,
  members,
  onAdd,
}: {
  notes: readonly StagingTaskNote[];
  members: readonly ChannelMember[];
  onAdd: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  };
  return (
    <section className="uis-tkd-section" aria-label="Notes">
      <h4 className="uis-tkd-section-title">
        Notes
        <span className="uis-tkd-section-count">{notes.length}</span>
      </h4>
      {notes.length > 0 && (
        <ol className="uis-tkd-notes">
          {notes.map((n) => {
            const f = actorFace(n.author, members);
            return (
              <li key={n.id} className="uis-tkd-note">
                <IdentityFace size={22} {...f} />
                <span className="uis-tkd-note-main">
                  <span className="uis-tkd-note-head">
                    <span className="uis-tkd-note-name">{f.name}</span>
                    <span className="uis-tkd-note-time">{formatRelativeTime(n.at)}</span>
                  </span>
                  <span className="uis-tkd-note-text">{n.text}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <form className="uis-tkd-composer" onSubmit={submit}>
        <input
          className="uis-tkd-input"
          aria-label="Add a note"
          placeholder="Add a note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="uis-tkd-send" aria-label="Post note" disabled={!draft.trim()}>
          <ArrowUp size={13} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
