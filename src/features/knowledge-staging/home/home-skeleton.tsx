/**
 * STAGING COPY (trimmed) of `apps/desktop-ui/src/pages/home/home-skeleton.tsx`: only the
 * Knowledge face's skeleton. The page-frame skeleton (rail, header,
 * channel list, overview face) is the staging frame's job and is not copied.
 */
import { Skeleton, SkeletonBar } from "@/shared/ui/skeleton";
import { PAGE_ACTION_ICON } from "@/shared/ui/page-action-button";
import { SectionPanelGhost } from "@/features/knowledge-staging/desktop/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "@/features/knowledge-staging/desktop/components/skeletons/skeleton-surface";
import home from "./home.module.css";

/** /home → Knowledge while the base list is in flight: two flat sections over the card grid. No
 *  caption under either heading — the real panels print label + control only (2026-09-09). */
export function HomeKnowledgePanelsSkeleton({
  label = "Loading knowledge",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3"
    >
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Knowledge base" />}>
        <KbCardsGhost />
      </SectionPanelGhost>
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Knowledge base" />}>
        <KbCardsGhost />
      </SectionPanelGhost>
    </SkeletonSurface>
  );
}

/** Every /home section heading ghost is one width. */
const HEADING_W = 148;

/**
 * A section header's create-button ghost: `page-action-button.tsx › CreateButton` is `PAGE_ACTION_BTN`
 * (`h-9 rounded-full px-[15px]`) holding a 13px plus, a `gap-1.5`, then its label — so the width is
 * sized from the label the real button prints, and two sections with one label ghost one width.
 */
function CreateGhost({ label }: { label: string }) {
  return (
    <SkeletonBar
      h={36}
      w={`calc(${label.length}ch + ${15 * 2 + PAGE_ACTION_ICON + 6}px)`}
      className="rounded-full"
    />
  );
}

function KbCardsGhost() {
  return (
    <div className={home.kbCards}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={home.kbCell}>
          <Skeleton className="h-full w-full rounded-[14px]" />
        </div>
      ))}
    </div>
  );
}

