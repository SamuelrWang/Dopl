"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { meetsMinRole } from "@/features/workspaces/types";
import type {
  AssignableRole,
  MemberRole,
  WorkspaceMemberView,
} from "../types";
import { Avatar, RolePill, RoleSelect, SelectFilter } from "./member-bits";
import { AccessMatrix } from "./access-matrix";

type RoleFilter = MemberRole | "all";

const ROLE_RANK: Record<MemberRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
  viewer: 3,
};

interface Props {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  myRole: MemberRole;
  members: WorkspaceMemberView[];
  loading: boolean;
  onChanged: () => void;
}

/**
 * Flat members table with search + role filter. Admins see role
 * selectors and remove buttons on rows they can edit; everyone else
 * sees read-only role pills. Self-row is always read-only — admins
 * cannot demote or remove themselves (handled server-side too).
 *
 * Click any row (admin only) to expand the per-resource access matrix.
 */
export function MembersTable({
  workspaceSlug,
  workspaceId,
  currentUserId,
  myRole,
  members,
  loading,
  onChanged,
}: Props) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const canManage = meetsMinRole(myRole, "admin");

  const visibleMembers = useMemo(() => {
    const filtered = members.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = (m.displayName ?? "").toLowerCase();
        const email = (m.email ?? "").toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      return true;
    });
    return filtered
      .map((m, idx) => ({ m, idx }))
      .sort((a, b) => {
        const r = ROLE_RANK[a.m.role] - ROLE_RANK[b.m.role];
        if (r !== 0) return r;
        const an = (a.m.displayName ?? a.m.email ?? "").toLowerCase();
        const bn = (b.m.displayName ?? b.m.email ?? "").toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        return a.idx - b.idx;
      })
      .map((x) => x.m);
  }, [members, search, roleFilter]);

  async function changeRole(target: WorkspaceMemberView, role: AssignableRole) {
    if (!canManage) return;
    setBusyId(target.userId);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(
          workspaceSlug
        )}/members/${encodeURIComponent(target.userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to update role");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(target: WorkspaceMemberView) {
    if (!canManage) return;
    const label = target.displayName || target.email || "this member";
    if (!window.confirm(`Remove ${label} from the workspace?`)) return;
    setBusyId(target.userId);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(
          workspaceSlug
        )}/members/${encodeURIComponent(target.userId)}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to remove");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
            className="w-full pl-7 pr-3 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-xs placeholder:text-text-secondary/40 outline-none focus:border-white/[0.15] transition-colors"
          />
        </div>
        <SelectFilter
          value={roleFilter}
          onChange={(v) => setRoleFilter(v as RoleFilter)}
          options={[
            { value: "all", label: "All roles" },
            { value: "owner", label: "Owner" },
            { value: "admin", label: "Admin" },
            { value: "member", label: "Member" },
            { value: "viewer", label: "Viewer" },
          ]}
        />
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
          {visibleMembers.length} of {members.length}
        </span>
      </div>

      {error && (
        <p className="px-4 py-2 text-xs text-red-400 border-b border-white/[0.06]">
          {error}
        </p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && members.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-text-secondary/60">
            Loading members…
          </div>
        )}
        {!loading && visibleMembers.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-text-secondary/60">
            {members.length === 0
              ? "No members yet."
              : "No members match these filters."}
          </div>
        )}
        {visibleMembers.length > 0 && (
          <ul className="divide-y divide-white/[0.04]">
            {visibleMembers.map((m) => {
              const isSelf = m.userId === currentUserId;
              const canEditTarget =
                canManage &&
                !isSelf &&
                m.role !== "owner" &&
                (myRole === "owner" || m.role !== "admin");
              const expandable = canManage;
              const expanded = expandedId === m.userId;
              return (
                <li key={m.userId}>
                  <div
                    onClick={() =>
                      expandable
                        ? setExpandedId((prev) => (prev === m.userId ? null : m.userId))
                        : undefined
                    }
                    role={expandable ? "button" : undefined}
                    aria-expanded={expandable ? expanded : undefined}
                    tabIndex={expandable ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!expandable) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedId((prev) => (prev === m.userId ? null : m.userId));
                      }
                    }}
                    className={cn(
                      "grid grid-cols-[16px_1fr_140px_140px_60px] items-center gap-3 px-4 py-3 transition-colors",
                      expandable && "cursor-pointer hover:bg-white/[0.015]",
                      expanded && "bg-white/[0.02]"
                    )}
                  >
                    <ChevronRight
                      size={12}
                      className={cn(
                        "shrink-0 text-text-secondary/40 transition-transform",
                        !expandable && "opacity-0",
                        expanded && "rotate-90"
                      )}
                    />
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar person={m} />
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary truncate">
                          {m.displayName || m.email || m.userId}
                          {isSelf && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-text-secondary/50">
                              You
                            </span>
                          )}
                        </p>
                        {m.email && m.displayName && (
                          <p className="text-[11px] text-text-secondary/60 truncate">
                            {m.email}
                          </p>
                        )}
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {canEditTarget ? (
                        <RoleSelect
                          value={m.role as AssignableRole}
                          disabled={busyId === m.userId}
                          onChange={(next) => changeRole(m, next)}
                        />
                      ) : (
                        <RolePill role={m.role} />
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-text-secondary/60">
                      Joined {formatJoined(m.joinedAt)}
                    </div>
                    <div className="flex justify-end">
                      {canManage && !isSelf && m.role !== "owner" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(m);
                          }}
                          disabled={busyId === m.userId}
                          className="text-[10px] uppercase tracking-wider text-text-secondary/50 hover:text-red-300 transition-colors disabled:opacity-40 cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <AccessMatrix
                      workspaceSlug={workspaceSlug}
                      workspaceId={workspaceId}
                      targetUserId={m.userId}
                      targetRole={m.role}
                      enabled
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatJoined(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
