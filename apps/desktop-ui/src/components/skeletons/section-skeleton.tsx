import type { ReactNode } from "react";
import type { NavSection } from "@/shared/layout/app-shell/app-sidebar-core";
import { PageLoading } from "#/components/page-states";
import { OverviewSkeleton } from "#/pages/overview/overview-skeleton";
import { ChannelsSkeleton } from "#/pages/channels/channels-skeleton";
import { IdentitiesPageSkeleton } from "#/pages/identities/identities-skeleton";
import { MembersPageSkeleton } from "#/pages/members/members-skeleton";
import { KnowledgeHomeSkeleton } from "./knowledge-skeletons";

/**
 * The skeleton of the section the route is heading for. Skills, Chats and Ontology have no shape
 * of their own and keep `PageLoading` (INVARIANTS §1A). `null` (a bare `/{segment}`) is Overview,
 * as `app-sidebar-core.tsx › activeSectionFromPath` answers.
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
