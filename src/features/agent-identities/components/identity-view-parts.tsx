"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import styles from "./identity-view.module.css";

/**
 * The view popup's element vocabulary. Every tab is composed of these and nothing else, so the
 * tabs read as one surface: a labelled `Group`, a chip sized to its fact (`FactChip`), a `Fact`
 * in a grid, an `EventRow` with a second fact in the middle. Prose stays prose.
 */

/** The kit's dialog-field label face. */
const GROUP_LABEL = "text-label font-semibold uppercase tracking-wide text-text-secondary";

export function Group({
  label,
  hint,
  children,
}: {
  label: string;
  /** A quiet qualifier beside the label, never a sentence. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.group}>
      <h3 className={GROUP_LABEL}>
        {label}
        {hint && <span className="ml-1 font-normal normal-case text-text-muted">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

export function GroupPair({ children }: { children: ReactNode }) {
  return <div className={styles.pair}>{children}</div>;
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className={styles.chips}>{children}</div>;
}

export function Facts({ children }: { children: ReactNode }) {
  return <div className={styles.facts}>{children}</div>;
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className="truncate text-micro font-medium text-text-muted">{label}</span>
      <span className="min-w-0 break-words text-caption text-text-primary">{value}</span>
    </div>
  );
}

/** Rows separated by hairlines, not frames. */
export function Rows({ children }: { children: ReactNode }) {
  return <ul className={styles.rows}>{children}</ul>;
}

export function EventRow({
  lead,
  title,
  middle,
  trail,
}: {
  lead?: ReactNode;
  title: ReactNode;
  middle?: ReactNode;
  trail?: ReactNode;
}) {
  return (
    <li className={styles.row}>
      {lead}
      <span className={cn(styles.rowGrow, "truncate text-small text-text-primary")}>{title}</span>
      {middle && (
        <span className={cn(styles.rowGrow, "truncate text-caption text-text-muted")}>
          {middle}
        </span>
      )}
      {trail && <span className={styles.rowTrail}>{trail}</span>}
    </li>
  );
}

/** Text a person wrote. `quoted` = a standing order, not a disabled text box. */
export function Prose({ children, quoted }: { children: ReactNode; quoted?: boolean }) {
  return quoted ? (
    <blockquote className={cn(styles.quote, "text-small leading-relaxed text-text-secondary")}>
      {children}
    </blockquote>
  ) : (
    <p className="text-small leading-relaxed text-text-secondary">{children}</p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-caption text-text-muted">{children}</p>;
}
