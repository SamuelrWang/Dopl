"use client";

import {
  ScopeShareMenu,
  ScopeSharePopover,
} from "@/shared/ui/scope-share-popover";
import { useTeams } from "@/features/members/hooks/use-teams";
import { skillScope, type SkillScope } from "../scope";
import type { Skill } from "../types";

/** Sharing control over the shared ScopeSharePopover. Owner or workspace
 *  admin edits; everyone else gets a read-only scope pill. */
export function SkillShareControl({
  skill,
  workspaceSlug,
  currentUserId,
  isAdmin,
  onShareChange,
}: {
  skill: Skill;
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  onShareChange: (scope: SkillScope, teamIds: string[]) => Promise<void>;
}) {
  const scope = skillScope(skill);
  const canShare = skill.createdBy === currentUserId || isAdmin;

  return (
    <ScopeSharePopover
      scope={scope}
      readOnly={!canShare}
      triggerTitle="Change who can see this skill"
    >
      {(close) => (
        <SkillShareMenu
          scope={scope}
          grantedTeamIds={skill.grantedTeamIds}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onApply={async (nextScope, teamIds) => {
            await onShareChange(nextScope, teamIds);
            close();
          }}
        />
      )}
    </ScopeSharePopover>
  );
}

function SkillShareMenu({
  scope,
  grantedTeamIds,
  workspaceSlug,
  currentUserId,
  isAdmin,
  onApply,
}: {
  scope: SkillScope;
  grantedTeamIds: string[];
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  onApply: (scope: SkillScope, teamIds: string[]) => Promise<void>;
}) {
  const teamsState = useTeams(workspaceSlug);
  return (
    <ScopeShareMenu
      scope={scope}
      grantedTeamIds={grantedTeamIds}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      teams={teamsState}
      onApply={onApply}
    />
  );
}
