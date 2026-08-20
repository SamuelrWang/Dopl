"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CopyButton } from "@/shared/ui/copy-button";
import { SectionBox } from "@/shared/ui/section-box";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { formatDate, formatLastActive } from "@/shared/lib/format-time";
import type { TeamView } from "@/features/teams/types";
import type { MemberRole, MemberStatus, WorkspaceMemberView } from "../../types";
import { RolePill } from "../member-bits";
import { TeamChip } from "../team-bits";
import { FieldRow, PresenceDot } from "./bits";
import { displayNameOf, teamsOf } from "./view-model";
import type { MemberVisibility } from "./visibility";

/** ⚠ `member-bits › ROLE_OPTIONS` carries the same three lines but is
 *  module-private and has no `owner` entry — the owner role is not assignable. */
const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  pending: "Invitation pending",
  revoked: "Deactivated",
};

const ROLE_COPY: Record<MemberRole, string> = {
  owner: "Owns the workspace. Cannot be removed or demoted.",
  admin: "Full access, manage members + workspace",
  member: "Use everything: knowledge bases, skills, ontology",
  viewer: "Read-only access",
};

export function MemberFacts({
  member: m,
  teams,
  visibility,
  busy,
  onJoinTeam,
  onLeaveTeam,
}: {
  member: WorkspaceMemberView;
  teams: TeamView[];
  visibility: MemberVisibility;
  busy: boolean;
  onJoinTeam: (teamId: string) => void;
  onLeaveTeam: (teamId: string) => void;
}) {
  const activity = formatLastActive(m.lastSeenAt, m.status, m.invitedAt);
  const mine = teamsOf(teams, m.userId);
  const available = teams.filter((t) => !t.memberIds.includes(m.userId));

  return (
    <div className="flex flex-col gap-3">
      <SectionBox label="Role">
        <div className="flex flex-col gap-1.5 px-3 py-2.5">
          <RolePill role={m.role} />
          <p className="text-caption leading-relaxed text-text-secondary">
            {ROLE_COPY[m.role]}
          </p>
        </div>
      </SectionBox>

      <SectionBox label="Teams" meta={`${mine.length}`}>
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5">
          {mine.length === 0 && (
            <p className="text-caption text-text-muted">
              Not on a team — access comes from workspace-mode resources only.
            </p>
          )}
          {mine.map((t) => (
            <TeamChip
              key={t.id}
              name={t.name}
              color={t.color}
              onRemove={
                visibility.canEditTeamMembership && !busy
                  ? () => onLeaveTeam(t.id)
                  : undefined
              }
            />
          ))}
          {visibility.canEditTeamMembership && available.length > 0 && (
            <AddToTeamChip teams={available} disabled={busy} onPick={onJoinTeam} />
          )}
        </div>
      </SectionBox>

      <SectionBox label="Membership">
        <FieldRow label="Joined">{formatDate(m.joinedAt)}</FieldRow>
        <FieldRow label="Status">{STATUS_LABEL[m.status]}</FieldRow>
      </SectionBox>

      <SectionBox label="Contact">
        <FieldRow label="Email">
          <span className="min-w-0 truncate">{m.email}</span>
          {m.email && <CopyButton text={m.email} label="Copy email address" />}
        </FieldRow>
        <FieldRow label="Display name">
          <span className="min-w-0 truncate">{displayNameOf(m)}</span>
        </FieldRow>
      </SectionBox>

      {visibility.showPresence && (
        <SectionBox label="Presence">
          <FieldRow label="Last active">
            <PresenceDot dot={activity.dot} />
            <span className="min-w-0 truncate">{activity.label}</span>
          </FieldRow>
        </SectionBox>
      )}
    </div>
  );
}

function AddToTeamChip({
  teams,
  disabled,
  onPick,
}: {
  teams: TeamView[];
  disabled: boolean;
  onPick: (teamId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-border-strong px-2 py-0.5 text-caption text-text-secondary transition-colors hover:border-border-highlight hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={11} aria-hidden />
        Team
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-52">
        {teams.map((t) => (
          <MenuItem
            key={t.id}
            onSelect={() => {
              onPick(t.id);
              setOpen(false);
            }}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: t.color ?? undefined }}
              />
              {t.name}
            </span>
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
