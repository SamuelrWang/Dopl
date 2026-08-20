"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { SectionBox } from "@/shared/ui/section-box";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { formatDate } from "@/shared/lib/format-time";
import { withoutRetiredResources } from "@/features/teams/access-levels";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { WorkspaceMemberView } from "../../types";
import { resourceMeta } from "../member-bits";
import { ScopePill, TeamColorTile } from "../team-bits";
import { IconButton, PaneHeading } from "./bits";
import { displayNameOf } from "./view-model";

/**
 * A team is a named group carrying resource grants; this pane is those two
 * halves. Grant LEVELS are read-only here — editing them is the access-matrix
 * surface, not this one.
 */
export function TeamDetailPane({
  team,
  members,
  resources,
  canManage,
  busy,
  onAddMember,
  onRemoveMember,
  onDeleteTeam,
}: {
  team: TeamView;
  members: WorkspaceMemberView[];
  resources: AccessMatrixResource[];
  canManage: boolean;
  busy: boolean;
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
  onDeleteTeam: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const roster = team.memberIds
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is WorkspaceMemberView => Boolean(m));
  const addable = members.filter((m) => !team.memberIds.includes(m.userId));
  // ⚠ Retired grant rows still arrive from the server; nothing may render one.
  const grants = withoutRetiredResources(team.grants);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card-surface-subtle">
      <header className="shrink-0 bg-surface-invert px-5 py-4">
        <div className="flex items-center gap-3.5">
          <TeamColorTile color={team.color} />
          <div className="min-w-0 flex-1">
            <h2 className="min-w-0 truncate text-display font-semibold tracking-tight text-text-on-invert">
              {team.name}
            </h2>
            <p className="mt-0.5 truncate text-caption text-text-on-invert/60">
              {team.description ?? "No description."}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-label font-semibold uppercase tracking-wide text-text-on-invert/50">
              Created
            </p>
            <p className="text-body font-medium text-text-on-invert">
              {formatDate(team.createdAt)}
            </p>
          </div>
          {canManage && (
            <IconButton
              icon={Trash2}
              label={`Delete ${team.name}`}
              onInvert
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            />
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3.5">
          <PaneHeading title="Members" subtitle="Everyone here inherits the grants below." />

          <SectionBox
            label="On this team"
            meta={`${roster.length}`}
            action={
              canManage && addable.length > 0 ? (
                <AddMemberMenu members={addable} disabled={busy} onPick={onAddMember} />
              ) : undefined
            }
          >
            {roster.length === 0 ? (
              <p className="px-3 py-2.5 text-caption text-text-muted">
                Nobody on this team yet — its grants reach no one.
              </p>
            ) : (
              roster.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2 last:border-b-0"
                >
                  <Avatar person={m} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-text-primary">
                      {displayNameOf(m)}
                    </span>
                    <span className="block truncate text-caption text-text-muted">
                      {m.email}
                    </span>
                  </span>
                  {canManage && (
                    <IconButton
                      icon={X}
                      label={`Remove ${displayNameOf(m)} from ${team.name}`}
                      size={13}
                      disabled={busy}
                      onClick={() => onRemoveMember(m.userId)}
                    />
                  )}
                </div>
              ))
            )}
          </SectionBox>

          <PaneHeading
            title="Grants"
            subtitle="What belonging to this team gives you, and at what level."
          />

          <SectionBox label="Scoped resources" meta={`${grants.length}`}>
            {grants.length === 0 ? (
              <p className="px-3 py-2.5 text-caption text-text-muted">
                No scoped resources — this team grants nothing yet.
              </p>
            ) : (
              grants.map((g) => {
                const resource = resources.find(
                  (r) => r.resourceType === g.resourceType && r.resourceId === g.resourceId
                );
                const { label: typeLabel, icon: Icon } = resourceMeta(g.resourceType);
                return (
                  <div
                    key={`${g.resourceType}:${g.resourceId}`}
                    className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2 last:border-b-0"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-elevated text-text-secondary">
                      <Icon size={13} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-text-primary">
                        {resource?.name ?? g.resourceId}
                      </span>
                      <span className="block truncate text-caption text-text-muted">
                        {typeLabel}
                      </span>
                    </span>
                    <ScopePill level={g.level} />
                  </div>
                );
              })
            )}
          </SectionBox>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete the ${team.name} team?`}
        description="Everyone on it loses every resource this team was their only path to. No undo."
        confirmLabel="Delete team"
        destructive
        onConfirm={onDeleteTeam}
      />
    </div>
  );
}

function AddMemberMenu({
  members,
  disabled,
  onPick,
}: {
  members: WorkspaceMemberView[];
  disabled: boolean;
  onPick: (userId: string) => void;
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
        className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border-strong bg-bg-elevated px-2 py-0.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={11} aria-hidden />
        Add
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" className="w-56">
        {members.map((m) => (
          <MenuItem
            key={m.userId}
            onSelect={() => {
              onPick(m.userId);
              setOpen(false);
            }}
          >
            {displayNameOf(m)}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
