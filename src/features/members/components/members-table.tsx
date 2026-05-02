"use client";

import { useMemo, useState } from "react";
import { ChevronRight, MoreHorizontal, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  MEMBERS,
  TEAMS,
  type Member,
  type MemberRole,
  type Team,
} from "../data";
import { Avatar, RoleSelect, SelectFilter } from "./member-bits";
import { AccessMatrix } from "./access-matrix";

/**
 * Members tab — toolbar (search + role filter + team filter) over a
 * stack of panels:
 *
 *   1. **Workspace** — members with no team (owners, admins, fresh
 *      hires waiting on team assignment).
 *   2. One panel per team, in declaration order. Managers sort to the
 *      top of their team's roster; the rest follow.
 *
 * Click any row to expand the per-member access matrix inline.
 *
 * Role-priority sort within a panel: owner → admin → manager → member
 * → viewer. Stable on tie (preserves insertion order).
 */
export function MembersTable() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<MemberRole | "all">("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Local role overrides — static UI; no persistence yet. Keyed by
  // member id so each row can stage its own edit.
  const [roleOverrides, setRoleOverrides] = useState<
    Record<string, MemberRole>
  >({});

  const visibleMembers = useMemo(() => {
    return MEMBERS.filter((m) => {
      const role = roleOverrides[m.id] ?? m.role;
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !m.email.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [search, roleFilter, roleOverrides]);

  // Group visible members: unassigned bucket + per-team buckets, with
  // intra-bucket sorting that pins managers (and admins/owners) to top.
  const groups = useMemo(
    () => buildGroups(visibleMembers, roleOverrides, teamFilter),
    [visibleMembers, roleOverrides, teamFilter]
  );

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
          onChange={(v) => setRoleFilter(v as MemberRole | "all")}
          options={[
            { value: "all", label: "All roles" },
            { value: "owner", label: "Owner" },
            { value: "admin", label: "Admin" },
            { value: "manager", label: "Manager" },
            { value: "member", label: "Member" },
            { value: "viewer", label: "Viewer" },
          ]}
        />
        <SelectFilter
          value={teamFilter}
          onChange={setTeamFilter}
          options={[
            { value: "all", label: "All groups" },
            { value: "unassigned", label: "Workspace (no team)" },
            ...TEAMS.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
          {visibleMembers.length} of {MEMBERS.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {groups.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-text-secondary/60">
            No members match these filters.
          </div>
        )}
        {groups.map((g) => (
          <TeamPanel
            key={g.id}
            title={g.title}
            subtitle={g.subtitle}
            members={g.members}
            expandedId={expandedId}
            onToggle={(id) =>
              setExpandedId((prev) => (prev === id ? null : id))
            }
            roleOverrides={roleOverrides}
            onRoleChange={(memberId, role) =>
              setRoleOverrides((prev) => ({ ...prev, [memberId]: role }))
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── Grouping logic ──────────────────────────────────────────────────

interface Group {
  id: string;
  title: string;
  subtitle: string | null;
  members: Member[];
}

const ROLE_RANK: Record<MemberRole, number> = {
  owner: 0,
  admin: 1,
  manager: 2,
  member: 3,
  viewer: 4,
};

function buildGroups(
  members: Member[],
  overrides: Record<string, MemberRole>,
  teamFilter: string
): Group[] {
  const sortedByRole = (list: Member[]): Member[] => {
    return list
      .map((m, idx) => ({ m, idx }))
      .sort((a, b) => {
        const roleA = overrides[a.m.id] ?? a.m.role;
        const roleB = overrides[b.m.id] ?? b.m.role;
        if (ROLE_RANK[roleA] !== ROLE_RANK[roleB]) {
          return ROLE_RANK[roleA] - ROLE_RANK[roleB];
        }
        return a.idx - b.idx;
      })
      .map((x) => x.m);
  };

  const groups: Group[] = [];
  const memberSet = new Set(members.map((m) => m.id));

  // Unassigned (Workspace) group — only render if it has members and
  // the team filter doesn't exclude it.
  if (teamFilter === "all" || teamFilter === "unassigned") {
    const unassigned = members.filter((m) => m.teamIds.length === 0);
    if (unassigned.length > 0) {
      groups.push({
        id: "unassigned",
        title: "Workspace",
        subtitle: "Members not in a team — typically owners and admins.",
        members: sortedByRole(unassigned),
      });
    }
  }

  // Per-team groups, in TEAMS declaration order.
  for (const team of TEAMS) {
    if (teamFilter !== "all" && teamFilter !== team.id) continue;
    if (teamFilter === "unassigned") continue;
    const inTeam = team.memberIds
      .filter((id) => memberSet.has(id))
      .map((id) => members.find((m) => m.id === id))
      .filter((m): m is Member => Boolean(m));
    if (inTeam.length === 0) continue;
    groups.push({
      id: team.id,
      title: team.name,
      subtitle: team.description,
      members: sortedByRole(inTeam),
    });
  }

  return groups;
}

// ── Team panel ──────────────────────────────────────────────────────

function TeamPanel({
  title,
  subtitle,
  members,
  expandedId,
  onToggle,
  roleOverrides,
  onRoleChange,
}: {
  title: string;
  subtitle: string | null;
  members: Member[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  roleOverrides: Record<string, MemberRole>;
  onRoleChange: (memberId: string, role: MemberRole) => void;
}) {
  return (
    <section
      className="rounded-xl border border-white/[0.06] overflow-hidden"
      style={{ backgroundColor: "oklch(0.135 0 0)" }}
    >
      <header className="px-4 py-3 border-b border-white/[0.06] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[11.5px] text-text-secondary/70 leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </header>
      <div className="divide-y divide-white/[0.04]">
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            role={roleOverrides[member.id] ?? member.role}
            expanded={expandedId === member.id}
            onToggle={() => onToggle(member.id)}
            onRoleChange={(next) => onRoleChange(member.id, next)}
          />
        ))}
      </div>
    </section>
  );
}

// ── Member row ──────────────────────────────────────────────────────

function MemberRow({
  member,
  role,
  expanded,
  onToggle,
  onRoleChange,
}: {
  member: Member;
  role: MemberRole;
  expanded: boolean;
  onToggle: () => void;
  onRoleChange: (next: MemberRole) => void;
}) {
  const teams = member.teamIds
    .map((id) => TEAMS.find((t) => t.id === id))
    .filter((t): t is Team => Boolean(t));

  return (
    <div
      className={cn(
        "transition-colors",
        expanded ? "bg-white/[0.015]" : "hover:bg-white/[0.015]"
      )}
    >
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="grid grid-cols-[1fr_120px_180px_120px_40px] items-center gap-3 px-4 py-3 cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight
            size={12}
            className={cn(
              "text-text-secondary/50 shrink-0 transition-transform",
              expanded && "rotate-90"
            )}
          />
          <Avatar member={member} />
          <div className="min-w-0">
            <p className="text-sm text-text-primary truncate">{member.name}</p>
            <p className="text-[11px] text-text-secondary/70 truncate">
              {member.email}
            </p>
          </div>
        </div>
        <div>
          <RoleSelect value={role} onChange={onRoleChange} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {teams.length === 0 ? (
            <span className="text-[10px] font-mono text-text-secondary/40">
              —
            </span>
          ) : (
            <>
              {teams.slice(0, 2).map((t) => (
                <span
                  key={t.id}
                  className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[11px] text-text-secondary"
                >
                  {t.name}
                </span>
              ))}
              {teams.length > 2 && (
                <span className="text-[10px] font-mono text-text-secondary/50">
                  +{teams.length - 2}
                </span>
              )}
            </>
          )}
        </div>
        <div className="text-[11px] text-text-secondary/70 font-mono">
          {member.lastActive}
        </div>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="More"
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <MoreHorizontal size={13} className="text-text-secondary" />
        </button>
      </div>

      {expanded && (
        <div className="px-12 pb-5 pt-1">
          <AccessMatrix
            knowledgeAccess={member.knowledgeAccess}
            skillAccess={member.skillAccess}
            inheritFrom={teams.length > 0 ? teams[0].name : null}
          />
        </div>
      )}
    </div>
  );
}
