"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { meetsMinRole } from "@/features/workspaces/types";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { AssignableRole, MemberRole, WorkspaceMemberView } from "../types";
import { addTeamMembers, removeTeamMember } from "../teams-client";
import { removeMember, updateMemberRole } from "../members-client";
import { computeEffectiveAccess } from "../effective-access";
import { Avatar, RolePill, RoleSelect } from "./member-bits";
import { ScopePill } from "./team-bits";
import { MemberDrawerTeams } from "./member-drawer-teams";

interface Props {
  workspaceSlug: string;
  member: WorkspaceMemberView | null;
  teams: TeamView[];
  resources: AccessMatrixResource[];
  myRole: MemberRole;
  currentUserId: string;
  onClose: () => void;
  onTeamsChanged: () => void;
  onMemberChanged: () => void;
}

/**
 * Member detail drawer: inverted (dark-ink) header, role (editable for
 * admins), expandable team rows with per-team scoping, the computed
 * effective-access list, and an admin-only remove-from-workspace action.
 */
export function MemberDrawer({
  workspaceSlug,
  member,
  teams,
  resources,
  myRole,
  currentUserId,
  onClose,
  onTeamsChanged,
  onMemberChanged,
}: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isSelf = member?.userId === currentUserId;
  // Admins manage members/viewers; only owners manage admins. Nobody
  // edits the owner or themselves here (mirrors the members-table rule).
  const canEditTarget =
    canManage &&
    member !== null &&
    !isSelf &&
    member.role !== "owner" &&
    (myRole === "owner" || member.role !== "admin");

  const memberTeams = useMemo(
    () => (member ? teams.filter((t) => t.memberIds.includes(member.userId)) : []),
    [member, teams]
  );
  const availableTeams = useMemo(
    () => (member ? teams.filter((t) => !t.memberIds.includes(member.userId)) : []),
    [member, teams]
  );

  const access = useMemo(
    () =>
      member
        ? computeEffectiveAccess({
            memberUserId: member.userId,
            memberRole: member.role,
            teams,
            resources,
          })
        : [],
    [member, teams, resources]
  );
  const kbRows = access.filter((r) => r.resourceType === "knowledge_base");
  const wfRows = access.filter((r) => r.resourceType === "workflow");

  async function mutate(fn: () => Promise<void>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      (onDone ?? onTeamsChanged)();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function changeRole(role: AssignableRole) {
    if (!member || !canEditTarget) return;
    void mutate(
      () => updateMemberRole(workspaceSlug, member.userId, role),
      onMemberChanged
    );
  }

  async function handleRemove() {
    if (!member) return;
    await removeMember(workspaceSlug, member.userId);
    onClose();
    onMemberChanged();
    onTeamsChanged();
  }

  return (
    <Drawer open={member !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Drawer portals to <body>, escaping AppPanel's light token scope —
          re-apply it here so the panel matches the page, not the dark root. */}
      <DrawerContent className={appShell.lightScope} showCloseButton={false}>
        {member && (
          <>
            {/* Inverted header — the app's dark ink frame color. */}
            <DrawerHeader className="bg-[var(--surface-cta)] border-transparent">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Avatar person={member} size="md" />
                <div className="min-w-0">
                  <DrawerTitle className="truncate text-[var(--text-on-cta)]">
                    {member.displayName || member.email || member.userId}
                  </DrawerTitle>
                  {member.email && (
                    <p className="mt-1 text-[11px] text-white/60 truncate">
                      {member.email}
                    </p>
                  )}
                </div>
              </div>
              <DrawerClose
                render={
                  <button
                    type="button"
                    aria-label="Close"
                    className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  />
                }
              >
                <X size={14} />
              </DrawerClose>
            </DrawerHeader>
            <DrawerBody className="space-y-6">
              <section>
                <SectionLabel>Role</SectionLabel>
                {canEditTarget ? (
                  <RoleSelect
                    value={member.role as AssignableRole}
                    disabled={busy}
                    onChange={changeRole}
                  />
                ) : (
                  <RolePill role={member.role} />
                )}
              </section>

              <MemberDrawerTeams
                memberTeams={memberTeams}
                availableTeams={availableTeams}
                resources={resources}
                canManage={canManage}
                busy={busy}
                onAddToTeam={(teamId) =>
                  void mutate(() =>
                    addTeamMembers(workspaceSlug, teamId, [member.userId])
                  )
                }
                onRemoveFromTeam={(teamId) =>
                  void mutate(() =>
                    removeTeamMember(workspaceSlug, teamId, member.userId)
                  )
                }
              />
              {error && <p className="text-xs text-red-400">{error}</p>}

              <section>
                <SectionLabel>Effective access</SectionLabel>
                <p className="text-[11px] text-text-secondary/60 mb-3">
                  Highest level from any team they belong to.
                  {(member.role === "owner" || member.role === "admin") &&
                    " Owners and admins always have full access."}
                </p>
                <AccessSection label="Knowledge bases" rows={kbRows} />
                <AccessSection label="Workflows" rows={wfRows} />
              </section>

              {canEditTarget && (
                <section className="border-t border-border-subtle pt-4">
                  <SectionLabel>Danger zone</SectionLabel>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmRemove(true)}
                    className="px-3 py-1.5 rounded-md border border-red-500/30 text-xs text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    Remove from workspace
                  </button>
                </section>
              )}
            </DrawerBody>

            <ConfirmDialog
              open={confirmRemove}
              onOpenChange={setConfirmRemove}
              title="Remove member?"
              description={`${member.displayName || member.email || "This member"} will lose access to the workspace and be removed from all teams.`}
              confirmLabel="Remove"
              destructive
              onConfirm={async () => {
                try {
                  await handleRemove();
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Failed to remove"
                  );
                }
              }}
            />
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h4
      className={cn(
        "text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-2",
        className
      )}
    >
      {children}
    </h4>
  );
}

function AccessSection({
  label,
  rows,
}: {
  label: string;
  rows: ReturnType<typeof computeEffectiveAccess>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 last:mb-0">
      <h5 className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/50 mb-1.5">
        {label}
      </h5>
      <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle overflow-hidden">
        {rows.map((r) => (
          <li
            key={`${r.resourceType}:${r.resourceId}`}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-xs text-text-primary truncate">{r.resourceName}</p>
              {r.viaTeam && (
                <p className="text-[10px] text-text-secondary/50 flex items-center gap-1">
                  <span
                    className="h-1 w-1 rounded-full"
                    style={{ backgroundColor: r.viaTeam.color ?? "#8b5cf6" }}
                  />
                  via {r.viaTeam.name}
                </p>
              )}
            </div>
            <ScopePill level={r.level} />
          </li>
        ))}
      </ul>
    </div>
  );
}
