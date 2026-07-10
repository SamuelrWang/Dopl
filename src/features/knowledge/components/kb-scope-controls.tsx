"use client";

import { Building2, Lock, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { TeamView } from "@/features/teams/types";
import type { AccessLevel } from "@/features/teams/access-levels";
import {
  AccessLevelControl,
  TeamColorTile,
} from "@/features/members/components/team-bits";
import type { KbScope } from "../scope";

/** One drafted grant row — mirrors `KbTeamGrantSchema`. */
export interface TeamGrantDraft {
  teamId: string;
  level: "read" | "edit";
}

const SCOPE_OPTIONS: Array<{
  key: KbScope;
  label: string;
  desc: string;
  Icon: typeof Lock;
}> = [
  { key: "private", label: "Private", desc: "Only you", Icon: Lock },
  { key: "team", label: "Teams", desc: "Specific teams", Icon: Users },
  {
    key: "workspace",
    label: "Workspace",
    desc: "Everyone in this workspace",
    Icon: Building2,
  },
];

/**
 * Three-way sharing scope radio — shared by the create dialog and the
 * settings Sharing section. Token-based styling so it renders correctly
 * inside the ModalShell light scope.
 */
export function ScopeSelector({
  value,
  onChange,
  teamsDisabled,
  disabled,
}: {
  value: KbScope;
  onChange: (next: KbScope) => void;
  /** Disable the Teams option (e.g. the member belongs to no teams). */
  teamsDisabled?: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="grid grid-cols-3 gap-2">
      {SCOPE_OPTIONS.map(({ key, label, desc, Icon }) => {
        const active = value === key;
        const blocked = disabled || (key === "team" && teamsDisabled);
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={blocked}
            onClick={() => !active && onChange(key)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
              active
                ? "border-border-active bg-surface-selected"
                : "border-border-default bg-surface-raised-1 hover:bg-surface-raised-2",
              blocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
            )}
          >
            <span className="flex items-center gap-1.5 text-body font-medium text-text-primary">
              <Icon size={13} />
              {label}
            </span>
            <span className="text-caption leading-snug text-text-secondary">
              {key === "team" && teamsDisabled
                ? "You're not in any team yet"
                : desc}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Per-team grant editor: every pickable team gets a None / Read / Edit
 * control. None = no grant. The caller passes only the teams the user
 * may grant (all teams for admins, own teams for members).
 */
export function TeamGrantEditor({
  teams,
  grants,
  onChange,
  disabled,
  lockedTeamIds,
}: {
  teams: TeamView[];
  grants: TeamGrantDraft[];
  onChange: (next: TeamGrantDraft[]) => void;
  disabled?: boolean;
  /** Teams shown but not editable — e.g. an admin-granted team the
   *  member-owner doesn't belong to (they may not add/raise it). */
  lockedTeamIds?: Set<string>;
}) {
  const byTeam = new Map(grants.map((g) => [g.teamId, g.level]));

  function setLevel(teamId: string, level: AccessLevel | null) {
    const next = grants.filter((g) => g.teamId !== teamId);
    if (level !== null) next.push({ teamId, level });
    onChange(next);
  }

  if (teams.length === 0) {
    return (
      <p className="text-small text-text-secondary">
        No teams available. Create teams from workspace settings → Members.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {teams.map((team) => (
        <div
          key={team.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-raised-1 px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <TeamColorTile color={team.color} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-medium text-text-primary">
                {team.name}
              </span>
              <span className="text-micro text-text-muted">
                {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
              </span>
            </span>
          </span>
          <AccessLevelControl
            value={byTeam.get(team.id) ?? null}
            onChange={(level) => setLevel(team.id, level)}
            disabled={disabled || lockedTeamIds?.has(team.id)}
          />
        </div>
      ))}
    </div>
  );
}
