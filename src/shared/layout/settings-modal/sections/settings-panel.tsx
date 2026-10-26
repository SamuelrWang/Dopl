"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { StatusPill } from "@/shared/ui/status-pill";

/**
 * THE PROFILE POPUP'S PANEL LANGUAGE, the identity look (docs/DESIGN-LANGUAGE.md): every pane is a
 * stack of flat sections, each a heading over `.white-card`s with hairline rows. The heading is
 * Overview's "Credit spend" face (`IDENTITY_NAME_TEXT`), not the 18px section heading.
 */

/** A pane: sections stacked a section's gap apart. */
export function SettingsPane({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

export function SettingsPanel({
  id,
  label,
  action,
  caption,
  children,
}: {
  id: string;
  label: string;
  action?: ReactNode;
  /** One quiet line under the heading (`SectionPanel`'s caption rule). */
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex min-h-5.5 items-center justify-between gap-2 px-1 pb-2">
        <h2 id={id} className={cn("truncate", IDENTITY_NAME_TEXT)}>
          {label}
        </h2>
        {action}
      </div>
      {caption && <p className="px-1 pb-2 text-caption text-text-muted">{caption}</p>}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** A white card in a section. */
export function SettingsCard({
  className,
  children,
  label,
}: {
  className?: string;
  children: ReactNode;
  /** Accessible name when the card is a region of its own. */
  label?: string;
}) {
  return (
    <section aria-label={label} className={cn("white-card p-3.5", className)}>
      {children}
    </section>
  );
}

/** A card of rows: hairline dividers, no row frames. */
export function SettingsRows({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} className="white-card divide-y divide-border-default px-3.5 py-1">
      {children}
    </ul>
  );
}

export function SettingsRow({
  leading,
  title,
  badge,
  meta,
  children,
}: {
  leading?: ReactNode;
  /** The row's name — text, or a control that stands in for it (an inline rename). */
  title: ReactNode;
  /** A status word after the name ("This computer"). */
  badge?: ReactNode;
  meta?: ReactNode;
  /** Trailing controls. */
  children?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-2.5">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 truncate text-body font-medium text-text-primary">{title}</div>
          {badge && <StatusPill className="shrink-0">{badge}</StatusPill>}
        </div>
        {meta && <div className="mt-0.5 truncate text-caption text-text-muted">{meta}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </li>
  );
}

/** Empty line inside a card. */
function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="py-2.5 text-caption text-text-muted">{children}</p>;
}

/** A rows list's loading line — one ghost row, the list's own height. */
export function SettingsRowsSkeleton() {
  return (
    <li className="py-2.5" aria-busy="true">
      <div className="h-8 animate-pulse rounded-lg bg-surface-raised-1" />
    </li>
  );
}

/** A rows list with nothing in it: the empty line, or the failure line when the read failed. */
export function SettingsRowsEmpty({ failed, children }: { failed?: ReactNode; children: ReactNode }) {
  return (
    <li>
      {failed ? (
        <p className="py-2.5 text-caption text-danger">{failed}</p>
      ) : (
        <SettingsEmpty>{children}</SettingsEmpty>
      )}
    </li>
  );
}

/** A row's text action — the popup kit's flat button; `danger` reddens on hover only. */
export function RowAction({
  danger,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        SMALL_TEXT_BUTTON,
        danger && "hover:text-danger",
        "disabled:opacity-50",
        className
      )}
    />
  );
}
