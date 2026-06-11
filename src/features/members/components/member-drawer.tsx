"use client";

import { useMemo, useState } from "react";
import { BookOpen, Plus, Workflow } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { meetsMinRole } from "@/features/workspaces/types";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { MemberRole, WorkspaceMemberView } from "../types";
import { addTeamMembers, removeTeamMember } from "../teams-client";
import { computeEffectiveAccess } from "../effective-access";
import { Avatar, RolePill } from "./member-bits";
import { ScopePill, TeamChip } from "./team-bits";

interface Props {
  workspaceSlug: string;
  member: WorkspaceMemberView | null;
  teams: TeamView[];
  resources: AccessMatrixResource[];
  myRole: MemberRole;
  onClose: () => void;
  onTeamsChanged: () => void;
}

/**
 * Member detail drawer: profile, role, team chips with add/remove, and
 * the computed effective-access list (KBs + workflows, with the team
 * supplying each level attributed).
 */
export function MemberDrawer({
  workspaceSlug,
  member,
  teams,
  resources,
  myRole,
  onClose,
  onTeamsChanged,
}: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function mutateTeams(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onTeamsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={member !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Drawer portals to <body>, escaping AppPanel's light token scope —
          re-apply it here so the panel matches the page, not the dark root. */}
      <DrawerContent className={appShell.lightScope}>
        {member && (
          <>
            <DrawerHeader>
              <div className="flex items-center gap-3 min-w-0">
                <Avatar person={member} size="md" />
                <div className="min-w-0">
                  <DrawerTitle className="truncate">
                    {member.displayName || member.email || member.userId}
                  </DrawerTitle>
                  {member.email && (
                    <p className="mt-1 text-[11px] text-text-secondary/60 truncate">
                      {member.email}
                    </p>
                  )}
                </div>
              </div>
            </DrawerHeader>
            <DrawerBody className="space-y-6">
              <section>
                <SectionLabel>Role</SectionLabel>
                <RolePill role={member.role} />
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <SectionLabel className="mb-0">Teams</SectionLabel>
                  {canManage && availableTeams.length > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setPickerOpen((v) => !v)}
                        className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                      >
                        <Plus size={11} />
                        Add to team
                      </button>
                      {pickerOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setPickerOpen(false)}
                            aria-hidden
                          />
                          <div className="absolute right-0 top-full mt-1 min-w-[170px] rounded-md border border-border-default bg-[var(--bg-inset-hover)] shadow-[var(--shadow-elevated)] py-1 z-20">
                            {availableTeams.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setPickerOpen(false);
                                  void mutateTeams(() =>
                                    addTeamMembers(workspaceSlug, t.id, [member.userId])
                                  );
                                }}
                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary transition-colors cursor-pointer"
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: t.color ?? "#8b5cf6" }}
                                />
                                {t.name}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {memberTeams.length === 0 && (
                    <span className="text-[11px] text-text-secondary/50">
                      Not in any team
                    </span>
                  )}
                  {memberTeams.map((t) => (
                    <TeamChip
                      key={t.id}
                      name={t.name}
                      color={t.color}
                      onRemove={
                        canManage
                          ? () =>
                              void mutateTeams(() =>
                                removeTeamMember(workspaceSlug, t.id, member.userId)
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
              </section>

              <section>
                <SectionLabel>Effective access</SectionLabel>
                <p className="text-[11px] text-text-secondary/60 mb-3">
                  Highest level from any team they belong to.
                  {(member.role === "owner" || member.role === "admin") &&
                    " Owners and admins always have full access."}
                </p>
                <AccessSection icon={<BookOpen size={11} />} label="Knowledge bases" rows={kbRows} />
                <AccessSection icon={<Workflow size={11} />} label="Workflows" rows={wfRows} />
              </section>
            </DrawerBody>
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
  icon,
  label,
  rows,
}: {
  icon: React.ReactNode;
  label: string;
  rows: ReturnType<typeof computeEffectiveAccess>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 last:mb-0">
      <h5 className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary/50 mb-1.5">
        {icon}
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
