import { PageTopBar } from "@/shared/layout/page-top-bar";
import { KnowledgeBaseSkeleton } from "@/features/knowledge/components/knowledge-base-skeleton";

/**
 * Route-level loading boundary for the KB detail page. Renders while
 * the page server component awaits getUser → resolvePageWorkspace →
 * resolvePageKbWithWorkspace → getBaseTree → getEntry. Mirrors the
 * eventual KnowledgeBaseView chrome so the swap to the live page
 * doesn't reflow.
 */
export default function Loading() {
  return (
    <>
      <PageTopBar title="Knowledge" />
      <KnowledgeBaseSkeleton />
    </>
  );
}
