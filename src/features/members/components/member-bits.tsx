"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { MemberRole, AssignableRole } from "../types";

const ROLE_OPTIONS: Array<{
  value: AssignableRole;
  label: string;
  description: string;
}> = [
  { value: "admin", label: "Admin", description: "Full access, manage members + workspace" },
  { value: "member", label: "Member", description: "Use everything: KBs, skills, canvas" },
  { value: "viewer", label: "Viewer", description: "Read-only access" },
];

const AVATAR_GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-emerald-500 to-cyan-500",
  "from-pink-500 to-rose-500",
  "from-orange-500 to-amber-500",
  "from-blue-500 to-indigo-500",
  "from-teal-500 to-emerald-500",
  "from-fuchsia-500 to-pink-500",
  "from-cyan-500 to-blue-500",
  "from-purple-500 to-violet-500",
  "from-red-500 to-pink-500",
];

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function initialFor(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

export interface AvatarPerson {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Avatar with profile-pic preference + gradient initial fallback.
 * Falls back to an initials-on-gradient circle when no avatarUrl exists,
 * picking the gradient deterministically from the user id so the same
 * person always gets the same color.
 */
export function Avatar({
  person,
  size = "sm",
  className,
}: {
  person: AvatarPerson;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const dim =
    size === "xs"
      ? "w-6 h-6 text-[10px]"
      : size === "md"
        ? "w-10 h-10 text-[14px]"
        : "w-8 h-8 text-[12px]";

  if (person.avatarUrl) {
    return (
      <span className={cn("shrink-0 rounded-full overflow-hidden", dim, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={person.avatarUrl}
          alt={person.displayName || person.email || "Member"}
          className="w-full h-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center font-semibold text-white bg-gradient-to-br",
        gradientFor(person.userId),
        dim,
        className
      )}
    >
      {initialFor(person.displayName, person.email)}
    </span>
  );
}

const ROLE_STYLE: Record<MemberRole, string> = {
  owner: "bg-violet-500/15 border-violet-500/25 text-violet-200",
  admin: "bg-emerald-500/10 border-emerald-500/20 text-emerald-200",
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
 * Editable role chip — only assignable roles (admin/member/viewer) appear
 * in the popover. Owner is excluded by the AssignableRole type. Click is
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
    <div
      className="relative inline-flex"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border transition-colors",
          ROLE_STYLE[value],
          disabled
            ? "opacity-60 cursor-not-allowed"
            : "cursor-pointer hover:brightness-110"
        )}
      >
        <span>{value}</span>
        {!disabled && <ChevronDown size={10} className="opacity-70" />}
      </button>
      {open && !disabled && (
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
                    active ? "bg-white/[0.04]" : "hover:bg-white/[0.04]"
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
