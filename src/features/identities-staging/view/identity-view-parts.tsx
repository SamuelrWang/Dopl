"use client";

/**
 * THE VIEW POPUP'S ELEMENT VOCABULARY (item 2e).
 *
 * ⚠ **2d SHIPPED FOUR TABS IN FOUR FORMATTING LANGUAGES AND SAMUEL REJECTED IT**: *"no
 * formatting… hodgepodge of random stuff"*, against the identity cards' *"very clear-cut
 * elements"*. The cause was not taste, it was that every tab invented its own shapes: full-width
 * bars on one, plain bullet lists on another, bordered boxes on a third.
 *
 * So the popup has FOUR elements and nothing else, and every tab is composed of them
 * (`Plans/UI Standing Rules`, Rule 4 (clear-cut elements)). Each one is individually legible and separated from its
 * neighbours by a label or a hairline, never by being a different shape than the thing above it.
 *
 * | Element | For | Width |
 * |---|---|---|
 * | {@link Group} | a labelled region; two of them sit side by side where their content is short | its column |
 * | {@link Chip} | one fact, read at a glance | **as wide as the fact** |
 * | {@link Fact} | a label above a value, in a grid of 2 or 3 | its grid cell |
 * | {@link EventRow} | something that happened or is happening: lead, a fact in the MIDDLE, a trail | the list, with the middle occupied |
 *
 * 🔒 **RULE 1, THE BLANK SPACE RULE, IS WHY THERE IS NO FULL-WIDTH BAR HERE.** 2d drew knowledge
 * and runtime as full-width bars: at 680px of popup body that is a 14px mark, nine
 * characters, and 600px of nothing. They are {@link Chip}s now, and the slack is filled by putting
 * the NEXT group beside them instead of under them.
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
// 🔒 The GEOMETRY lives in the module — the cache-invalidation instance of Rule 6 (prove the style
// exists) in `Plans/UI Standing Rules`.
// ⚠ RETRACTED REASON: this used to say "Tailwind 4's detection does not reach `identities-staging`".
// Disproved by a cold rebuild; it is false. The module is still correct, because module CSS
// compiles outside Tailwind's scan. The module header carries the measured mechanism.
import styles from "./identity-view.module.css";
// The card's own chip recipe, by import: one declaration for the grid and the popup.
// ⚠ Read-only dependency on another worker's file (boundary posted 2026-10-22).
import { IDENTITY_ROW } from "@/features/identities-staging/agent-identities/components/identity-section";

/** The group label — the kit's dialog-field face, 11px uppercase (`standard-dialog.tsx`). */
const GROUP_LABEL = "text-label font-semibold uppercase tracking-wide text-text-secondary";

/**
 * A LABELLED REGION. `hint` is the quiet qualifier the kit's `DialogField` puts beside a label
 * ("instructions", "3 not reachable"); it never becomes a sentence.
 */
export function Group({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(styles.group, className)}>
      <h3 className={GROUP_LABEL}>
        {label}
        {hint && <span className="ml-1 font-normal normal-case text-text-muted">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Two groups side by side — the Blank Space Rule's own fill: more content across the width, not wider boxes. */
export function GroupPair({ children }: { children: ReactNode }) {
  return <div className={styles.pair}>{children}</div>;
}

/** A wrapping run of {@link Chip}s. */
export function Chips({ children }: { children: ReactNode }) {
  return <div className={styles.chips}>{children}</div>;
}

/** ONE FACT, as wide as the fact. The card's chip, unchanged. */
export function Chip({ mark, children }: { mark?: ReactNode; children: ReactNode }) {
  return (
    <span className={IDENTITY_ROW}>
      {mark && <span className={cn(styles.mark, "text-text-muted")}>{mark}</span>}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** A grid of {@link Fact}s: three across, so short pairs fill the row instead of one per line. */
export function Facts({ children }: { children: ReactNode }) {
  return <div className={styles.facts}>{children}</div>;
}

/** A LABEL ABOVE A VALUE. The value may wrap; the label never does. */
export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className="truncate text-micro font-medium text-text-muted">{label}</span>
      <span className="min-w-0 break-words text-caption text-text-primary">{value}</span>
    </div>
  );
}

/** A list of {@link EventRow}s, separated by hairlines rather than by frames. */
export function Rows({ children }: { children: ReactNode }) {
  return <ul className={styles.rows}>{children}</ul>;
}

/**
 * SOMETHING THAT HAPPENED, OR IS HAPPENING.
 *
 * 🔒 **THE MIDDLE IS A SLOT, AND IT IS REQUIRED FOR A REASON.** The Blank Space Rule: a row whose content hugs
 * the left and whose right edge holds a timestamp is a row with a blank majority. So the second
 * fact (where it happened, which channel and thread it is in) sits in the MIDDLE rather than under
 * the title, and the row is three columns of content with nothing stretched between them.
 */
export function EventRow({
  lead,
  title,
  middle,
  trail,
}: {
  /** A face or a mark, 22px. */
  lead?: ReactNode;
  title: ReactNode;
  /** The fact that fills the slack. Omit ONLY when there genuinely is no second fact. */
  middle?: ReactNode;
  trail?: ReactNode;
}) {
  return (
    <li className={styles.row}>
      {lead}
      <span className={cn(styles.rowName, "truncate text-small text-text-primary")}>{title}</span>
      {middle && (
        <span className={cn(styles.rowMiddle, "truncate text-caption text-text-muted")}>
          {middle}
        </span>
      )}
      {trail && <span className={styles.rowTrail}>{trail}</span>}
    </li>
  );
}

/** Prose a human wrote: a description, a rule, a standing order. Text legitimately fills a width. */
export function Prose({ children, quoted }: { children: ReactNode; quoted?: boolean }) {
  if (quoted) {
    return (
      <blockquote className={cn(styles.quote, "text-small leading-relaxed text-text-secondary")}>
        {children}
      </blockquote>
    );
  }
  return <p className="text-small leading-relaxed text-text-secondary">{children}</p>;
}

/** One quiet line where a group has nothing to show. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-caption text-text-muted">{children}</p>;
}

/**
 * A STATE, as a chip (a tool's grant, a log row's permission). Never a control.
 *
 * ⚠ **NO `--bg-inset` (item 7's page-wide grey ban, Samuel: *"I don't like that gray color. I
 * actually want to not use that gray color at all"*).** `strong` is a hairline over the
 * near-white fill, the same surface every chip on this page wears; the quiet form carries no fill
 * at all, because a state that is the ordinary case does not need a box.
 */
export function StateChip({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={cn(
        "flex-none rounded-full px-2 py-0.5 text-micro font-medium",
        strong
          ? "border border-border-default bg-bg-elevated text-text-primary"
          : "text-text-muted"
      )}
    >
      {children}
    </span>
  );
}

/**
 * A LIST OF ONE-LINE STATEMENTS (rules, escalations). Each is its own line with its own mark,
 * never a paragraph — the clear-cut-elements rule: individually legible elements, not an unformatted run.
 */
export function Lines({ items, icon }: { items: ReadonlyArray<string>; icon: ReactNode }) {
  return (
    <ul className={styles.lines}>
      {items.map((item) => (
        <li key={item} className={cn(styles.line, "text-small leading-snug text-text-secondary")}>
          <span className={cn(styles.lineMark, "text-text-muted")} aria-hidden="true">
            {icon}
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
