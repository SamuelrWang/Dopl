"use client";

import { useState } from "react";
import { UsersRound } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import type { TeamView } from "@/features/teams/types";
import type { AssignableRole, WorkspaceMemberView } from "../../types";
import { useMemberAccess, useMemberActivity } from "./hooks";
import { MemberHeader } from "./member-header";
import { AboutTab } from "./tab-about";
import { AccessTab } from "./tab-access";
import { ActivityTab } from "./tab-activity";
import { SettingsTab } from "./tab-settings";
import {
  visibilityFor,
  visibleTabs,
  type DetailTabKey,
  type Viewer,
} from "./visibility";

export function MemberDetailPane({
  workspaceSlug,
  member,
  teams,
  viewer,
  bio,
  busy,
  onRoleChange,
  onRemove,
  onJoinTeam,
  onLeaveTeam,
}: {
  workspaceSlug: string;
  member: WorkspaceMemberView;
  teams: TeamView[];
  viewer: Viewer;
  /** The signed-in user's bio; only rendered on a self view. */
  bio: string | null;
  busy: boolean;
  onRoleChange: (userId: string, role: AssignableRole) => void;
  onRemove: (member: WorkspaceMemberView) => void;
  onJoinTeam: (userId: string, teamId: string) => void;
  onLeaveTeam: (userId: string, teamId: string) => void;
}) {
  const visibility = visibilityFor(viewer, member);
  const tabs = visibleTabs(visibility);

  const [requested, setRequested] = useState<DetailTabKey>("about");
  // Derived, not synced: a tab this viewer may not see falls back rather than
  // rendering an empty body for a frame.
  const tab = tabs.includes(requested) ? requested : tabs[0];

  // ⚠ `enabled` keeps a peer from FETCHING what they may not see. The route
  // refuses them anyway; not asking is the point.
  const access = useMemberAccess(workspaceSlug, member.userId, visibility.showAccessTab);
  const activity = useMemberActivity(workspaceSlug, member.userId);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card-surface-subtle">
      <MemberHeader
        member={member}
        visibility={visibility}
        tabs={tabs}
        tab={tab}
        onTabChange={setRequested}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="bento px-4 py-4">
          {tab === "about" && (
            <AboutTab
              workspaceSlug={workspaceSlug}
              member={member}
              teams={teams}
              visibility={visibility}
              bio={bio}
              busy={busy}
              onJoinTeam={(teamId) => onJoinTeam(member.userId, teamId)}
              onLeaveTeam={(teamId) => onLeaveTeam(member.userId, teamId)}
            />
          )}
          {tab === "access" && (
            <AccessTab
              member={member}
              rows={access.rows}
              loading={access.loading}
              error={access.error}
              onRetry={() => void access.retry()}
              visibility={visibility}
            />
          )}
          {tab === "activity" && (
            <ActivityTab
              events={activity.events}
              loading={activity.loading}
              error={activity.error}
              onRetry={() => void activity.retry()}
            />
          )}
          {tab === "settings" && (
            <SettingsTab
              member={member}
              visibility={visibility}
              busy={busy}
              onRoleChange={(role) => onRoleChange(member.userId, role)}
              onRemove={() => onRemove(member)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyDetailPane() {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center bg-card-surface-subtle">
      <EmptyState
        icon={UsersRound}
        title="Nothing selected."
        description="Pick someone from the roster to see how they are scoped."
      />
    </div>
  );
}
