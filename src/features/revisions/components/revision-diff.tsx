"use client";

import { useMemo } from "react";
import { diffBodies, diffStats } from "../lib/diff";

/**
 * The word-level diff of one revision against the one before it.
 *
 * ⚠ **TOKENS ONLY — no hex, no raw px** (docs/DESIGN-SYSTEM.md). Additions take
 * `bg-success/10`, removals `bg-danger/10` with a strike — the SAME two washes
 * `skills/components/skill-history-panel.tsx › DiffCell` already uses for the
 * skills version rail, taken by reference so the app has one diff palette. Both
 * keep `text-text-primary` so the diff is READ as prose rather than decoded as
 * colour, and the strike-through is the second channel for a reader who cannot
 * separate the two hues.
 *
 * ⚠ **`whitespace-pre-wrap` IS LOAD-BEARING**, not styling. `diffBodies` is
 * lossless — every span carries the whitespace that followed its word — so
 * collapsing whitespace here would silently reflow a markdown body and make the
 * diff describe a document nobody wrote.
 */
export function RevisionDiff({
  before,
  after,
}: {
  /** The PREVIOUS revision's body; `""` when this is the first. */
  before: string;
  after: string;
}) {
  const spans = useMemo(() => diffBodies(before, after), [before, after]);
  const stats = useMemo(() => diffStats(spans), [spans]);

  if (spans.length === 0) {
    return (
      <p className="px-1 py-1 text-caption text-text-muted">This version is empty.</p>
    );
  }
  if (stats.added === 0 && stats.removed === 0) {
    // ⚠ "NOTHING CHANGED" IS A FACT WORTH STATING. A save that changed only a
    // title or a folder still produces a revision, and rendering its body as a
    // wall of unchanged text would read as an edit that did nothing.
    return (
      <p className="px-1 py-1 text-caption text-text-muted">
        The body did not change in this version.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption text-text-muted">
        {stats.added} added · {stats.removed} removed
      </p>
      {/* ⚠ ITS OWN `overflow-x-auto`: a markdown body carries code blocks and
          long URLs, and the page body must never scroll sideways. */}
      <div className="max-h-64 overflow-auto rounded-md bg-bg-inset px-2 py-1.5">
        <p className="whitespace-pre-wrap break-words text-caption text-text-primary">
          {spans.map((span, i) =>
            span.kind === "same" ? (
              <span key={i}>{span.text}</span>
            ) : span.kind === "added" ? (
              <ins
                key={i}
                className="bg-success/10 no-underline"
                aria-label="added"
              >
                {span.text}
              </ins>
            ) : (
              <del key={i} className="bg-danger/10 line-through" aria-label="removed">
                {span.text}
              </del>
            )
          )}
        </p>
      </div>
    </div>
  );
}
