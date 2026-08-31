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

// Re-exported so feature imports stay stable.
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
 * Label + icon per grantable resource in the access UI.
 * ⚠ `workflow` is DELIBERATELY ABSENT: retired from the UI and filtered out
 * of the access matrix in `use-workspace-resources`, so a stale row reads as
 * the neutral fallback instead of reintroducing the word. The DB still
 * accepts `workflow` grants — only the rendering is gone.
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
 * Resources a team is scoped to, AS RENDERED — retired types not counted.
 * ⚠ `team.grants` still carries `workflow` rows (`teams/server/repository.ts`
 * selects grants with no `resource_type` filter, on purpose), so counting it
 * straight captions "3 scoped resources" above a list of 2. Both call sites
 * (the teams list and the team pane) must count through here.
 */
export function scopedResourceCount(team: Pick<TeamView, "grants">): number {
  return withoutRetiredResources(team.grants).length;
}

/** Role pills: weight/emphasis carries rank, not hue. Owner is the inverted
 *  ink chip; the rest step down the gray tiers. */
const ROLE_STYLE: Record<MemberRole, string> = {
  owner: "bg-surface-invert border-surface-invert text-text-on-invert",
  admin: "bg-bg-inset border-border-strong text-text-primary",
  member: "bg-surface-raised-2 border-border-default text-text-secondary",
  viewer: "border-dashed border-border-strong text-text-tertiary bg-transparent",
  // Guest is the floor tier (link-granted, chat-only) — the most subdued chip.
  guest: "border-dashed border-border-default text-text-tertiary bg-transparent",
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

/** Editable role chip. Owner is excluded by the AssignableRole type. Click
 *  is stopped from bubbling so row-level handlers don't fire. */
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
