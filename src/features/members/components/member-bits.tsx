"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { Member, MemberRole } from "../data";

const ROLE_OPTIONS: Array<{ value: MemberRole; label: string; description: string }> = [
  { value: "owner", label: "Owner", description: "Full workspace control + billing" },
  { value: "admin", label: "Admin", description: "Manage members + all resources" },
  { value: "manager", label: "Manager", description: "Lead a team, edit team resources" },
  { value: "member", label: "Member", description: "Standard contributor access" },
  { value: "viewer", label: "Viewer", description: "Read-only access to granted resources" },
];

/** Gradient avatar with first-initial fallback. */
export function Avatar({
  member,
  size = "sm",
  className,
}: {
  member: Member;
  size?: "xs" | "sm";
  className?: string;
}) {
  const dim = size === "xs" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-[12px]";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center font-semibold text-white bg-gradient-to-br",
        member.avatarGradient,
        dim,
        className
      )}
    >
      {member.initial}
    </span>
  );
}

const ROLE_STYLE: Record<MemberRole, string> = {
  owner: "bg-violet-500/15 border-violet-500/25 text-violet-200",
  admin: "bg-emerald-500/10 border-emerald-500/20 text-emerald-200",
  manager: "bg-amber-500/10 border-amber-500/20 text-amber-200",
  member: "bg-white/[0.04] border-white/[0.08] text-text-secondary",
  viewer: "bg-white/[0.03] border-white/[0.06] text-text-secondary/70",
};

export function RolePill({ role }: { role: MemberRole }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border",
        ROLE_STYLE[role]
      )}
    >
      {role}
    </span>
  );
}

/**
 * Editable role chip — looks like the pill but opens a popover so the
 * user can change it. Static UI: change is local state only, no API.
 * Click is stopped from bubbling so it doesn't trip the row-expand
 * toggle on the parent.
 */
export function RoleSelect({
  value,
  onChange,
}: {
  value: MemberRole;
  onChange: (next: MemberRole) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative inline-flex"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border cursor-pointer transition-colors",
          ROLE_STYLE[value],
          "hover:brightness-110"
        )}
      >
        <span>{value}</span>
        <ChevronDown size={10} className="opacity-70" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="listbox"
            className="absolute left-0 top-full mt-1 w-56 rounded-md border border-white/[0.1] bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 py-1 z-20"
          >
            {ROLE_OPTIONS.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 cursor-pointer transition-colors flex items-start gap-2",
                    active
                      ? "bg-white/[0.04]"
                      : "hover:bg-white/[0.04]"
                  )}
                >
                  <Check
                    size={11}
                    className={cn(
                      "mt-1 shrink-0",
                      active ? "text-violet-300" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] text-text-primary capitalize">
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-text-secondary/70 leading-snug">
                      {opt.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Tab strip button used by the page-level tabs row. */
export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors cursor-pointer",
        active
          ? "text-text-primary"
          : "text-text-secondary hover:text-text-primary"
      )}
    >
      {children}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-px bg-text-primary" />
      )}
    </button>
  );
}

/** Lightweight click-outside dropdown for filter selects. */
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
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-xs text-text-primary hover:border-white/[0.12] transition-colors cursor-pointer"
      >
        <span>{current.label}</span>
        <ChevronDown size={11} className="text-text-secondary/60" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full mt-1 min-w-[160px] rounded-md border border-white/[0.1] bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 py-1 z-20">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors",
                  o.value === value
                    ? "text-text-primary bg-white/[0.04]"
                    : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
