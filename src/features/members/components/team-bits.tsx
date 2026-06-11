"use client";

import { useState } from "react";
import { MoreHorizontal, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { AccessLevel } from "@/features/teams/access-levels";
import { DEFAULT_TEAM_COLOR, TEAM_COLORS } from "../constants";

/** Tinted chip with the team's color dot. Hex text on both themes is
 *  unreliable, so identity is carried by the tinted bg + dot only. */
export function TeamChip({
  name,
  color,
  onRemove,
  className,
}: {
  name: string;
  color: string | null;
  onRemove?: () => void;
  className?: string;
}) {
  const hex = color ?? DEFAULT_TEAM_COLOR;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-text-primary max-w-[140px]",
        className
      )}
      style={{ backgroundColor: `${hex}1f`, borderColor: `${hex}3d` }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: hex }}
      />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove from ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 text-text-secondary/60 hover:text-red-300 transition-colors cursor-pointer leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
}

/** Square color tile with the Users glyph — team cards + drawer headers. */
export function TeamColorTile({
  color,
  size = "md",
}: {
  color: string | null;
  size?: "sm" | "md";
}) {
  const hex = color ?? DEFAULT_TEAM_COLOR;
  const dim = size === "sm" ? "h-6 w-6 rounded-md" : "h-8 w-8 rounded-lg";
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center", dim)}
      style={{ backgroundColor: `${hex}26` }}
    >
      <Users size={size === "sm" ? 12 : 15} style={{ color: hex }} />
    </span>
  );
}

const SCOPE_STYLE: Record<"edit" | "read" | "none", string> = {
  edit: "bg-emerald-500/10 border-emerald-600/30 text-emerald-700",
  read: "bg-sky-500/10 border-sky-600/25 text-sky-700",
  none: "border-dashed border-border-strong text-text-tertiary bg-transparent",
};

const SCOPE_LABEL: Record<"edit" | "read" | "none", string> = {
  edit: "Can edit",
  read: "Read only",
  none: "No access",
};

/** Read/edit/none pill — same base styling as RolePill. Interactive
 *  variant cycles none → read → edit on click (Access tab cells). */
export function ScopePill({
  level,
  onClick,
  disabled,
  className,
}: {
  level: AccessLevel | null;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const key = level ?? "none";
  const base = cn(
    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border whitespace-nowrap",
    SCOPE_STYLE[key],
    className
  );
  if (!onClick) {
    return <span className={base}>{SCOPE_LABEL[key]}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={cn(
        base,
        disabled
          ? "opacity-60 cursor-not-allowed"
          : "cursor-pointer hover:brightness-110 transition-all"
      )}
    >
      {SCOPE_LABEL[key]}
    </button>
  );
}

/** None / Read / Edit segmented control (team drawer + create flow). */
export function AccessLevelControl({
  value,
  onChange,
  disabled,
}: {
  value: AccessLevel | null;
  onChange: (next: AccessLevel | null) => void;
  disabled?: boolean;
}) {
  const segments: Array<{ key: AccessLevel | null; label: string }> = [
    { key: null, label: "None" },
    { key: "read", label: "Read" },
    { key: "edit", label: "Edit" },
  ];
  return (
    <div
      role="radiogroup"
      className="inline-flex items-center rounded-md border border-border-default overflow-hidden shrink-0"
    >
      {segments.map((seg) => {
        const active = value === seg.key;
        return (
          <button
            key={seg.label}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(seg.key)}
            className={cn(
              "px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors",
              active
                ? "bg-surface-selected text-text-primary"
                : "text-text-secondary/60 hover:text-text-primary hover:bg-surface-raised-2",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            )}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

/** Preset hex swatch row for the create/edit team flow. */
export function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {TEAM_COLORS.map((hex) => {
        const selected = value === hex;
        return (
          <button
            key={hex}
            type="button"
            aria-label={`Color ${hex}`}
            aria-pressed={selected}
            onClick={() => onChange(hex)}
            className={cn(
              "h-7 w-7 rounded-full cursor-pointer transition-transform",
              selected && "ring-2 ring-offset-2 ring-offset-modal-surface scale-105"
            )}
            style={{
              backgroundColor: hex,
              ...(selected ? { ["--tw-ring-color" as string]: hex } : {}),
            }}
          />
        );
      })}
    </div>
  );
}

/** House-pattern kebab menu (fixed click-trap + absolute popover). */
export function KebabMenu({
  items,
  ariaLabel = "More actions",
}: {
  items: Array<{ label: string; onSelect: () => void; destructive?: boolean }>;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary/60 hover:text-text-primary hover:bg-surface-raised-2 transition-colors cursor-pointer"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 min-w-[150px] rounded-md border border-border-default bg-[var(--bg-inset-hover)] shadow-[var(--shadow-elevated)] py-1 z-20"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors",
                  item.destructive
                    ? "text-red-300 hover:bg-red-500/10"
                    : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
