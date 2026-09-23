import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { SECTION_PANEL_GROUND, SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";
import { IDENTITY_GRID } from "@/features/agent-identities/components/identity-section";

/**
 * A `SectionPanel`'s ghost: its box, its `data-section-panel` hook and its ground, with a heading
 * BAR. Not `SectionPanel` itself, which prints its label as an `<h2>` — a loading state carries no
 * text.
 */
export function SectionPanelGhost({
  children,
  headingWidth,
  action,
  caption = false,
  ground = SECTION_PANEL_GROUND,
}: {
  children: ReactNode;
  headingWidth: number;
  /** The header-right control's ghost; omit where the loaded panel has none. */
  action?: ReactNode;
  /** One caption line under the heading. */
  caption?: boolean;
  /** The loaded `SectionPanel` paints this ground itself, so a ghost without it flashes white. */
  ground?: string;
}) {
  return (
    <div data-section-panel className={cn(SECTION_PANEL_SHELL, ground)}>
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        <SkeletonLine w={headingWidth} h={10} />
        {action}
      </div>
      {caption && (
        <div className="px-1 pb-2.5">
          <SkeletonLine w="58%" h={9} />
        </div>
      )}
      {children}
    </div>
  );
}

/** `IdentityGrid`'s cards; the grid class is imported so the column count cannot drift. */
export function IdentityCardsGhost({ count }: { count: number }) {
  return (
    <div className={IDENTITY_GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-[14px]" />
      ))}
    </div>
  );
}
