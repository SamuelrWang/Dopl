import type { ReactNode } from "react";
import type { NavSection } from "@/shared/layout/app-shell/app-sidebar-core";
import { PageLoading } from "#/components/page-states";
import { OverviewSkeleton } from "#/pages/overview/overview-skeleton";
import { ChannelsSkeleton } from "#/pages/channels/channels-skeleton";
import { IdentitiesPageSkeleton } from "#/pages/identities/identities-skeleton";
import { MembersPageSkeleton } from "#/pages/members/members-skeleton";
import { KnowledgeHomeSkeleton } from "./knowledge-skeletons";

/**
 * THE SKELETON THE ROUTED SECTION WILL RESOLVE INTO — picked off the path the
 * switch is heading for, so the card under the sidebar ghosts the page that is
 * about to land and not a generic one.
 *
 * ⚠ THE THREE MISSING SECTIONS ARE DELIBERATE. Skills, Chats and Ontology have
 * no shape of their own (§1A: *"`PageLoading` IS NOT DEPRECATED AND MUST NOT
 * BE"* — it is still the loading state of every page without one), so they get
 * it here too. Inventing three shapes to fill this table is exactly the
 * "multiply the ghosts" that bullet argues against.
 *
 * ⚠ `null` (a bare `/{segment}`) IS OVERVIEW, matching
 * `app-sidebar-core.tsx › activeSectionFromPath`, which answers `"overview"`
 * for that path — the nav highlights Overview there and so does this.
 */
export function sectionSkeleton(section: NavSection | null): ReactNode {
  const label = "Opening workspace";
  switch (section) {
    case "channels":
      return <ChannelsSkeleton label={label} />;
    case "identities":
      return <IdentitiesPageSkeleton label={label} />;
    case "members":
      return <MembersPageSkeleton label={label} />;
    case "knowledge":
      return <KnowledgeHomeSkeleton label={label} />;
    case "skills":
    case "chats":
      return <PageLoading label={label} variant="two-pane" />;
    case "ontology":
      return <PageLoading label={label} />;
    default:
      return <OverviewSkeleton label={label} />;
  }
}
