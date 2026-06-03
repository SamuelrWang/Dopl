"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { meetsMinRole } from "@/features/workspaces/types";
import { useAuthUser } from "@/shared/auth/use-auth-user";
import { useMembers } from "@/features/members/hooks/use-members";
import { useSubscription } from "@/features/billing/components/use-subscription";
import { CreateWorkspaceDialog } from "@/features/workspaces/components/create-workspace-dialog";
import { InviteDialog } from "@/features/members/components/invite-dialog";
import { SettingsModal, type SettingsSection } from "../settings-modal";
import { WorkspaceAvatar } from "../workspace-avatar";
import { SwitcherPanel } from "./switcher-panel";
import type { PendingInvitation, WorkspaceLike } from "./types";

interface Props {
  current: WorkspaceLike | null;
  currentName: string;
  currentSegment: string;
  workspaces: WorkspaceLike[];
  invitations: PendingInvitation[];
  onAccepted: () => void;
  onWorkspacesChanged: () => void;
}

/**
 * Sidebar top-left workspace switcher. The trigger shows the current
 * workspace's avatar + name; the dropdown carries the workspace header
 * (plan + member count), Settings / Invite actions, the account row, the
 * workspace list, New workspace, and Log out. Owns the Settings, Add-
 * members, and Create-workspace modals.
 */
export function WorkspaceSwitcher({
  current,
  currentName,
  currentSegment,
  workspaces,
  invitations,
  onAccepted,
  onWorkspacesChanged,
}: Props) {
  const router = useRouter();
  const { user, signOut } = useAuthUser();
  const sub = useSubscription();
  const { members, refresh: refreshMembers } = useMembers(currentSegment);

  const [open, setOpen] = useState(false);
  const [acceptingToken, setAcceptingToken] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("workspace");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const canManage = current ? meetsMinRole(current.role, "admin") : false;
  const tierName = sub.tier === "pro" ? "Pro" : sub.tier === "power" ? "Power" : "Free";
  const planLabel = `${tierName} Plan`;
  const memberCount = current ? members?.length ?? null : null;
  const hasInvites = invitations.length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function openSettingsAt(section: SettingsSection) {
    setSettingsSection(section);
    setSettingsOpen(true);
    setOpen(false);
  }

  async function handleAccept(invite: PendingInvitation) {
    if (acceptingToken) return;
    setAcceptingToken(invite.token);
    try {
      const res = await fetch(
        `/api/workspaces/invitations/${encodeURIComponent(invite.token)}/accept`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Couldn't accept");
      }
      onAccepted();
      setOpen(false);
      router.push(`/${invite.workspaceSlug}-${invite.workspacePublicId}`);
      router.refresh();
    } catch {
      // Refresh anyway — the invite may have been revoked/expired since
      // the last poll. The list reconciles on refresh.
      onAccepted();
    } finally {
      setAcceptingToken(null);
    }
  }

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 px-3 py-3 border-b border-white/[0.06]"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex-1 flex items-center gap-2 px-1 py-1 rounded-md hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
      >
        <WorkspaceAvatar name={currentName} iconUrl={current?.iconUrl} size="md" />
        <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">
          {currentName}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {hasInvites && (
            <span
              aria-label={`${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}`}
              className="w-1.5 h-1.5 rounded-full bg-red-500"
            />
          )}
          <ChevronDown size={14} className="text-text-secondary/60" />
        </span>
      </button>

      {open && (
        <SwitcherPanel
          user={user}
          current={current}
          currentName={currentName}
          currentSegment={currentSegment}
          workspaces={workspaces}
          memberCount={memberCount}
          planLabel={planLabel}
          canManage={canManage}
          invitations={invitations}
          acceptingToken={acceptingToken}
          onOpenSettings={() => openSettingsAt("workspace")}
          onOpenAccount={() => openSettingsAt("account")}
          onOpenInvite={() => {
            setInviteOpen(true);
            setOpen(false);
          }}
          onOpenCreate={() => {
            setCreateOpen(true);
            setOpen(false);
          }}
          onOpenBilling={() => openSettingsAt("billing")}
          onAccept={handleAccept}
          onSignOut={signOut}
          onNavigate={() => setOpen(false)}
        />
      )}

      {current && user && (
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          workspaceSegment={currentSegment}
          workspaceId={current.id}
          currentUserId={user.id}
          role={current.role}
          onWorkspaceChanged={onWorkspacesChanged}
        />
      )}

      {current && (
        <InviteDialog
          workspaceSlug={currentSegment}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onInvited={() => refreshMembers()}
        />
      )}

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onWorkspacesChanged}
      />
    </div>
  );
}
