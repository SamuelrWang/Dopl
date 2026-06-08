"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Check,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  UserPlus,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { workspaceSegment } from "@/features/workspaces/url";
import { userInitials } from "@/shared/auth/use-auth-user";
import { WorkspaceAvatar } from "../workspace-avatar";
import type { PendingInvitation, WorkspaceLike } from "./types";

interface Props {
  user: User | null;
  current: WorkspaceLike | null;
  currentName: string;
  currentSegment: string;
  workspaces: WorkspaceLike[];
  memberCount: number | null;
  planLabel: string;
  canManage: boolean;
  invitations: PendingInvitation[];
  acceptingToken: string | null;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onOpenInvite: () => void;
  onOpenCreate: () => void;
  onOpenBilling: () => void;
  onAccept: (invite: PendingInvitation) => void;
  onSignOut: () => void;
  onNavigate: () => void;
}

export function SwitcherPanel({
  user,
  current,
  currentName,
  currentSegment,
  workspaces,
  memberCount,
  planLabel,
  canManage,
  invitations,
  acceptingToken,
  onOpenSettings,
  onOpenAccount,
  onOpenInvite,
  onOpenCreate,
  onOpenBilling,
  onAccept,
  onSignOut,
  onNavigate,
}: Props) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const memberText =
    memberCount == null
      ? "…"
      : `${memberCount} member${memberCount === 1 ? "" : "s"}`;

  return (
    <div className="absolute left-3 right-3 top-full mt-1 rounded-md overflow-hidden bg-[var(--bg-inset-hover)] border border-border-default shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-10">
      {/* Current-workspace header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2.5">
          <WorkspaceAvatar name={currentName} iconUrl={current?.iconUrl} size="lg" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">
              {currentName}
            </p>
            <p className="text-xs text-text-secondary truncate">
              {planLabel} · {memberText}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="mt-2.5 flex items-center gap-2">
            <PanelButton icon={Settings} label="Settings" onClick={onOpenSettings} />
            <PanelButton icon={UserPlus} label="Invite members" onClick={onOpenInvite} />
          </div>
        )}
      </div>

      <Divider />

      {/* Account row */}
      {user && (
        <div className="relative px-3 py-2">
          <div className="flex items-center gap-2.5">
            <AccountAvatar user={user} />
            <p className="flex-1 min-w-0 text-sm text-text-secondary truncate">
              {user.email}
            </p>
            <button
              type="button"
              aria-label="Account options"
              onClick={() => setAccountMenuOpen((o) => !o)}
              className="shrink-0 p-1 rounded-md text-text-secondary/60 hover:bg-surface-raised-3 hover:text-text-primary transition-colors cursor-pointer"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>

          {accountMenuOpen && (
            <div className="absolute right-3 top-full z-10 mt-1 w-40 rounded-md overflow-hidden bg-[var(--bg-elevated)] border border-border-default shadow-[0_8px_32px_rgba(0,0,0,0.5)] py-1">
              <MenuRow
                label="Settings"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onOpenAccount();
                }}
              />
              <MenuRow
                label="Billing"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onOpenBilling();
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Workspace list */}
      <div className="py-1 max-h-60 overflow-auto">
        {workspaces.map((w) => {
          const segment = workspaceSegment(w);
          const active = segment === currentSegment;
          return (
            <Link
              key={w.id}
              href={`/${segment}`}
              onClick={onNavigate}
              className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary transition-colors cursor-pointer"
            >
              <WorkspaceAvatar name={w.name} iconUrl={w.iconUrl} size="sm" />
              <span className="flex-1 min-w-0 truncate">{w.name}</span>
              {active && <Check size={15} className="shrink-0 text-text-primary" />}
            </Link>
          );
        })}

        {/* New workspace */}
        <button
          type="button"
          onClick={onOpenCreate}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-link hover:bg-surface-raised-2 transition-colors cursor-pointer"
        >
          <Plus size={15} className="shrink-0" />
          <span>New workspace</span>
        </button>
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <>
          <Divider />
          <div className="py-1">
            <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-text-secondary/60">
              Invitations
            </p>
            {invitations.map((inv) => {
              const accepting = acceptingToken === inv.token;
              return (
                <div key={inv.token} className="flex items-center gap-2 px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary truncate">
                      {inv.workspaceName}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-text-secondary/50">
                      Invited as {inv.invitedRole}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAccept(inv)}
                    disabled={accepting}
                    className="shrink-0 h-6 px-2 rounded-md bg-surface-cta text-text-on-cta text-[11px] font-medium hover:bg-surface-cta/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {accepting ? "…" : "Accept"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Divider />

      {/* Log out */}
      <div className="py-1">
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary transition-colors cursor-pointer"
        >
          <LogOut size={15} className="shrink-0" />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );
}

function PanelButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-border-default text-xs text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary transition-colors cursor-pointer"
    >
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function MenuRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-raised-3 hover:text-text-primary transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}

function AccountAvatar({ user }: { user: User }) {
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  return (
    <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center overflow-hidden border border-border-default bg-surface-raised-3 text-xs text-text-secondary">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        userInitials(user)
      )}
    </span>
  );
}

function Divider() {
  return <div className="border-t border-border-subtle" />;
}
