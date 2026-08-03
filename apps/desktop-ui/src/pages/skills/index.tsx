import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";
import { SkillsBrowserCore } from "@/features/skills/components/skills-browser-core";
import type { Skill } from "@/features/skills/types";

const SKILLS_PATH = "/api/skills";

/**
 * `/:workspaceSegment/skills` — the port of
 * `src/app/[workspaceSlug]/(app)/skills/page.tsx`.
 *
 * The RSC did four server calls (resolve workspace → membership → skill
 * context → `listSkills`) and handed five props to `SkillsBrowser`. Here the
 * list is `GET /api/skills` (summary columns only — the body is deliberately
 * not in this payload; the detail pane pulls the full skill per slug), and the
 * membership half comes from `useWorkspaceAccess`.
 *
 * The browser itself is the SHARED component: `SkillsBrowserCore` is the
 * Next-free core of `src/features/skills/components/skills-browser.tsx`, and
 * the whole editor beneath it (`SkillView`, history rail, share control, trash
 * modal) is reused by import, unmodified.
 *
 * The web page's freshness came from four `router.refresh()` calls; here they
 * become one `invalidateQueries(["/api/skills"])`, which is strictly better —
 * a restore, rename, refolder or duplicate re-pulls the list instead of
 * re-rendering a server component.
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
    return <PageLoading label="Loading skills" />;
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
