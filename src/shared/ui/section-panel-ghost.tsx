import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { PILL_ICON } from "@/shared/ui/pill-button";
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
  flat = false,
}: {
  children: ReactNode;
  headingWidth: number;
  /** The header-right control's ghost; omit where the loaded panel has none. */
  action?: ReactNode;
  /** One caption line under the heading. */
  caption?: boolean;
  /** The loaded `SectionPanel` paints this ground itself, so a ghost without it flashes white. */
  ground?: string;
  /** `SectionPanel flat`: no well, the heading flush with the content. */
  flat?: boolean;
}) {
  const inset = flat ? undefined : "px-1";
  return (
    <div data-section-panel className={cn(!flat && SECTION_PANEL_SHELL, !flat && ground)}>
      <div className={cn("flex min-h-5.5 items-center justify-between gap-2 pb-2.5", inset)}>
        <SkeletonLine w={headingWidth} h={10} />
        {action}
      </div>
      {caption && (
        <div className={cn("pb-2.5", inset)}>
          <SkeletonLine w="58%" h={9} />
        </div>
      )}
      {children}
    </div>
  );
}

/** Every /home section heading ghost is one width. */
export const HEADING_W = 148;

/**
 * A section header's create-button ghost: `pill-button.tsx › CreateButton` is `pillButton("ink", "lg")`
 * (`h-9 rounded-full px-3.75`) holding a 13px plus, a `gap-1.5`, then its label — so the width is
 * sized from the label the real button prints, and two sections with one label ghost one width.
 */
export function CreateGhost({ label }: { label: string }) {
  return (
    <SkeletonBar
      h={36}
      w={`calc(${label.length}ch + ${15 * 2 + PILL_ICON.lg + 6}px)`}
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
