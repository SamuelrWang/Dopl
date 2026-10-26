"use client";

import { useState } from "react";
import { Bot, ChevronDown, History, RotateCcw } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { EmptyState } from "@/shared/ui/empty-state";
import { IdentityFace } from "@/shared/ui/identity-face";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import type { Revision, RevisionDay } from "../types";
import { bundleOf, fieldLineOf, NO_VALUE } from "../lib/field-format";
import { isRestorable } from "../lib/restorable";
import { RevisionDiff } from "./revision-diff";

/**
 * **THE CHANGELOG LIST — the one recipe both changelog surfaces render**
 * (2026-09-09; `docs/DESIGN-SYSTEM.md › Changelog list`).
 *
 * One white card, day-grouped, hairline rows. Each row is the writer's FACE
 * (Samuel, 2026-10-01: the profile image of the user who did the change; an
 * agent row is its OPERATOR's face with a small bot badge, plus its session
 * name), then one caption line `who · time` over the change itself. Expanding a
 * row shows the WORD-LEVEL DIFF against the previous revision OF THAT SAME
 * RESOURCE, and offers Restore behind a confirmation that NAMES THE DATE.
 *
 * ⚠ **TWO ROW SHAPES, ONE LIST** (2026-09-09, part 2): a knowledge row is a
 * DOCUMENT snapshot reading `what · path`, an ontology row is ONE FIELD reading
 * `Field: before → after`, and the shape is chosen from the PAYLOAD
 * (`../lib/field-format.ts › fieldLineOf`) — never by a second list component.
 *
 * ⚠ **THE PREVIOUS REVISION IS FOUND WITHIN THE LOADED LIST, PER RESOURCE, AND
 * A MISS IS AN HONEST EMPTY `before`.** On a roll-up the row above usually
 * belongs to a DIFFERENT resource, and on the last loaded page there may be no
 * previous revision at all; diffing against the wrong body would picture a change
 * that never happened.
 *
 * ⚠ **MINIMAL COPY** (Samuel's ruling, `docs/INVARIANTS.md` §5A): a label and a
 * control, no explainer paragraph.
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
  /** `false` drops the list's own white card, for a host that is already one (the
   *  ontology object panel). */
  framed?: boolean;
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

const FACE = 22;

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
  framed = true,
}: ChangelogListProps) {
  const card = framed ? "white-card px-3.5" : "";
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Revision | null>(null);

  if (status === "loading") {
    return (
      <div className={cn(card, "py-2.5")} role="status" aria-busy="true">
        <span className="sr-only">Loading changelog</span>
        <div className="h-8 animate-pulse rounded-lg bg-surface-raised-1" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <p className={cn(card, "py-2.5 text-caption text-danger")}>
        Couldn&apos;t load the changelog.
      </p>
    );
  }
  if (days.length === 0) {
    return <EmptyState variant="well" icon={History} title="No changes yet" />;
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
    <div className="flex flex-col gap-2">
      <div className={card}>
        {days.map((day) => (
          <section
            key={day.day}
            className="border-t border-border-default pt-2.5 first:border-t-0"
          >
            <h4 className="text-caption font-medium text-text-muted">{dayLabel(day.day)}</h4>
            <ul>
              {day.revisions.map((revision) => {
                const open = expanded === revision.id;
                const isAgent = revision.actor.kind === "agent";
                const field = fieldLineOf(revision);
                const bundle = bundleOf(revision);
                const bundleName = bundle.find((f) => f.label === "Name")?.value;
                const who = revision.actor.displayName || (isAgent ? "Agent" : "Someone");
                return (
                  <li
                    key={revision.id}
                    className="border-t border-border-subtle first:border-t-0"
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : revision.id)}
                      className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-raised-1"
                    >
                      <ActorFace revision={revision} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-1.5 text-caption text-text-muted">
                          <span className="truncate font-medium text-text-primary">{who}</span>
                          {/* ⚠ THE SESSION NAME GROUPS an agent's writes — several rows
                              wearing one session ARE one run of work. An attribution
                              hint, never a claim about permission. */}
                          {isAgent && revision.actor.agentSessionId ? (
                            <span className="truncate">{revision.actor.agentSessionId}</span>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <span className="flex-none">{timeLabel(revision.createdAt)}</span>
                        </span>
                        {field ? (
                          /* ⚠ THE FIELD ROW — READABLE without expanding, which is
                             the whole point of a per-property timeline. */
                          <span className="min-w-0 truncate text-body text-text-secondary">
                            <span className="text-text-primary">{field.label}</span>
                            {": "}
                            <span className="text-text-muted line-through">{field.before}</span>
                            {" → "}
                            {field.after}
                          </span>
                        ) : (
                          <span className="min-w-0 truncate text-body text-text-primary">
                            {OP_LABEL[revision.op]}
                            {revision.payload.path ? (
                              <span className="text-text-secondary">{` · ${revision.payload.path}`}</span>
                            ) : null}
                            {bundleName ? (
                              <span className="text-text-secondary">{` · ${bundleName}`}</span>
                            ) : null}
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className={cn(
                          "mt-1 flex-none text-text-muted transition-transform group-hover:text-text-primary",
                          open && "rotate-180"
                        )}
                      />
                    </button>

                    {open ? (
                      <div className="flex flex-col gap-2 pb-3 pl-8">
                        {revision.summary ? (
                          <p className="text-caption text-text-secondary">{revision.summary}</p>
                        ) : null}
                        {field ? (
                          /* ⚠ THE SAME DIFF COMPONENT, over the two RENDERED values
                             rather than two bodies — one diff palette for the app. */
                          <RevisionDiff
                            before={field.before === NO_VALUE ? "" : field.before}
                            after={field.after === NO_VALUE ? "" : field.after}
                          />
                        ) : bundle.length > 0 ? (
                          <dl className="card-well flex flex-col gap-1 px-3 py-2">
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
                        {/* ⚠ NOTHING TO WRITE BACK ⇒ ABSENT, not disabled: a folder
                            move, a base rename, an ontology ASSOCIATION or a
                            create/delete bundle has no snapshot, and offering a
                            control that can only fail is worse than not offering it.
                            ⚠ THE PREDICATE IS THE SERVER'S OWN
                            (`revisions/lib/restorable.ts`), so the button and the refusal
                            cannot disagree. */}
                        {canRestore && onRestore && isRestorable(revision) ? (
                          <button
                            type="button"
                            onClick={() => setConfirming(revision)}
                            className={cn(pillButton("outline", "md"), "self-start")}
                          >
                            <RotateCcw size={PILL_ICON.md} aria-hidden="true" />
                            Restore
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className={cn(SMALL_TEXT_BUTTON, "self-start disabled:opacity-60")}
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}

      {/* ⚠ A CONFIRMATION, SO `ConfirmDialog` — `FormDialog` is for a dialog that
          COLLECTS INPUT (docs/DESIGN-SYSTEM.md › Popup forms). It NAMES THE DATE
          because a mis-click over near-identical rows is invisible until the next
          read, and NAMES THE FIELD on an ontology row because that restore moves
          ONE property and leaves the rest alone. */}
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
 * The writer's face: their profile picture, or initials (`IdentityFace`, a
 * person's plain photo on a hairline). ⚠ AN AGENT ROW IS ITS OPERATOR'S FACE —
 * `actor.userId` is the user the agent acted for — with a small bot badge, so
 * "who" and "by an agent" both read at a glance and never as two people.
 */
function ActorFace({ revision }: { revision: Revision }) {
  const { actor } = revision;
  return (
    <span className="relative flex-none">
      <IdentityFace size={FACE} photo={actor.avatarUrl} name={actor.displayName} />
      {actor.kind === "agent" ? (
        <span
          role="img"
          aria-label="agent"
          className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-cta text-text-on-cta"
        >
          <Bot size={9} aria-hidden />
        </span>
      ) : null}
    </span>
  );
}

/** The confirmation's sentence. ⚠ It states WHAT WILL CHANGE and what will not:
 *  the date on both arms, plus the field's name and prior value on a field
 *  restore. */
function restoreMessage(revision: Revision): string {
  const when = dayLabel(new Date(revision.createdAt).toISOString().slice(0, 10));
  const field = fieldLineOf(revision);
  if (field) {
    return `This sets ${field.label} back to "${field.before}" as it stood on ${when}. Other fields are untouched, and the restore is added to the changelog as a new version.`;
  }
  return `This writes the version from ${when} back into the file. Nothing is deleted — the restore is added to the changelog as a new version.`;
}
