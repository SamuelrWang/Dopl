"use client";

import { useMemo, useState } from "react";
import { Building2, Check, Lock, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover } from "@/shared/ui/popover-menu";
import { useTeams } from "@/features/members/hooks/use-teams";
import { chatScope, type ChatScope } from "../scope";
import type { Chat } from "../types";

const SCOPE_OPTIONS: Array<{
  key: ChatScope;
  label: string;
  desc: string;
  Icon: typeof Lock;
}> = [
  { key: "private", label: "Private", desc: "Only you", Icon: Lock },
  { key: "team", label: "Team", desc: "Specific teams", Icon: Users },
  {
    key: "workspace",
    label: "Shared",
    desc: "Everyone in this workspace",
    Icon: Building2,
  },
];

export const SCOPE_ICONS: Record<ChatScope, typeof Lock> = {
  private: Lock,
  team: Users,
  workspace: Building2,
};

const PILL =
  "flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2.5 text-caption font-medium";

/**
 * Owner-facing sharing control — the KB three-way scope model on a
 * compact popover: Private / Team (pick teams) / Shared (workspace).
 * Non-owners get a read-only scope pill.
 */
export function ShareControl({
  chat,
  workspaceSlug,
  currentUserId,
  isAdmin,
  onShareChange,
}: {
  chat: Chat;
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  onShareChange: (scope: ChatScope, teamIds: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const scope = chatScope(chat);
  const isMine = chat.owner.userId === currentUserId;
  const Icon = SCOPE_ICONS[scope];
  const label = SCOPE_OPTIONS.find((o) => o.key === scope)?.label ?? "Private";

  if (!isMine) {
    return (
      <span className={cn(PILL, "text-text-secondary")}>
        <Icon size={11} />
        {label}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change who can read this chat"
        className={cn(
          PILL,
          "cursor-pointer text-text-secondary transition-colors hover:text-text-primary"
        )}
      >
        <Icon size={11} />
        {label}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-[264px] p-1.5"
      >
        {/* Mounted only while open so the teams fetch is lazy. */}
        <ShareMenu
          chat={chat}
          scope={scope}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onApply={async (nextScope, teamIds) => {
            await onShareChange(nextScope, teamIds);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

function ShareMenu({
  chat,
  scope,
  workspaceSlug,
  currentUserId,
  isAdmin,
  onApply,
}: {
  chat: Chat;
  scope: ChatScope;
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  onApply: (scope: ChatScope, teamIds: string[]) => Promise<void>;
}) {
  const { teams, loading, error } = useTeams(workspaceSlug);
  const [draftScope, setDraftScope] = useState<ChatScope>(scope);
  const [draftTeams, setDraftTeams] = useState<Set<string>>(
    new Set(chat.grantedTeamIds)
  );
  const [saving, setSaving] = useState(false);

  // Owners may grant teams they belong to; already-granted foreign teams
  // stay visible but locked (admins edit everything) — the KB rule.
  const myTeamIds = useMemo(
    () =>
      new Set(
        (teams ?? [])
          .filter((t) => t.memberIds.includes(currentUserId))
          .map((t) => t.id)
      ),
    [teams, currentUserId]
  );
  const pickableTeams = useMemo(() => {
    const all = teams ?? [];
    if (isAdmin) return all;
    return all.filter(
      (t) => myTeamIds.has(t.id) || chat.grantedTeamIds.includes(t.id)
    );
  }, [teams, isAdmin, myTeamIds, chat.grantedTeamIds]);

  const dirty =
    draftScope !== scope ||
    (draftScope === "team" &&
      !sameSet(draftTeams, new Set(chat.grantedTeamIds)));

  const toggleTeam = (teamId: string) => {
    if (!isAdmin && !myTeamIds.has(teamId)) return; // locked foreign grant
    setDraftTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const apply = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onApply(draftScope, draftScope === "team" ? [...draftTeams] : []);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {SCOPE_OPTIONS.map(({ key, label, desc, Icon }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={draftScope === key}
          onClick={() => setDraftScope(key)}
          className={cn(
            "flex items-start gap-2 rounded-[7px] px-2.5 py-2 text-left transition-colors",
            draftScope === key
              ? "bg-surface-raised-3"
              : "hover:bg-surface-raised-1"
          )}
        >
          <Icon size={13} className="mt-0.5 shrink-0 text-text-secondary" />
          <span className="flex min-w-0 flex-col">
            <span className="text-small font-medium text-text-primary">
              {label}
            </span>
            <span className="text-micro text-text-muted">{desc}</span>
          </span>
          {draftScope === key && (
            <Check size={13} className="ml-auto mt-0.5 shrink-0 text-text-primary" />
          )}
        </button>
      ))}

      {draftScope === "team" && (
        <div className="mt-0.5 border-t border-border-subtle pt-1.5">
          {loading ? (
            <p className="px-2.5 py-1.5 text-micro text-text-muted">
              Loading teams…
            </p>
          ) : error ? (
            <p className="px-2.5 py-1.5 text-micro text-danger">{error}</p>
          ) : pickableTeams.length === 0 ? (
            <p className="px-2.5 py-1.5 text-micro text-text-muted">
              You&apos;re not in any team yet.
            </p>
          ) : (
            <ul className="max-h-[168px] overflow-y-auto">
              {pickableTeams.map((t) => {
                const checked = draftTeams.has(t.id);
                const locked = !isAdmin && !myTeamIds.has(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      disabled={locked}
                      onClick={() => toggleTeam(t.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left transition-colors",
                        locked
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:bg-surface-raised-1"
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color ?? "#98a2ad" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-small text-text-primary">
                        {t.name}
                      </span>
                      {checked && (
                        <Check size={12} className="shrink-0 text-text-primary" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {draftTeams.size === 0 && (
            <p className="px-2.5 pb-1 pt-1.5 text-micro leading-relaxed text-text-muted">
              No teams picked — only you and workspace admins will see it.
            </p>
          )}
        </div>
      )}

      <div className="mt-0.5 border-t border-border-subtle px-1 pt-1.5">
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!dirty || saving}
          className="h-7 w-full rounded-[7px] bg-text-primary text-caption font-medium text-bg-elevated transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Apply"}
        </button>
      </div>
    </div>
  );
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
