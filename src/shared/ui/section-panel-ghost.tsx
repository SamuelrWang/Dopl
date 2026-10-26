import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { PAGE_ACTION_ICON } from "@/shared/ui/page-action-button";
import { SECTION_PANEL_GROUND, SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";
import { SkeletonBar, SkeletonLine } from "@/shared/ui/skeleton";

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

/** Every /home section heading ghost is one width. */
const HEADING_W = 148;

/**
 * A section header's create-button ghost: `page-action-button.tsx › CreateButton` is `PAGE_ACTION_BTN`
 * (`h-9 rounded-full px-3.75`) holding a 13px plus, a `gap-1.5`, then its label — so the width is
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

/** /home's two-section faces (Knowledge, Identities): two flat sections, each with its create
 *  button, over a card grid. No caption — the real panels print label + control only. */
export function PanelsGhost({ label, cards }: { label: string; cards: ReactNode }) {
  return (
    <>
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label={label} />}>
        {cards}
      </SectionPanelGhost>
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label={label} />}>
        {cards}
      </SectionPanelGhost>
    </>
  );
}
