"use client";

/** STAGING COPY of `src/features/knowledge/components/kb-scope-controls.tsx` — redesigned ahead of its source (PORTING.md). */
import { Building2, Check, Lock, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import type { TeamView } from "@/features/teams/types";
import { TeamColorTile } from "@/features/members/components/team-bits";
import type { KbScope } from "../scope";

/** One drafted grant row. Mirrors `KbTeamGrantSchema`. */
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
    label: "Public",
    desc: "Everyone in this workspace",
    Icon: Building2,
  },
];

/** The card both controls sit in: the popup kit's hairline rows. */
const ROWS_CARD = "white-card divide-y divide-border-default px-3.5 py-1";

/**
 * Three-way sharing scope, one radio row each in a white card (the selected one
 * ticked), shared by the create dialog and the settings Sharing pane.
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
    <div role="radiogroup" className={ROWS_CARD}>
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
            className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-50"
          >
            <Icon size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-text-primary">{label}</span>
              <span className="block truncate text-caption text-text-muted">
                {key === "team" && teamsDisabled ? "You're not in any team yet" : desc}
              </span>
            </span>
            <Check
              size={14}
              aria-hidden="true"
              className={cn("shrink-0 text-text-primary", !active && "invisible")}
            />
          </button>
        );
      })}
    </div>
  );
}

type LevelChoice = "none" | TeamGrantDraft["level"];

const LEVEL_OPTIONS: ReadonlyArray<SelectMenuOption<LevelChoice>> = [
  { value: "none", label: "No access" },
  { value: "read", label: "Read", description: "Can open every file" },
  { value: "edit", label: "Edit", description: "Can open and change every file" },
];

/**
 * Per-team grant editor: one row per team with a bare level menu, "No access" =
 * no grant. The caller passes only the teams the user may grant (all for admins,
 * own teams for members).
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
  /** Shown but not editable: e.g. an admin-granted team the member-owner
   *  doesn't belong to. */
  lockedTeamIds?: Set<string>;
}) {
  const byTeam = new Map(grants.map((g) => [g.teamId, g.level]));

  function setLevel(teamId: string, level: LevelChoice) {
    const next = grants.filter((g) => g.teamId !== teamId);
    if (level !== "none") next.push({ teamId, level });
    onChange(next);
  }

  if (teams.length === 0) {
    return (
      <p className="px-1 text-caption text-text-muted">
        No teams available. Create teams from workspace settings, under Members.
      </p>
    );
  }

  return (
    <ul aria-label="Team access" className={ROWS_CARD}>
      {teams.map((team) => (
        <li key={team.id} className="flex items-center gap-3 py-2.5">
          <TeamColorTile color={team.color} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-text-primary">
              {team.name}
            </span>
            <span className="block text-caption text-text-muted">
              {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
            </span>
          </span>
          <SelectMenu<LevelChoice>
            variant="bare"
            value={byTeam.get(team.id) ?? "none"}
            options={LEVEL_OPTIONS}
            onChange={(level) => setLevel(team.id, level)}
            disabled={disabled || lockedTeamIds?.has(team.id)}
            ariaLabel={`${team.name} access`}
          />
        </li>
      ))}
    </ul>
  );
}
