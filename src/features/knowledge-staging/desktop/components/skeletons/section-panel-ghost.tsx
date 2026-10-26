/** STAGING COPY (trimmed) of `apps/desktop-ui/src/components/skeletons/section-panel-ghost.tsx`: `SectionPanelGhost` only. */
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { SkeletonLine } from "@/shared/ui/skeleton";
import { SECTION_PANEL_GROUND, SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";

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
