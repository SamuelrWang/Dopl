"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Popover } from "@/shared/ui/popover-menu";
import { SectionBox } from "@/shared/ui/section-box";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { WorkspaceMemberView } from "../types";
import { useAccessWrites } from "../hooks/use-access-writes";
import { useTeamWrites } from "../hooks/use-team-writes";
import { Avatar } from "./member-bits";
import { AccessLevelControl, ScopePill, TeamColorTile } from "./team-bits";

interface Props {
  workspaceSlug: string;
  team: TeamView;
  members: WorkspaceMemberView[];
  resources: AccessMatrixResource[];
  canManage: boolean;
  /** Clears the pane's selection after the team leaves the list. */
  onDeleted: () => void;
}

/**
 * Team detail — the right pane of the members console: crumb top bar,
 * identity header box (name/description editable inline for admins),
 * then Members and per-resource access section boxes. Replaces the old
 * slide-out drawer.
 */
export function TeamDetail({
  workspaceSlug,
  team,
  members,
  resources,
  canManage,
  onDeleted,
}: Props) {
  const teamWrites = useTeamWrites(workspaceSlug);
  const accessWrites = useAccessWrites(workspaceSlug);
  const busy = teamWrites.pending || accessWrites.pending;
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] =
    useState<WorkspaceMemberView | null>(null);

  /**
   * NO PROP-SYNC EFFECT. There used to be one, mirroring `team.name` /
   * `team.description` back into these two inputs on every change of either.
   * It existed because the write did not update the cached team until a
   * refetch landed, so the pane needed to catch up afterwards — and it is
   * exactly the cascading-render shape `react-hooks/set-state-in-effect`
   * rejects. Two things replace it: `members-view` renders this pane with
   * `key={team.id}`, so switching teams REMOUNTS and the `useState`
   * initialisers are the sync; and the rename now patches the teams cache in
   * `onMutate`, so the crumb and the list row follow the input rather than the
   * input having to be corrected back to them.
   */

  const teamMembers = useMemo(
    () => members.filter((m) => team.memberIds.includes(m.userId)),
    [members, team.memberIds]
  );
  const availableMembers = useMemo(
    () => members.filter((m) => !team.memberIds.includes(m.userId)),
    [members, team.memberIds]
  );
  const kbResources = resources.filter((r) => r.resourceType === "knowledge_base");
  const skillResources = resources.filter((r) => r.resourceType === "skill");

  const grantFor = (type: TeamResourceType, id: string): AccessLevel | null =>
    team.grants.find((g) => g.resourceType === type && g.resourceId === id)?.level ??
    null;

  /** Every write reports into the pane's one error line. */
  const failed = (err: unknown) =>
    setError(err instanceof Error ? err.message : "Something went wrong");

  /**
   * A grant flips the segment on the click — the teams cache carries the
   * level, so the pane repaints before the PUT leaves and the layer rolls the
   * patch back if it is refused.
   */
  function changeGrant(type: TeamResourceType, id: string, level: AccessLevel | null) {
    setError(null);
    void accessWrites.setGrant
      .mutateAsync({
        teamId: team.id,
        resourceType: type,
        resourceId: id,
        memberIds: team.memberIds,
        level,
      })
      .catch(failed);
  }

  /**
   * Rename commits on blur, and the name is read back by the crumb, the left
   * list row and this input's own reset effect — all three off the teams cache,
   * which the mutation patches before the PATCH leaves. It used to revert to
   * the old name for the whole round trip.
   */
  async function commitName() {
    if (!canManage) return;
    const next = name.trim();
    if (!next || next === team.name) {
      setName(team.name);
      return;
    }
    setError(null);
    // Normalise the field to what was actually sent, so the input and the
    // crumb it now drives cannot disagree by a trimmed space.
    setName(next);
    await teamWrites.update
      .mutateAsync({ teamId: team.id, patch: { name: next } })
      .catch((err: unknown) => {
        // THE INPUT FOLLOWS THE ROLLBACK. The layer restores the cached team
        // verbatim on a refusal, so the crumb and the list row go back to the
        // old name — but this field is local state and there is no prop-sync
        // effect to correct it (see above), and the pane only remounts on a
        // team switch. Left alone it would keep showing the rejected text as
        // if it had been saved.
        setName(team.name);
        failed(err);
      });
  }

  async function commitDescription() {
    if (!canManage) return;
    const next = description.trim();
    if (next === (team.description ?? "")) return;
    setError(null);
    setDescription(next);
    await teamWrites.update
      .mutateAsync({ teamId: team.id, patch: { description: next || null } })
      .catch((err: unknown) => {
        setDescription(team.description ?? "");
        failed(err);
      });
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
                          setError(null);
                          void teamWrites.addMembers
                            .mutateAsync({ team, userIds: [m.userId] })
                            .catch(failed);
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
                        onClick={() => setConfirmRemoveMember(m)}
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

          {/* Knowledge bases and skills are the grantable resources this pane
              renders — both are in the access-matrix payload and both accept a
              team grant. The workflow section is retired with the feature (D7):
              workflow grants stay valid in the DB, nothing draws them. */}
          <GrantBox
            label="Knowledge base access"
            resources={kbResources}
            grantFor={grantFor}
            canManage={canManage}
            busy={busy}
            onChange={changeGrant}
          />
          <GrantBox
            label="Skill access"
            resources={skillResources}
            grantFor={grantFor}
            canManage={canManage}
            busy={busy}
            onChange={changeGrant}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemoveMember !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRemoveMember(null);
        }}
        title="Remove from team?"
        description={`${confirmRemoveMember?.displayName || confirmRemoveMember?.email || "This member"} will leave ${team.name} and lose any access it granted. Re-adding them restores it.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const m = confirmRemoveMember;
          if (!m) return;
          setError(null);
          // Failures land in the pane's error line rather than throwing, so
          // the dialog closes either way — same contract as the delete-team
          // dialog below.
          await teamWrites.removeMembers
            .mutateAsync({ team, userIds: [m.userId] })
            .catch(failed);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete team?"
        description={`"${team.name}" will be deleted. Its members keep their workspace access; resources scoped only to this team become invisible to them.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          setError(null);
          try {
            await teamWrites.remove.mutateAsync({
              teamId: team.id,
              memberIds: team.memberIds,
            });
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
