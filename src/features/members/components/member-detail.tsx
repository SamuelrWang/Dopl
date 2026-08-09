"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Popover } from "@/shared/ui/popover-menu";
import { SectionBox } from "@/shared/ui/section-box";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { meetsMinRole } from "@/features/workspaces/types";
import { canShowMemberControls } from "@/features/workspaces/member-policy";
import type { TeamView } from "@/features/teams/types";
import { withoutRetiredResources } from "@/features/teams/access-levels";
import type { EffectiveAccessRow } from "@/features/teams/effective-access";
import type { AssignableRole, MemberRole, WorkspaceMemberView } from "../types";
import { DEFAULT_TEAM_COLOR } from "../constants";
import { formatLastActive } from "@/shared/lib/format-time";
import { memberAccessPath } from "../client/query-keys";
import { useMemberWrites } from "../hooks/use-member-writes";
import { useTeamWrites } from "../hooks/use-team-writes";
import {
  Avatar,
  RolePill,
  RoleSelect,
  resourceMeta,
  scopedResourceCount,
} from "./member-bits";
import { ScopePill } from "./team-bits";

/**
 * Workflow rows leave here for the same reason they leave
 * `use-workspace-resources` (retirement D7): the server still resolves and
 * returns them — grants stay valid in the DB — but nothing in the UI may
 * render the word. This endpoint is NOT the access matrix, so the filter in
 * that hook does not cover these rows.
 */
const selectAccessRows = (body: { rows: EffectiveAccessRow[] }) =>
  withoutRetiredResources(body.rows ?? []);

interface Props {
  workspaceSlug: string;
  member: WorkspaceMemberView;
  teams: TeamView[];
  myRole: MemberRole;
  currentUserId: string;
  /** Clears the pane's selection after the member leaves the roster. */
  onRemoved: () => void;
}

/**
 * Member detail — the right pane of the members console: crumb top bar
 * with the role control, an identity header box, then Teams and
 * Effective-access section boxes. Replaces the old slide-out drawer.
 */
export function MemberDetail({
  workspaceSlug,
  member: m,
  teams,
  myRole,
  currentUserId,
  onRemoved,
}: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const isSelf = m.userId === currentUserId;
  const canEditTarget = canShowMemberControls(myRole, m.role, isSelf);

  const memberWrites = useMemberWrites(workspaceSlug);
  const teamWrites = useTeamWrites(workspaceSlug);
  const busy = memberWrites.pending || teamWrites.pending;
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The team a "Remove" click is asking about — every destructive action in
  // this console gets an are-you-sure, and dropping a team membership is one:
  // it revokes every resource that team was the member's only path to, with
  // nothing to undo it from.
  const [confirmLeaveTeam, setConfirmLeaveTeam] = useState<TeamView | null>(null);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);

  const memberTeams = useMemo(
    () => teams.filter((t) => t.memberIds.includes(m.userId)),
    [teams, m.userId]
  );
  const availableTeams = useMemo(
    () => teams.filter((t) => !t.memberIds.includes(m.userId)),
    [teams, m.userId]
  );

  // Server-resolved effective access — same implementation as the
  // enforcement path. Admin-only for others (the hook just gets a 404).
  const canSeeAccess = canManage || isSelf;
  /**
   * Nothing else refreshes this pane, and it has its OWN cache key — which is
   * why the role and team-membership mutations name it in their `invalidate`.
   * Since the pane never unmounts, removing someone from the team that granted
   * them a KB used to drop the team chip and leave "Reports KB · via Growth"
   * sitting underneath it: the console asserting access through a team the
   * member is no longer in. The path comes from `client/query-keys` so the
   * invalidation and this read cannot name different entries.
   */
  const { data: access } = useApiQuery(
    memberAccessPath(workspaceSlug, m.userId),
    { select: selectAccessRows, enabled: canSeeAccess }
  );

  const activity = formatLastActive(m.lastSeenAt, m.status, m.invitedAt);

  /** Every write reports into the pane's one error line. */
  const failed = (err: unknown) =>
    setError(err instanceof Error ? err.message : "Something went wrong");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
        <span className="shrink-0 text-small font-medium text-text-secondary">
          Members
        </span>
        <ChevronRight size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {m.displayName || m.email || m.userId}
        </span>
        <span className="flex-1" />
        {canEditTarget ? (
          // The chip renders the CACHED role, which the mutation patches in
          // `onMutate` — so the control shows the new role on the click rather
          // than the old one for the length of the round trip.
          <RoleSelect
            value={m.role as AssignableRole}
            disabled={busy}
            onChange={(role) => {
              setError(null);
              memberWrites.setRole
                .mutateAsync({ userId: m.userId, role })
                .catch(failed);
            }}
          />
        ) : (
          <RolePill role={m.role} />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <section className="flex items-center gap-4 rounded-[14px] border border-border-strong bg-bg-elevated px-5 py-4">
            <Avatar person={m} size="md" />
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 truncate text-display font-semibold tracking-tight text-text-primary">
                {m.displayName || m.email || m.userId}
                {isSelf && (
                  <span className="text-micro font-semibold uppercase tracking-wide text-text-muted">
                    You
                  </span>
                )}
              </h2>
              <p className="mt-1 truncate text-caption text-text-muted">
                {m.email ? `${m.email} · ` : ""}
                {m.role} · {activity.label}
                {m.joinedAt ? ` · joined ${m.joinedAt.slice(0, 10)}` : ""}
              </p>
            </div>
          </section>

          {error && <p className="text-caption text-danger">{error}</p>}

          <SectionBox
            label={`Teams · ${memberTeams.length}`}
            action={
              canManage && availableTeams.length > 0 ? (
                <span className="relative">
                  <button
                    type="button"
                    onClick={() => setTeamPickerOpen((v) => !v)}
                    className="flex cursor-pointer items-center gap-1 text-caption text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <Plus size={11} />
                    Add to team
                  </button>
                  <Popover
                    open={teamPickerOpen}
                    onClose={() => setTeamPickerOpen(false)}
                    align="right"
                    className="min-w-[180px]"
                  >
                    {availableTeams.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setTeamPickerOpen(false);
                          setError(null);
                          // The team is captured AT SUBMIT: the roster chip it
                          // draws needs the team's name and colour, and
                          // re-reading them later is the wrong-target race.
                          teamWrites.addMembers
                            .mutateAsync({ team: t, userIds: [m.userId] })
                            .catch(failed);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-small text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: t.color ?? DEFAULT_TEAM_COLOR }}
                        />
                        {t.name}
                      </button>
                    ))}
                  </Popover>
                </span>
              ) : undefined
            }
          >
            {memberTeams.length === 0 ? (
              <p className="px-4 py-3 text-caption text-text-muted">
                Not in any team.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {memberTeams.map((t) => {
                  // Same count the Teams list shows — retired types excluded.
                  const scoped = scopedResourceCount(t);
                  return (
                  <li key={t.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: t.color ?? DEFAULT_TEAM_COLOR }}
                    />
                    <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                      {t.name}
                    </span>
                    <span className="shrink-0 text-micro text-text-muted">
                      {scoped === 0 ? "no scoping" : `${scoped} scoped`}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmLeaveTeam(t)}
                        className="shrink-0 cursor-pointer text-micro font-semibold uppercase tracking-wide text-text-muted transition-colors hover:text-danger disabled:opacity-60"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </SectionBox>

          {canSeeAccess && (
            <SectionBox
              label="Effective access"
              meta="highest level from any team"
            >
              <EffectiveAccessBody
                rows={access ?? []}
                role={m.role}
                loaded={access !== undefined}
              />
            </SectionBox>
          )}

          {canEditTarget && (
            <section className="flex items-center justify-between rounded-[14px] border border-danger/30 px-5 py-3">
              <p className="text-caption text-text-secondary">
                Remove {m.displayName || m.email || "this member"} from the
                workspace and all teams.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-danger/30 px-2.5 py-1.5 text-small font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-60"
              >
                <Trash2 size={12} />
                Remove
              </button>
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmLeaveTeam !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmLeaveTeam(null);
        }}
        title="Remove from team?"
        description={`${m.displayName || m.email || "This member"} will leave ${confirmLeaveTeam?.name ?? "the team"} and lose any access it granted. Re-adding them restores it.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const team = confirmLeaveTeam;
          if (!team) return;
          setError(null);
          // Failures land in the pane's error line rather than throwing, so
          // the dialog closes either way — same contract as the remove-member
          // dialog below.
          await teamWrites.removeMembers
            .mutateAsync({ team, userIds: [m.userId] })
            .catch(failed);
        }}
      />

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove member?"
        description={`${m.displayName || m.email || "This member"} will lose access to the workspace and be removed from all teams.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          setError(null);
          try {
            await memberWrites.remove.mutateAsync({ userId: m.userId });
            onRemoved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to remove");
          }
        }}
      />
    </div>
  );
}

function EffectiveAccessBody({
  rows,
  role,
  loaded,
}: {
  rows: EffectiveAccessRow[];
  role: MemberRole;
  loaded: boolean;
}) {
  if (!loaded) {
    return <p className="px-4 py-3 text-caption text-text-muted">Loading…</p>;
  }
  if (role === "owner" || role === "admin") {
    return (
      <p className="px-4 py-3 text-caption text-text-muted">
        {role === "owner" ? "Owners" : "Admins"} always have full access to
        everything.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-4 py-3 text-caption text-text-muted">
        No shareable resources in this workspace yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {rows.map((r) => (
        <li
          key={`${r.resourceType}:${r.resourceId}`}
          className="flex items-center gap-3 px-4 py-2.5"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body text-text-primary">
              {r.resourceName}
            </span>
            <span
              className={cn(
                "block truncate text-micro text-text-muted",
                !r.viaTeam && "capitalize"
              )}
            >
              {resourceMeta(r.resourceType).label}
              {r.viaTeam && ` · via ${r.viaTeam.name}`}
            </span>
          </span>
          <ScopePill level={r.level} />
        </li>
      ))}
    </ul>
  );
}
