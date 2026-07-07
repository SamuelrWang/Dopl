"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover, MenuItem } from "@/shared/ui/popover-menu";
import type { MemberRole, AssignableRole } from "../types";

// Shared kit avatar — re-exported so feature imports stay stable.
export { Avatar } from "@/shared/ui/avatar";

const ROLE_OPTIONS: Array<{
  value: AssignableRole;
  label: string;
  description: string;
}> = [
  { value: "admin", label: "Admin", description: "Full access, manage members + workspace" },
  { value: "member", label: "Member", description: "Use everything: KBs, skills, canvas" },
  { value: "viewer", label: "Viewer", description: "Read-only access" },
];

/**
 * Role pills — neutral system language: weight/emphasis carries rank,
 * not hue. Owner is the inverted ink chip; the rest step down through
 * the gray tiers.
 */
const ROLE_STYLE: Record<MemberRole, string> = {
  owner: "bg-surface-invert border-surface-invert text-text-on-invert",
  admin: "bg-bg-inset border-border-strong text-text-primary",
  member: "bg-surface-raised-2 border-border-default text-text-secondary",
  viewer: "border-dashed border-border-strong text-text-tertiary bg-transparent",
};

export function RolePill({ role }: { role: MemberRole }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-label uppercase tracking-wider",
        ROLE_STYLE[role]
      )}
    >
      {role}
    </span>
  );
}

/**
 * Editable role chip — only assignable roles (admin/member/viewer) appear
 * in the menu. Owner is excluded by the AssignableRole type. Click is
 * stopped from bubbling so it doesn't trigger row-level handlers.
 */
export function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: AssignableRole;
  onChange: (next: AssignableRole) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-label uppercase tracking-wider transition-colors",
          ROLE_STYLE[value],
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:border-border-highlight"
        )}
      >
        <span>{value}</span>
        {!disabled && <ChevronDown size={10} className="opacity-70" />}
      </button>
      <Popover open={open && !disabled} onClose={() => setOpen(false)} className="w-56">
        {ROLE_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.value}
            active={opt.value === value}
            showCheck
            description={opt.description}
            onSelect={() => {
              onChange(opt.value);
              setOpen(false);
            }}
          >
            {opt.label}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}

/** Lightweight dropdown for filter selects (built on the kit Popover). */
export function SelectFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-light flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-small text-text-primary"
      >
        <span>{current.label}</span>
        <ChevronDown size={11} className="text-text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right">
        {options.map((o) => (
          <MenuItem
            key={o.value}
            active={o.value === value}
            onSelect={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.label}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
