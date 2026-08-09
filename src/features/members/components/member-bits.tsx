"use client";

import { useState } from "react";
import {
  BookOpen,
  Boxes,
  ChevronDown,
  Folder,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover, MenuItem } from "@/shared/ui/popover-menu";
import {
  withoutRetiredResources,
  type TeamResourceType,
} from "@/features/teams/access-levels";
import type { TeamView } from "@/features/teams/types";
import type { MemberRole, AssignableRole } from "../types";

// Shared kit avatar — re-exported so feature imports stay stable.
export { Avatar } from "@/shared/ui/avatar";

const ROLE_OPTIONS: Array<{
  value: AssignableRole;
  label: string;
  description: string;
}> = [
  { value: "admin", label: "Admin", description: "Full access, manage members + workspace" },
  { value: "member", label: "Member", description: "Use everything: KBs, skills, ontology" },
  { value: "viewer", label: "Viewer", description: "Read-only access" },
];

/**
 * How a grantable resource is drawn in the access UI (label + icon).
 *
 * `workflow` is DELIBERATELY ABSENT. Workflows are retired from the UI and
 * filtered out of the access matrix client-side (`use-workspace-resources`),
 * so nothing here should ever meet one; if a stale row slips through it reads
 * as the neutral fallback rather than reintroducing the word. The DB still
 * accepts `workflow` grants (D7) — only the rendering is gone.
 *
 * A map rather than the inline `=== "knowledge_base" ? … : "Workflow"`
 * ternaries this replaces: the access matrix also emits `skill` rows, which
 * those ternaries labelled "Workflow".
 */
const RESOURCE_META: Partial<
  Record<TeamResourceType, { label: string; icon: LucideIcon }>
> = {
  knowledge_base: { label: "Knowledge base", icon: BookOpen },
  skill: { label: "Skill", icon: Sparkles },
  chat: { label: "Chat", icon: MessagesSquare },
  chat_folder: { label: "Chat folder", icon: Folder },
};

const FALLBACK_RESOURCE_META = { label: "Resource", icon: Boxes } as const;

export function resourceMeta(type: TeamResourceType): {
  label: string;
  icon: LucideIcon;
} {
  return RESOURCE_META[type] ?? FALLBACK_RESOURCE_META;
}

/**
 * How many resources a team is scoped to, AS RENDERED — retired types are not
 * counted (D7).
 *
 * `team.grants` is the raw payload half of the access matrix and it still
 * carries `workflow` rows (`teams/server/repository.ts` selects grants with no
 * `resource_type` filter, on purpose). Counting it straight is how a team with
 * two KB grants and one workflow grant gets captioned "3 scoped resources"
 * above a list of 2 — the caption and the list disagreeing about the same team.
 * Both call sites (`members-list-pane`, `member-detail`) count through here so
 * they cannot drift from each other or from the lists they label.
 */
export function scopedResourceCount(team: Pick<TeamView, "grants">): number {
  return withoutRetiredResources(team.grants).length;
}

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
        "inline-flex items-center rounded border px-1.5 py-0.5 text-label uppercase tracking-wider",
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
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-label uppercase tracking-wider transition-colors",
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
