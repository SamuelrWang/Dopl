"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import type {
  AccessMatrixResource,
  TeamView,
} from "@/features/teams/types";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { WorkspaceMemberView } from "../types";
import {
  TeamAccessConflictError,
  addTeamMembers,
  removeTeamMember,
  setTeamGrant,
  updateTeam,
} from "../teams-client";
import type { ConflictState } from "./conflict-dialog";
import { Avatar } from "./member-bits";
import { AccessLevelControl, TeamColorTile } from "./team-bits";

interface Props {
  workspaceSlug: string;
  team: TeamView | null;
  members: WorkspaceMemberView[];
  resources: AccessMatrixResource[];
  canManage: boolean;
  onClose: () => void;
  onTeamsChanged: () => void;
  onDelete: () => void;
  openConflict: (conflict: ConflictState) => void;
}

/**
 * Team detail drawer: editable name/description, member management, and
 * per-resource None/Read/Edit controls. 409 conflicts bubble to the
 * shared ConflictDialog with an autoGrant retry.
 */
export function TeamDrawer({
  workspaceSlug,
  team,
  members,
  resources,
  canManage,
  onClose,
  onTeamsChanged,
  onDelete,
  openConflict,
}: Props) {
  const [name, setName] = useState(team?.name ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(team?.name ?? "");
    setError(null);
  }, [team?.id, team?.name]);

  const teamMembers = useMemo(
    () => (team ? members.filter((m) => team.memberIds.includes(m.userId)) : []),
    [team, members]
  );
  const availableMembers = useMemo(
    () => (team ? members.filter((m) => !team.memberIds.includes(m.userId)) : []),
    [team, members]
  );

  const grantFor = (type: TeamResourceType, id: string): AccessLevel | null =>
    team?.grants.find((g) => g.resourceType === type && g.resourceId === id)
      ?.level ?? null;

  const kbResources = resources.filter((r) => r.resourceType === "knowledge_base");
  const wfResources = resources.filter((r) => r.resourceType === "workflow");

  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onTeamsChanged();
    } catch (err) {
      if (err instanceof TeamAccessConflictError) {
        throw err;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function changeGrant(type: TeamResourceType, id: string, level: AccessLevel | null) {
    if (!team) return;
    const run = (autoGrant: boolean) =>
      mutate(() =>
        setTeamGrant(workspaceSlug, team.id, type, id, level, { autoGrant })
      );
    void run(false).catch((err) => {
      if (err instanceof TeamAccessConflictError) {
        openConflict({ details: err.details, retry: () => run(true) });
      }
    });
  }

  async function commitName() {
    if (!team || !canManage) return;
    const next = name.trim();
    if (!next || next === team.name) {
      setName(team.name);
      return;
    }
    await mutate(() => updateTeam(workspaceSlug, team.id, { name: next }));
  }

  return (
    <Drawer open={team !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Light token scope — the portal escapes AppPanel's lightScope. */}
      <DrawerContent className={appShell.lightScope} showCloseButton={false}>
        {team && (
          <>
            {/* Inverted header — the app's dark ink frame color. */}
            <DrawerHeader className="bg-[var(--surface-cta)] border-transparent">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <TeamColorTile color={team.color} />
                <div className="min-w-0 flex-1">
                  {canManage ? (
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => void commitName()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      aria-label="Team name"
                      className="w-full bg-transparent text-base font-medium text-[var(--text-on-cta)] outline-none border-b border-transparent focus:border-white/30 transition-colors"
                    />
                  ) : (
                    <DrawerTitle className="truncate text-[var(--text-on-cta)]">
                      {team.name}
                    </DrawerTitle>
                  )}
                  {team.description && (
                    <p className="mt-1 text-[11px] text-white/60 truncate">
                      {team.description}
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
              {error && <p className="text-xs text-red-400">{error}</p>}

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
                    Members · {teamMembers.length}
                  </h4>
                  {canManage && availableMembers.length > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setPickerOpen((v) => !v)}
                        className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                      >
                        <Plus size={11} />
                        Add member
                      </button>
                      {pickerOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setPickerOpen(false)}
                            aria-hidden
                          />
                          <div className="absolute right-0 top-full mt-1 w-56 max-h-56 overflow-y-auto rounded-md border border-border-default bg-[var(--bg-inset-hover)] shadow-[var(--shadow-elevated)] py-1 z-20">
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
                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary transition-colors cursor-pointer"
                              >
                                <Avatar person={m} size="xs" />
                                <span className="truncate">
                                  {m.displayName || m.email || m.userId}
                                </span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {teamMembers.length === 0 && (
                  <p className="text-[11px] text-text-secondary/50">No members yet</p>
                )}
                <ul className="space-y-1.5">
                  {teamMembers.map((m) => (
                    <li key={m.userId} className="flex items-center gap-2.5">
                      <Avatar person={m} size="xs" />
                      <span className="flex-1 text-xs text-text-primary truncate">
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
                          className="text-[10px] uppercase tracking-wider text-text-secondary/50 hover:text-red-300 transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <GrantSection
                label="Knowledge base access"
                resources={kbResources}
                grantFor={grantFor}
                canManage={canManage}
                busy={busy}
                onChange={changeGrant}
              />
              <GrantSection
                label="Workflow access"
                resources={wfResources}
                grantFor={grantFor}
                canManage={canManage}
                busy={busy}
                onChange={changeGrant}
              />
            </DrawerBody>

            {canManage && (
              <DrawerFooter className="justify-between">
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-xs text-red-300/80 hover:text-red-300 transition-colors cursor-pointer"
                >
                  Delete team
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-md bg-accent-primary text-accent-on text-xs hover:bg-accent-primary/90 transition-colors cursor-pointer"
                >
                  Done
                </button>
              </DrawerFooter>
            )}
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function GrantSection({
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
    <section>
      <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-2">
        {label}
      </h4>
      <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle overflow-hidden">
        {resources.map((r) => (
          <li
            key={r.resourceId}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-xs text-text-primary truncate">{r.name}</p>
              {r.accessMode === "workspace" && (
                <p className="text-[10px] text-text-secondary/50">
                  Workspace-wide — everyone already has access
                </p>
              )}
            </div>
            <AccessLevelControl
              value={grantFor(r.resourceType, r.resourceId)}
              disabled={!canManage || busy}
              onChange={(level) => onChange(r.resourceType, r.resourceId, level)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
