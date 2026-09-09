"use client";

import { useState } from "react";
import { Bot, ChevronRight, RotateCcw, User } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { Revision, RevisionDay } from "../types";
import { bundleOf, fieldLineOf, NO_VALUE } from "../lib/field-format";
import { isRestorable } from "../lib/restorable";
import { RevisionDiff } from "./revision-diff";

/**
 * **THE CHANGELOG LIST — the one recipe both changelog surfaces render**
 * (2026-09-09; `docs/DESIGN-SYSTEM.md › Changelog list`).
 *
 * Day-grouped rows, each `who · what · when`; an agent row carries the bot mark
 * and its session name. Expanding a row shows the WORD-LEVEL DIFF against the
 * previous revision OF THAT SAME RESOURCE, and offers Restore behind a
 * confirmation that NAMES THE DATE.
 *
 * ⚠ **ONE COMPONENT, TWO SURFACES.** The base page's Changelog section and an
 * entry's own history mount THIS, with different rows — a second list would be
 * two places for the day heading, the agent mark and the restore confirmation to
 * drift.
 *
 * ⚠ **THE PREVIOUS REVISION IS FOUND WITHIN THE LOADED LIST, PER RESOURCE, AND
 * A MISS IS AN HONEST EMPTY `before`.** On the base roll-up the row above a
 * given one usually belongs to a DIFFERENT entry, so "the row above" is the
 * wrong neighbour; and on the last loaded page there may be no previous revision
 * loaded at all. Diffing against the wrong body would be a picture of a change
 * that never happened, so the fallback shows the version as wholly new rather
 * than fetching a page nobody asked for.
 *
 * ⚠ **MINIMAL COPY** (Samuel's ruling, `docs/INVARIANTS.md` §5A's UI-copy rule):
 * a label and a control. No explainer paragraph about what a revision is.
 *
 * ⚠ **TWO ROW SHAPES, ONE LIST (2026-09-09, part 2).** A knowledge row is a
 * DOCUMENT snapshot and reads `who · what · path`; an ontology row is ONE FIELD
 * and reads `Field: before → after`. The shape is chosen from the PAYLOAD
 * (`../lib/field-format.ts › fieldLineOf`), never from a second list component —
 * the day heading, the agent mark, the restore confirmation and the paging are
 * the parts that must not drift, and they are the whole of this file.
 */

export interface ChangelogListProps {
  days: RevisionDay[];
  status: "loading" | "success" | "error";
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Owners/editors may restore; viewers get the diff and no button. */
  canRestore: boolean;
  /** `undefined` disables Restore for every row — the base roll-up spans
   *  several entries and a restore is addressed to ONE. */
  onRestore?: (revision: Revision) => Promise<void>;
  /** Display name per actor user id, when the surface has one. */
  actorNames?: Record<string, string>;
}

const OP_LABEL: Record<Revision["op"], string> = {
  create: "Created",
  edit: "Edited",
  section_edit: "Edited a section",
  rename: "Renamed",
  move: "Moved",
  delete: "Deleted",
  restore: "Restored",
};

/** ⚠ The day KEY is UTC (`../lib/group.ts`); this LABELS it and never
 *  re-derives it from a row's stamp, or the heading and its rows can disagree. */
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function timeLabel(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChangelogList({
  days,
  status,
  hasMore,
  isLoadingMore,
  onLoadMore,
  canRestore,
  onRestore,
  actorNames,
}: ChangelogListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Revision | null>(null);

  if (status === "loading") {
    return <p className="px-1 py-1 text-caption text-text-muted">Loading changelog…</p>;
  }
  if (status === "error") {
    return (
      <p className="px-1 py-1 text-caption text-text-muted">
        Couldn&apos;t load the changelog.
      </p>
    );
  }
  if (days.length === 0) {
    return <p className="px-1 py-1 text-caption text-text-muted">No changes yet.</p>;
  }

  const flat = days.flatMap((d) => d.revisions);
  const previousBodyOf = (revision: Revision): string => {
    const at = flat.indexOf(revision);
    for (let i = at + 1; i < flat.length; i++) {
      const candidate = flat[i];
      if (
        candidate.resourceType === revision.resourceType &&
        candidate.resourceId === revision.resourceId
      ) {
        return candidate.payload.body ?? "";
      }
    }
    return "";
  };

  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => (
        <section key={day.day} className="flex flex-col gap-0.5">
          <h4 className="px-1 text-label uppercase text-text-muted">
            {dayLabel(day.day)}
          </h4>
          {day.revisions.map((revision) => {
            const open = expanded === revision.id;
            const isAgent = revision.actor.kind === "agent";
            const field = fieldLineOf(revision);
            const bundle = bundleOf(revision);
            const bundleName = bundle.find((f) => f.label === "Name")?.value;
            const who =
              (revision.actor.userId && actorNames?.[revision.actor.userId]) ??
              (isAgent ? "Agent" : "Someone");
            return (
              <div key={revision.id} className="rounded-md">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : revision.id)}
                  className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-raised-1"
                >
                  <ChevronRight
                    size={13}
                    className={cn(
                      "flex-none text-text-muted transition-transform",
                      open && "rotate-90"
                    )}
                  />
                  {isAgent ? (
                    <Bot size={14} className="flex-none text-agent-on" aria-label="agent" />
                  ) : (
                    <User size={14} className="flex-none text-text-muted" aria-label="person" />
                  )}
                  <span className="truncate text-small text-text-primary">{who}</span>
                  {field ? (
                    /* ⚠ THE FIELD ROW — `Field: before → after`, which is the
                       whole point of a per-property timeline: the change is
                       READABLE without expanding the row. */
                    <span className="min-w-0 truncate text-caption text-text-secondary">
                      <span className="text-text-primary">{field.label}</span>
                      {": "}
                      <span className="text-text-muted line-through">{field.before}</span>
                      {" → "}
                      {field.after}
                    </span>
                  ) : (
                    <span className="truncate text-caption text-text-secondary">
                      {OP_LABEL[revision.op]}
                      {revision.payload.path ? ` · ${revision.payload.path}` : ""}
                      {bundleName ? ` · ${bundleName}` : ""}
                    </span>
                  )}
                  {/* ⚠ THE SESSION NAME IS THE GROUPING SIGNAL an agent's writes
                      carry — several rows in a row wearing one session ARE one
                      run of work. It is an attribution hint and never a claim
                      about permission. */}
                  {isAgent && revision.actor.agentSessionId ? (
                    <span className="truncate text-caption text-text-muted">
                      {revision.actor.agentSessionId}
                    </span>
                  ) : null}
                  <span className="ml-auto flex-none text-caption text-text-muted">
                    {timeLabel(revision.createdAt)}
                  </span>
                </button>

                {open ? (
                  <div className="flex flex-col gap-2 px-1 pb-2 pl-7">
                    {revision.summary ? (
                      <p className="text-caption text-text-secondary">{revision.summary}</p>
                    ) : null}
                    {field ? (
                      /* ⚠ THE SAME DIFF COMPONENT over the two RENDERED values,
                         not over two bodies — one diff palette for the app, and
                         a long text attribute still gets a word-level diff. */
                      <RevisionDiff
                        before={field.before === NO_VALUE ? "" : field.before}
                        after={field.after === NO_VALUE ? "" : field.after}
                      />
                    ) : bundle.length > 0 ? (
                      <dl className="flex flex-col gap-0.5">
                        {bundle.map((entry) => (
                          <div key={entry.label} className="flex gap-2 text-caption">
                            <dt className="w-28 shrink-0 truncate text-text-muted">
                              {entry.label}
                            </dt>
                            <dd className="min-w-0 truncate text-text-primary">
                              {entry.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <RevisionDiff
                        before={previousBodyOf(revision)}
                        after={revision.payload.body ?? ""}
                      />
                    )}
                    {/* ⚠ A REVISION WITH NOTHING TO WRITE BACK IS NOT RESTORABLE
                        and the button is absent rather than disabled — a folder
                        move, a base rename, an ontology ASSOCIATION or a
                        create/delete bundle has no snapshot to restore, and the
                        server refuses it with `REVISION_NOT_RESTORABLE`.
                        Offering a control that can only fail is worse than not
                        offering it. ⚠ THE PREDICATE IS THE SERVER'S OWN
                        (`../lib/restorable.ts`), so the button and the refusal
                        cannot disagree. */}
                    {canRestore && onRestore && isRestorable(revision) ? (
                      <button
                        type="button"
                        onClick={() => setConfirming(revision)}
                        className="flex w-fit items-center gap-1.5 text-caption text-text-secondary hover:text-text-primary"
                      >
                        <RotateCcw size={12} />
                        Restore
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="w-fit px-1 text-caption text-text-secondary hover:text-text-primary disabled:opacity-60"
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}

      {/* ⚠ A CONFIRMATION, SO `ConfirmDialog` — not `FormDialog`, which is for a
          dialog that COLLECTS INPUT (docs/DESIGN-SYSTEM.md › Popup forms). It
          NAMES THE DATE, because "Restore" over a list of near-identical rows is
          the one place a mis-click is invisible until the next read. ⚠ AND IT
          NAMES THE FIELD on an ontology row, for the same reason: a restore
          there moves ONE property and leaves every other one alone, which is a
          different act from writing a whole document back. */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming && fieldLineOf(confirming)
            ? `Restore ${fieldLineOf(confirming)?.label}`
            : "Restore this version"
        }
        description={confirming ? restoreMessage(confirming) : undefined}
        confirmLabel="Restore"
        onConfirm={async () => {
          if (confirming && onRestore) await onRestore(confirming);
          setConfirming(null);
        }}
      />
    </div>
  );
}

/**
 * The confirmation's sentence. ⚠ It states WHAT WILL CHANGE and what will not —
 * the date on both arms, and on a field restore the field's own name and its
 * prior value, because that is the whole of what the write does.
 */
function restoreMessage(revision: Revision): string {
  const when = dayLabel(new Date(revision.createdAt).toISOString().slice(0, 10));
  const field = fieldLineOf(revision);
  if (field) {
    return `This sets ${field.label} back to "${field.before}" as it stood on ${when}. Other fields are untouched, and the restore is added to the changelog as a new version.`;
  }
  return `This writes the version from ${when} back into the file. Nothing is deleted — the restore is added to the changelog as a new version.`;
}
