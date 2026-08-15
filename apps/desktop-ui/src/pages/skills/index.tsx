import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";
import { SkillsBrowserCore } from "@/features/skills/components/skills-browser-core";
import type { Skill } from "@/features/skills/types";

const SKILLS_PATH = "/api/skills";

/**
 * `/:workspaceSegment/skills`.
 *
 * List = `GET /api/skills`, ⚠ summary columns only — body deliberately not in
 * this payload; the detail pane pulls the full skill per slug. Membership half
 * from `useWorkspaceAccess`.
 *
 * `SkillsBrowserCore` is the Next-free core of
 * `src/features/skills/components/skills-browser.tsx`; the editor beneath it
 * (`SkillView`, history rail, share control) is reused by import, unmodified.
 * Freshness = one `invalidateQueries(["/api/skills"])`.
 */
export default function SkillsPage() {
  const queryClient = useQueryClient();
  const {
    access,
    isPending: accessPending,
    error: accessError,
    refetch: refetchAccess,
  } = useWorkspaceAccess();

  const workspaceId = access?.workspaceId;
  const skills = useApiQuery<{ skills: Skill[] }, Skill[]>(SKILLS_PATH, {
    workspaceId,
    enabled: workspaceId !== undefined,
    select: (body) => body.skills,
  });

  const onListChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [SKILLS_PATH] });
  }, [queryClient]);

  if (accessError) {
    return <PageError error={accessError} onRetry={refetchAccess} />;
  }
  if (skills.error) {
    return <PageError error={skills.error} onRetry={skills.refetch} />;
  }
  if (accessPending || !access || skills.isPending || !skills.data) {
    return <PageLoading label="Loading skills" variant="two-pane" />;
  }

  return (
    <SkillsBrowserCore
      workspaceSlug={access.workspaceSlug}
      workspaceId={access.workspaceId}
      currentUserId={access.currentUserId}
      isAdmin={access.isAdmin}
      skills={skills.data}
      onListChanged={onListChanged}
    />
  );
}
