import { AppPanel } from "@/shared/layout/app-shell";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { SkillViewSkeleton } from "@/features/skills/components/skill-view-skeleton";

/**
 * Route-level loading boundary for the skill detail page. Renders
 * while the page server component awaits getUser →
 * resolvePageWorkspace → resolvePageSkill → resolveSkillBody +
 * listWorkspaceKnowledgeBases. Mirrors the eventual SkillView chrome
 * so the swap to the live page doesn't reflow.
 */
export default function Loading() {
  return (
    <AppPanel scroll={false}>
      <PageTopBar title="Skill" />
      <SkillViewSkeleton />
    </AppPanel>
  );
}
