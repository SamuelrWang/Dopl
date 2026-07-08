"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Popover } from "@/shared/ui/popover-menu";
import { SectionBox } from "@/shared/ui/section-box";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { WorkspaceMemberView } from "../types";
import {
  TeamAccessConflictError,
  addTeamMembers,
  deleteTeam,
  removeTeamMember,
  setTeamGrant,
  updateTeam,
} from "../teams-client";
import type { ConflictState } from "./conflict-dialog";
import { Avatar } from "./member-bits";
import { AccessLevelControl, ScopePill, TeamColorTile } from "./team-bits";

interface Props {
  workspaceSlug: string;
  team: TeamView;
  members: WorkspaceMemberView[];
  resources: AccessMatrixResource[];
  canManage: boolean;
  onTeamsChanged: () => void;
  onDeleted: () => void;
  openConflict: (conflict: ConflictState) => void;
}

/**
 * Team detail — the right pane of the members console: crumb top bar,
 * identity header box (name/description editable inline for admins),
 * then Members and per-resource access section boxes. Replaces the old
 * slide-out drawer; 409 grant conflicts bubble to the shared
 * ConflictDialog with the autoGrant retry.
 */
export function TeamDetail({
  workspaceSlug,
  team,
  members,
  resources,
  canManage,
  onTeamsChanged,
  onDeleted,
  openConflict,
}: Props) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(team.name);
    setDescription(team.description ?? "");
    setError(null);
  }, [team.id, team.name, team.description]);

  const teamMembers = useMemo(
    () => members.filter((m) => team.memberIds.includes(m.userId)),
    [members, team.memberIds]
  );
  const availableMembers = useMemo(
    () => members.filter((m) => !team.memberIds.includes(m.userId)),
    [members, team.memberIds]
  );
  const kbResources = resources.filter((r) => r.resourceType === "knowledge_base");
  const wfResources = resources.filter((r) => r.resourceType === "workflow");

  const grantFor = (type: TeamResourceType, id: string): AccessLevel | null =>
    team.grants.find((g) => g.resourceType === type && g.resourceId === id)?.level ??
    null;

  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onTeamsChanged();
    } catch (err) {
      if (err instanceof TeamAccessConflictError) throw err;
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function changeGrant(type: TeamResourceType, id: string, level: AccessLevel | null) {
    const run = (autoGrant: boolean) =>
      mutate(() => setTeamGrant(workspaceSlug, team.id, type, id, level, { autoGrant }));
    void run(false).catch((err) => {
      if (err instanceof TeamAccessConflictError) {
        openConflict({ details: err.details, retry: () => run(true) });
      }
    });
  }

  async function commitName() {
    if (!canManage) return;
    const next = name.trim();
    if (!next || next === team.name) {
      setName(team.name);
      return;
    }
    await mutate(() => updateTeam(workspaceSlug, team.id, { name: next }));
  }

  async function commitDescription() {
    if (!canManage) return;
    const next = description.trim();
    if (next === (team.description ?? "")) return;
    await mutate(() =>
      updateTeam(workspaceSlug, team.id, { description: next || null })
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
        <span className="shrink-0 text-small font-medium text-text-secondary">
          Teams
        </span>
        <ChevronRight size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {team.name}
        </span>
        <span className="flex-1" />
        {canManage && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-danger/30 px-2.5 py-1 text-small font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 size={12} />
            Delete team
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <section className="flex items-center gap-4 rounded-[14px] border border-border-strong bg-bg-elevated px-5 py-4">
            <TeamColorTile color={team.color} />
            <div className="min-w-0 flex-1">
              {canManage ? (
                <>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => void commitName()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    aria-label="Team name"
                    className="w-full bg-transparent text-display font-semibold tracking-tight text-text-primary outline-none placeholder:text-text-muted"
                    placeholder="Team name"
                  />
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => void commitDescription()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    aria-label="Team description"
                    className="mt-1 w-full bg-transparent text-caption text-text-secondary outline-none placeholder:text-text-muted"
                    placeholder="What this team is for…"
                  />
                </>
              ) : (
                <>
                  <h2 className="truncate text-display font-semibold tracking-tight text-text-primary">
                    {team.name}
                  </h2>
                  {team.description && (
                    <p className="mt-1 truncate text-caption text-text-secondary">
                      {team.description}
                    </p>
                  )}
                </>
              )}
            </div>
          </section>

          {error && <p className="text-caption text-danger">{error}</p>}

          <SectionBox
            label={`Members · ${teamMembers.length}`}
            action={
              canManage && availableMembers.length > 0 ? (
                <span className="relative">
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className="flex cursor-pointer items-center gap-1 text-caption text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <Plus size={11} />
                    Add member
                  </button>
                  <Popover
                    open={pickerOpen}
                    onClose={() => setPickerOpen(false)}
                    align="right"
                    className="max-h-56 w-56 overflow-y-auto"
                  >
                    {availableMembers.map((m) => (
                      <button
                        key={m.userId}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setPickerOpen(false);
                          void mutate(() =>
                            addTeamMembers(workspaceSlug, team.id, [m.userId])
                          );
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-small text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
                      >
                        <Avatar person={m} size="xs" />
                        <span className="truncate">
                          {m.displayName || m.email || m.userId}
                        </span>
                      </button>
                    ))}
                  </Popover>
                </span>
              ) : undefined
            }
          >
            {teamMembers.length === 0 ? (
              <p className="px-4 py-3 text-caption text-text-muted">
                No members yet.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {teamMembers.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Avatar person={m} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                      {m.displayName || m.email || m.userId}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void mutate(() =>
                            removeTeamMember(workspaceSlug, team.id, m.userId)
                          )
                        }
                        className="shrink-0 cursor-pointer text-micro font-semibold uppercase tracking-wide text-text-muted transition-colors hover:text-danger disabled:opacity-60"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionBox>

          <GrantBox
            label="Knowledge base access"
            resources={kbResources}
            grantFor={grantFor}
            canManage={canManage}
            busy={busy}
            onChange={changeGrant}
          />
          <GrantBox
            label="Workflow access"
            resources={wfResources}
            grantFor={grantFor}
            canManage={canManage}
            busy={busy}
            onChange={changeGrant}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete team?"
        description={`"${team.name}" will be deleted. Its members keep their workspace access; resources scoped only to this team become invisible to them.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await deleteTeam(workspaceSlug, team.id);
            onDeleted();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete");
          }
        }}
      />
    </div>
  );
}

function GrantBox({
  label,
  resources,
  grantFor,
  canManage,
  busy,
  onChange,
}: {
  label: string;
  resources: AccessMatrixResource[];
  grantFor: (type: TeamResourceType, id: string) => AccessLevel | null;
  canManage: boolean;
  busy: boolean;
  onChange: (type: TeamResourceType, id: string, level: AccessLevel | null) => void;
}) {
  if (resources.length === 0) return null;
  return (
    <SectionBox label={label}>
      <ul className="divide-y divide-border-subtle">
        {resources.map((r) => (
          <li
            key={r.resourceId}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <span className="min-w-0">
              <span className="block truncate text-body text-text-primary">
                {r.name}
              </span>
              {r.accessMode === "workspace" && (
                <span className="block text-micro text-text-muted">
                  Workspace-wide — everyone already has access
                </span>
              )}
            </span>
            {canManage ? (
              <AccessLevelControl
                value={grantFor(r.resourceType, r.resourceId)}
                disabled={busy}
                onChange={(level) => onChange(r.resourceType, r.resourceId, level)}
              />
            ) : (
              <ScopePill level={grantFor(r.resourceType, r.resourceId)} />
            )}
          </li>
        ))}
      </ul>
    </SectionBox>
  );
}
