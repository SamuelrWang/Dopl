"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { SectionPanel } from "@/shared/ui/section-panel";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";

/**
 * THE PROFILE POPUP'S PANEL LANGUAGE — /home Overview's, by reference (Samuel, 2026-09-28: the
 * popup pages "don't use our design system"). Every pane is a stack of `SectionPanel`s (the gray
 * well + 18px heading) holding white `.bento` cards, exactly `pages/home/overview-panels.tsx`.
 * ⚠ No header strips, no `SECTION_BOX_INSET` wells, no `bg-card-surface-subtle` / `bg-bg-inset`
 * fills: those were the popup's own and nothing on /home wears them.
 */

/** A pane: panels stacked with /home Overview's gap. */
export function SettingsPane({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
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
    <SectionPanel id={id} label={label} action={action} caption={caption}>
      <div className="flex flex-col gap-3">{children}</div>
    </SectionPanel>
  );
}

/** The white card inside a panel (`.bento`, Overview's card padding). */
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
    <section aria-label={label} className={cn("bento p-3.5", className)}>
      {children}
    </section>
  );
}

/** A card of rows: Overview's Recent-activity list (hairline dividers, no row frames). */
export function SettingsRows({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} className="bento divide-y divide-border-subtle px-3.5 py-1">
      {children}
    </ul>
  );
}

export function SettingsRow({
  leading,
  title,
  meta,
  children,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Trailing controls. */
  children?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-2.5">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-text-primary">{title}</div>
        {meta && <div className="mt-0.5 truncate text-caption text-text-muted">{meta}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </li>
  );
}

/** Empty line inside a card. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="py-2.5 text-caption text-text-muted">{children}</p>;
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
