"use client";

import { Plus, UsersRound } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { TeamView } from "@/features/teams/types";
import type {
  AssignableRole,
  WorkspaceInvitationView,
  WorkspaceMemberView,
} from "../../types";
import type { JoinRequestView } from "../../hooks/use-join-requests";
import { MemberSectionCard, PendingSectionCard } from "./member-rows";
import { TeamsList } from "./teams-list";
import { ROLE_SECTIONS, matchesQuery, membersInSection } from "./view-model";

export type ListTabKey = "members" | "teams";

interface Props {
  members: WorkspaceMemberView[];
  invitations: WorkspaceInvitationView[];
  joinRequests: JoinRequestView[];
  teams: TeamView[];
  tab: ListTabKey;
  onTabChange: (next: ListTabKey) => void;
  query: string;
  onQueryChange: (next: string) => void;
  openMemberId: string | null;
  openTeamId: string | null;
  onOpenMember: (userId: string) => void;
  onOpenTeam: (teamId: string) => void;
  canInvite: boolean;
  canManageTeams: boolean;
  showRowActions: boolean;
  canSeePresence: (userId: string) => boolean;
  busy: boolean;
  onInvite: () => void;
  onCreateTeam: () => void;
  onRemoveMember: (member: WorkspaceMemberView) => void;
  onRevokeInvitation: (id: string) => void;
  onResolveJoinRequest: (
    id: string,
    action: "approve" | "decline",
    role: AssignableRole
  ) => void;
}

export function ListPane({
  members,
  invitations,
  joinRequests,
  teams,
  tab,
  onTabChange,
  query,
  onQueryChange,
  openMemberId,
  openTeamId,
  onOpenMember,
  onOpenTeam,
  canInvite,
  canManageTeams,
  showRowActions,
  canSeePresence,
  busy,
  onInvite,
  onCreateTeam,
  onRemoveMember,
  onRevokeInvitation,
  onResolveJoinRequest,
}: Props) {
  const visibleInvitations = invitations.filter((i) =>
    matchesQuery({ displayName: null, email: i.email }, query)
  );
  const visibleRequests = joinRequests.filter((r) => matchesQuery(r, query));
  const visibleTeams = teams.filter((t) =>
    matchesQuery({ displayName: t.name, email: null }, query)
  );
  const sections = ROLE_SECTIONS.map((s) => ({
    ...s,
    rows: membersInSection(members, s.key, query),
  })).filter((s) => s.rows.length > 0);
  const pendingCount = visibleInvitations.length + visibleRequests.length;

  // ⚠ Teams are NOT included: `TeamsList` renders its own empty state and owns
  // the "Create team" button, so short-circuiting it here is how a workspace
  // with zero teams loses the only way to make its first one.
  const nothingMatches = tab === "members" && sections.length === 0 && pendingCount === 0;

  return (
    <div className="flex min-w-0 flex-col border-r border-border-default">
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <h1 className="text-display font-semibold tracking-tight text-text-primary">
            Members
          </h1>
          <p className="mt-0.5 text-caption text-text-secondary">
            Manage your workspace members and their permissions.
          </p>
        </div>
        {canInvite && (
          <button
            type="button"
            onClick={onInvite}
            className="auth-btn-3d flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-small font-semibold text-white"
          >
            <Plus size={13} aria-hidden />
            Add
          </button>
        )}
      </div>

      <SearchField
        value={query}
        onChange={onQueryChange}
        onClear={() => onQueryChange("")}
        placeholder={tab === "members" ? "Search members" : "Search teams"}
        size="sm"
        className="mx-4 mb-3"
      />

      <SegmentedControl
        options={[
          { key: "members" as const, label: "Members", count: members.length },
          { key: "teams" as const, label: "Teams", count: teams.length },
        ]}
        value={tab}
        onChange={onTabChange}
        className="mx-4 mb-3"
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pt-3">
        {nothingMatches ? (
          <div className="py-16">
            <EmptyState
              icon={UsersRound}
              title={query.trim() ? "Nothing matches." : `No ${tab} yet.`}
              description={
                query.trim()
                  ? `No ${tab} answer to “${query.trim()}”.`
                  : undefined
              }
            />
          </div>
        ) : tab === "members" ? (
          <div className="flex flex-col gap-5 px-3 pb-6">
            {sections.map((section) => (
              <section key={section.key}>
                <h2 className="px-0.5 text-body font-semibold text-text-primary">
                  {section.title}
                </h2>
                <p className="mb-2 px-0.5 pt-0.5 text-caption leading-relaxed text-text-secondary">
                  {section.description}
                </p>
                <MemberSectionCard
                  members={section.rows}
                  openUserId={openMemberId}
                  showRowActions={showRowActions}
                  canSeePresence={canSeePresence}
                  busy={busy}
                  onOpen={onOpenMember}
                  onRemove={onRemoveMember}
                />
              </section>
            ))}

            {pendingCount > 0 && (
              <section>
                <h2 className="px-0.5 text-body font-semibold text-text-primary">
                  Pending
                </h2>
                <p className="mb-2 px-0.5 pt-0.5 text-caption leading-relaxed text-text-secondary">
                  Invitations that have not been accepted, and people asking to
                  join by link.
                </p>
                <PendingSectionCard
                  invitations={visibleInvitations}
                  joinRequests={visibleRequests}
                  showRowActions={showRowActions}
                  busy={busy}
                  onRevokeInvitation={onRevokeInvitation}
                  onResolveJoinRequest={onResolveJoinRequest}
                />
              </section>
            )}
          </div>
        ) : (
          <TeamsList
            query={query}
            teams={visibleTeams}
            members={members}
            openTeamId={openTeamId}
            canManageTeams={canManageTeams}
            onOpen={onOpenTeam}
            onCreate={onCreateTeam}
          />
        )}
      </div>
    </div>
  );
}
