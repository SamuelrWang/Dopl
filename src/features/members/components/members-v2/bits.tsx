"use client";

import type { ReactNode } from "react";
import { FileWarning, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import type { ActivityDot } from "@/shared/lib/format-time";
import type { MemberRole } from "../../types";

const DOT_STYLE: Record<ActivityDot, string> = {
  active: "bg-success",
  idle: "bg-surface-raised-4 ring-1 ring-border-default",
  invited: "bg-warning",
  deactivated: "bg-danger/60",
};

export function PresenceDot({ dot }: { dot: ActivityDot }) {
  return (
    <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_STYLE[dot])} />
  );
}

export const SECTION_CARD =
  "min-w-0 overflow-hidden rounded-[14px] border border-border-strong bg-bg-elevated";

/** Zebra striping on ODD rows so the first keeps the card fill. */
export const ZEBRA_ROW = "odd:bg-card-surface-subtle";

export function IconButton({
  icon: Icon,
  label,
  size = 14,
  onInvert = false,
  disabled,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  size?: number;
  onInvert?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        onInvert
          ? "text-text-on-invert/60 hover:bg-text-on-invert/10 hover:text-text-on-invert"
          : "text-text-muted hover:bg-surface-raised-1 hover:text-text-primary",
        className
      )}
    >
      <Icon size={size} />
    </button>
  );
}

export function ColumnLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </span>
  );
}

/** ⚠ Not `member-bits › RolePill`: on the inverted header that pill's owner face
 *  is ink on ink and its viewer face is a dashed hairline that vanishes. */
export function RolePillOnInvert({ role }: { role: MemberRole }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-text-on-invert/25 bg-text-on-invert/10 px-1.5 py-0.5 text-label uppercase tracking-wider text-text-on-invert">
      {role}
    </span>
  );
}

export function OwnerPill() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
      Owner
    </span>
  );
}

export function StateChip({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-caution/30 bg-caution/10 px-1.5 py-px text-micro font-medium text-caution">
      {label}
    </span>
  );
}

export function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4">
      <span className="text-label font-semibold uppercase tracking-wide text-text-on-invert/50">
        {label}
      </span>
      <span className="truncate text-body font-medium text-text-on-invert">{value}</span>
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0">
      <span className="w-[92px] shrink-0 text-caption text-text-secondary">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-body text-text-primary">
        {children}
      </span>
    </div>
  );
}

export function PaneHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-title font-semibold text-text-primary">{title}</h2>
      {subtitle && (
        <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">{subtitle}</p>
      )}
    </div>
  );
}

/** Query failed. Never a spinner — a skeleton that never resolves reads as a
 *  hang, and the caller cannot tell it from a slow network. */
export function PaneError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={FileWarning}
      title={title}
      description="Check your connection, then try again."
    >
      <button
        type="button"
        onClick={onRetry}
        className="btn-light rounded-md px-2.5 py-1 text-small font-medium text-text-primary"
      >
        Retry
      </button>
    </EmptyState>
  );
}
