/**
 * STAGING COPY (trimmed) of `apps/desktop-ui/src/pages/home/home-skeleton.tsx`: only the
 * Identities face skeleton this staging page mounts. The page-frame skeleton (rail, header,
 * channel list, overview face) is the staging frame's job and is not copied.
 */
import { Skeleton, SkeletonBar } from "@/shared/ui/skeleton";
import { PAGE_ACTION_ICON } from "@/shared/ui/page-action-button";
import {
  IdentityCardsGhost,
  SectionPanelGhost,
} from "@/features/identities-staging/desktop/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "@/features/identities-staging/desktop/components/skeletons/skeleton-surface";

/** /home → Identities while the container list is in flight: the loaded page's own frame (item 8,
 *  the 3/4 identities + 1/4 Activity rail, `staging.css › THE IDENTITIES PAGE RAIL`), so the
 *  ghost does not jump when the read lands. */
export function HomeIdentityPanelsSkeleton({
  label = "Loading identities",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface label={label} className="uis-idp-layout overflow-hidden">
      <div className="uis-idp-cols">
        <div className="uis-idp-main">
          <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Agent Identity" />}>
            <IdentityCardsGhost count={3} />
          </SectionPanelGhost>
          <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Agent Identity" />}>
            <IdentityCardsGhost count={3} />
          </SectionPanelGhost>
        </div>
        <div className="uis-idp-aside">
          <SectionPanelGhost headingWidth={HEADING_W / 2}>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                // The run card's two lines (`identity-activity-panel.tsx › RunCard`), 12px radius.
                <Skeleton key={i} className="h-[72px] rounded-xl" />
              ))}
            </div>
          </SectionPanelGhost>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/** Every /home section heading ghost is one width. */
const HEADING_W = 148;

/**
 * A section header's create-button ghost: `panel-buttons.tsx › CreateButton` is `PAGE_ACTION_BTN`
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
